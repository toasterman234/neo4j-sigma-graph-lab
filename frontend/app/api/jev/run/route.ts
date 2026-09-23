import { NextResponse } from "next/server";
import { runJev, type JevQuestion } from "@/lib/jev";
import { searchGraph, type SearchMode, type SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);
const questions = new Set<JevQuestion>(["missing_relationship", "supersession", "temporal_status", "evidence_alignment"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; scope?: string; mode?: string; selectedNodeIds?: string[]; question?: string; questionType?: string };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
    const scope = scopes.has(body.scope as SearchScope) ? body.scope as SearchScope : "whole";
    const mode = modes.has(body.mode as SearchMode) ? body.mode as SearchMode : "keyword";
    const questionType = questions.has(body.questionType as JevQuestion) ? body.questionType as JevQuestion : "missing_relationship";
    const search = await searchGraph(query, scope, mode, Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds.slice(0, 20) : [], 80);
    return NextResponse.json(await runJev({ question: body.question, questionType, search }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run Jev" }, { status: 400 });
  }
}
