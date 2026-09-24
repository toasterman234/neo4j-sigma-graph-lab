import { NextResponse } from "next/server";
import { getCommunity } from "@/lib/msgraphrag";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const community = await getCommunity(decodeURIComponent(id));
    if (!community) return NextResponse.json({ error: "Community not found" }, { status: 404 });
    return NextResponse.json(community);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to query MsGraphRAG Neo4j" },
      { status: 400 },
    );
  }
}
