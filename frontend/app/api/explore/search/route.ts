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
 *
 * Params: q (keyword; empty = most recent), kind (optional kind filter),
 * limit (1..80, default 40).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    // Any kind value is accepted; it is passed as a Cypher parameter, never
    // interpolated, so this is injection-safe.
    const kind = (url.searchParams.get("kind") || "").trim().slice(0, 60);
    const limit = Math.max(1, Math.min(80, Math.floor(Number(url.searchParams.get("limit") || "40"))));
    const kindFilter = kind
      ? `AND CASE WHEN 'MuseNote' IN labels(n) THEN 'MuseNote' ELSE coalesce(n.kind, 'Note') END = $kind`
      : "";
    const cypher = q
      ? `MATCH (n:ProjectionNode)
         WHERE (toLower(coalesce(n.title, '')) CONTAINS toLower($q)
            OR toLower(coalesce(n.text, '')) CONTAINS toLower($q))
         ${kindFilter}
         RETURN n
         ORDER BY coalesce(n.date, '') DESC
         LIMIT $limit`
      : `MATCH (n:ProjectionNode)
         WHERE true ${kindFilter}
         RETURN n
         ORDER BY coalesce(n.date, '') DESC
         LIMIT $limit`;
    const payload = await graphFromCypher(cypher, { q, kind, limit });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to search notes" },
      { status: 400 }
    );
  }
}
