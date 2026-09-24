import { NextResponse } from "next/server";
import { graphFromCypher } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

/**
 * One-hop neighborhood of a projection node: the center plus every directly
 * connected projection node, with relationship types. Powers the focus view.
 *
 * NOTE: node ids are the Neo4j internal integer ids used by graphFromCypher
 * (graphology-neo4j @id), passed here as strings.
 */
export async function GET(request: Request) {
  try {
    const id = (new URL(request.url).searchParams.get("id") || "").trim();
    if (!id || !/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
    }
    const payload = await graphFromCypher(
      `MATCH (c:ProjectionNode)
       WHERE id(c) = toInteger($id)
       OPTIONAL MATCH (c)-[r]-(m:ProjectionNode)
       RETURN c, r, m
       LIMIT 200`,
      { id }
    );
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load neighborhood" },
      { status: 400 }
    );
  }
}
