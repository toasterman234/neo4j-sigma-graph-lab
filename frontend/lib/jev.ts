import "server-only";

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type JevBooleanQuestion = {
  type: "boolean";
  instructions: string;
};

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevPromptQuestion = JevBooleanQuestion | JevChoiceQuestion;
export type JevPromptSet = Record<string, JevPromptQuestion>;

export type JevProviderResponse = {
  answers?: Record<string, Record<string, unknown>>;
  warnings?: unknown;
  providerMetadata?: {
    typesafe?: {
      confidence?: Record<string, number>;
    };
  };
  [key: string]: unknown;
};

const MAX_STDOUT_BYTES = 1024 * 1024;
const JEV_TIMEOUT_MS = 150_000;

export function compactJevValue(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) || "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function confidenceFromJev(raw: JevProviderResponse): Record<string, number> {
  return raw.providerMetadata?.typesafe?.confidence || {};
}

export async function evaluateJevState(state: string, questions: JevPromptSet): Promise<JevProviderResponse> {
  if (!state.trim()) throw new Error("Jev state is required");
  if (!Object.keys(questions).length) throw new Error("At least one Jev question is required");

  const script = process.env.JEV_EVALUATE_SCRIPT || path.join(os.homedir(), ".codex-internal/skills/jev/bin/jev-evaluate.py");
  const payload = JSON.stringify({ model: "typesafe-ai/jev", state, questions });
  let stdout = "";
  let stderr = "";

  try {
    stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.PYTHON_BIN || "python3", [script], { stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`timed out after ${JEV_TIMEOUT_MS / 1000} seconds`));
      }, JEV_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.length > MAX_STDOUT_BYTES) child.kill("SIGTERM");
      });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.slice(0, 1000) || `exit code ${code}`));
      });
      child.stdin.end(payload);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Jev invocation failed";
    throw new Error(`Jev is unavailable: ${detail}`);
  }

  try {
    return JSON.parse(stdout) as JevProviderResponse;
  } catch {
    throw new Error("Jev returned invalid JSON");
  }
}
