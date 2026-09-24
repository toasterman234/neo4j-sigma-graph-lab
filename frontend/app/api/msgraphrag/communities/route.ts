import { NextResponse } from "next/server";
import { listCommunities } from "@/lib/msgraphrag";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const levelRaw = url.searchParams.get("level");
    const level = levelRaw === null || levelRaw === "" ? null : Number(levelRaw);
    const limit = Number(url.searchParams.get("limit") || "25");
    const offset = Number(url.searchParams.get("offset") || "0");
    const summarizedOnly = url.searchParams.get("summarized") === "1";
    if (level !== null && (!Number.isInteger(level) || level < 0 || level > 3)) {
      return NextResponse.json({ error: "level must be 0-3" }, { status: 400 });
    }
    return NextResponse.json(await listCommunities({ q, level, limit, offset, summarizedOnly }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to query MsGraphRAG Neo4j" },
      { status: 400 },
    );
  }
}
