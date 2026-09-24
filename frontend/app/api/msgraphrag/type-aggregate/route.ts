import { NextResponse } from "next/server";
import { getTypeAggregate } from "@/lib/msgraphrag";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getTypeAggregate());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to query MsGraphRAG Neo4j" },
      { status: 400 },
    );
  }
}
