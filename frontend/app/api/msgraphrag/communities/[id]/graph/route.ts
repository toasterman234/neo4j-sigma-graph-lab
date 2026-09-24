import { NextResponse } from "next/server";
import { communityGraph } from "@/lib/msgraphrag";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || "160");
    return NextResponse.json(await communityGraph(decodeURIComponent(id), limit));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to query MsGraphRAG Neo4j" },
      { status: 400 },
    );
  }
}
