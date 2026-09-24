import { NextResponse } from "next/server";
import { getHierarchy } from "@/lib/msgraphrag";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getHierarchy());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to query MsGraphRAG Neo4j" },
      { status: 400 },
    );
  }
}
