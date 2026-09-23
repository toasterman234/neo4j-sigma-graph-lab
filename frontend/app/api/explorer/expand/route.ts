import { NextResponse } from "next/server";
import { expandNode } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId");
    if (!nodeId) return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    return NextResponse.json(await expandNode(nodeId, Number(url.searchParams.get("limit") || "120")));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to expand Neo4j node" }, { status: 400 });
  }
}
