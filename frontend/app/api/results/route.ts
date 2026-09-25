import { NextResponse } from "next/server";
import { listSavedJevResults, saveJevResult } from "@/lib/resultStore";
import type { JevRunResponse } from "@/lib/questions/runner";
import type { SearchMode, SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);

export async function GET() {
  try {
    return NextResponse.json({ results: listSavedJevResults() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to list saved results" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; scope?: string; mode?: string; result?: JevRunResponse };
    if (!body.result || typeof body.result !== "object") return NextResponse.json({ error: "result is required" }, { status: 400 });
    const scope = scopes.has(body.scope as SearchScope) ? body.scope as SearchScope : "whole";
    const mode = modes.has(body.mode as SearchMode) ? body.mode as SearchMode : "keyword";
    const saved = saveJevResult({ query: String(body.query || body.result.sourceContext?.query || ""), scope, mode, result: body.result });
    return NextResponse.json({ result: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save result" }, { status: 400 });
  }
}
