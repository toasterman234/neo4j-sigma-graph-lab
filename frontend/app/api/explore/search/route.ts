import { NextResponse } from "next/server";
import { graphFromCypher } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

/**
 * Keyword search scoped to the notes projection only.
 *
 * The shared /api/explorer/search scans every property of every node with
 * toString(), which throws on the vault mirror's list-valued properties.
 * Projection nodes only carry scalar props (guaranteed by the ingest
 * script), so this scoped search is crash-free and noise-free.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ nodes: [], relationships: [], counts: { nodes: 0, relationships: 0 } });
    const limit = Math.max(1, Math.min(80, Math.floor(Number(url.searchParams.get("limit") || "40"))));
    const payload = await graphFromCypher(
      `MATCH (n:ProjectionNode)
       WHERE toLower(coalesce(n.title, '')) CONTAINS toLower($q)
          OR toLower(coalesce(n.text, '')) CONTAINS toLower($q)
       RETURN n
       LIMIT $limit`,
      { q, limit }
    );
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to search notes" },
      { status: 400 }
    );
  }
}
