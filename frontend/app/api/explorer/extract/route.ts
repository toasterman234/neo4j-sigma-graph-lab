import { NextResponse } from "next/server";
import { extractSelectedKnowledge } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { selectedNodeIds?: string[] };
    const selectedNodeIds = Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds.slice(0, 20) : [];
    if (!selectedNodeIds.length) {
      return NextResponse.json({ error: "Select a document/source or graph object before extracting knowledge" }, { status: 400 });
    }
    return NextResponse.json(await extractSelectedKnowledge(selectedNodeIds));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to extract selected knowledge" }, { status: 400 });
  }
}
