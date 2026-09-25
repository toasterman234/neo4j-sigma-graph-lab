import { NextResponse } from "next/server";
import { runQuestionRouter } from "@/lib/questions/router";
import { selectedItemContext, type SearchMode, type SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      selectedNodeIds?: string[];
      itemLabel?: string;
      graphQuery?: string;
      scope?: string;
      mode?: string;
      userNote?: string;
    };

    const selectedNodeIds = Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds.slice(0, 20) : [];
    if (!selectedNodeIds.length) {
      return NextResponse.json({ error: "Select a document/source or graph object before running the router" }, { status: 400 });
    }

    const itemLabel = typeof body.itemLabel === "string" && body.itemLabel.trim() ? body.itemLabel.trim() : "selected item";
    const scope = scopes.has(body.scope as SearchScope) ? body.scope as SearchScope : "whole";
    const mode = modes.has(body.mode as SearchMode) ? body.mode as SearchMode : "keyword";
    const itemSearch = await selectedItemContext(selectedNodeIds, itemLabel, 24);

    return NextResponse.json(await runQuestionRouter({
      itemSearch,
      selectedNodeIds,
      graphQuery: typeof body.graphQuery === "string" ? body.graphQuery : undefined,
      graphScope: scope,
      graphMode: mode,
      userNote: typeof body.userNote === "string" ? body.userNote : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to auto-route questions" }, { status: 400 });
  }
}
