import { NextResponse } from "next/server";
import { searchGraph, type SearchMode, type SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return NextResponse.json(await searchGraph(""));
    const scope = scopes.has(url.searchParams.get("scope") as SearchScope) ? url.searchParams.get("scope") as SearchScope : "whole";
    const mode = modes.has(url.searchParams.get("mode") as SearchMode) ? url.searchParams.get("mode") as SearchMode : "keyword";
    const selectedNodeIds = (url.searchParams.get("selected") || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 20);
    return NextResponse.json(await searchGraph(query, scope, mode, selectedNodeIds, Number(url.searchParams.get("limit") || "80")));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to search Neo4j" }, { status: 400 });
  }
}
