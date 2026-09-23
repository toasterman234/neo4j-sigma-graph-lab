import { NextResponse } from "next/server";
import { defaultGraph, graphFromCypher } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    const limit = Number(url.searchParams.get("limit") || "300");
    return NextResponse.json(query ? await graphFromCypher(query, { limit: Math.max(20, Math.min(500, Math.floor(limit))) }) : await defaultGraph(limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to query Neo4j" }, { status: 400 });
  }
}
