import { NextResponse } from "next/server";
import { assertReadOnly, getDriver, database } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const KIND_EXPR = `CASE WHEN 'MuseNote' IN labels(n) THEN 'MuseNote' ELSE coalesce(n.kind, 'Note') END`;

const KINDS_QUERY = `MATCH (n:ProjectionNode) WITH ${KIND_EXPR} AS kind, count(*) AS count RETURN kind, count ORDER BY count DESC`;

// Richest non-telemetry foundation node — a good starting focus for the graph.
// NOTE: ids here are Neo4j internal integer ids, matching the payload ids
// produced by graphFromCypher (graphology-neo4j @id).
const FOCUS_QUERY = `MATCH (n:ProjectionNode)-[r]-(:ProjectionNode)
WHERE n.kind = 'Thought'
RETURN id(n) AS id, count(r) AS degree ORDER BY degree DESC LIMIT 1`;

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof (v as { toNumber?: unknown }).toNumber === "function")
    return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    assertReadOnly(KINDS_QUERY);
    assertReadOnly(FOCUS_QUERY);
    const session = getDriver().session({ database: database() });
    try {
      const kindsRes = await session.run(KINDS_QUERY);
      const kinds = kindsRes.records.map((rec) => ({
        kind: String(rec.get("kind")),
        count: num(rec.get("count")) ?? 0,
      }));
      const focusRes = await session.run(FOCUS_QUERY);
      const raw = focusRes.records.length ? focusRes.records[0].get("id") : null;
      const n = num(raw);
      const suggestedFocus = n == null ? null : String(n);
      return NextResponse.json({ kinds, suggestedFocus });
    } finally {
      await session.close();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load kinds" },
      { status: 400 }
    );
  }
}
