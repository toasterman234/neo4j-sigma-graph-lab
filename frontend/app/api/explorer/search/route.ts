import { NextResponse } from "next/server";
import { searchNodes } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ results: [] });
    return NextResponse.json({ results: await searchNodes(q, Number(url.searchParams.get("limit") || "40")) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to search Neo4j" }, { status: 400 });
  }
}
