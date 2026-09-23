import { NextResponse } from "next/server";
import { draftModelProposals } from "@/lib/modelingProposals";
import { decideModelProposal, listModelProposals, type ProposalStatus } from "@/lib/proposalStore";
import type { SearchMode, SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";
const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);
const statuses = new Set<ProposalStatus>(["accepted", "rejected", "deferred"]);

export async function GET() {
  try { return NextResponse.json({ proposals: listModelProposals() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to list proposals" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; scope?: string; mode?: string; selectedNodeIds?: string[] };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
    const scope = scopes.has(body.scope as SearchScope) ? body.scope as SearchScope : "whole";
    const mode = modes.has(body.mode as SearchMode) ? body.mode as SearchMode : "keyword";
    return NextResponse.json(await draftModelProposals({ query, scope, mode, selectedNodeIds: body.selectedNodeIds?.slice(0, 20) }), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to draft proposals" }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; status?: string; note?: string };
    if (!body.id || !statuses.has(body.status as ProposalStatus)) return NextResponse.json({ error: "id and a valid decision status are required" }, { status: 400 });
    const proposal = decideModelProposal(body.id, body.status as ProposalStatus, body.note);
    if (!proposal) return NextResponse.json({ error: "proposal not found" }, { status: 404 });
    return NextResponse.json({ proposal });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to decide proposal" }, { status: 400 }); }
}
