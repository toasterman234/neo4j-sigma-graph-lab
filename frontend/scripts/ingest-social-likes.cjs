#!/usr/bin/env node
/**
 * ingest-social-likes.cjs — project Ben's Twitter/X likes and YouTube liked
 * videos into Neo4j as queryable projection layers.
 *
 * Sources (read-only walks; the canonical store stays the source of truth):
 *   ~/.life/canonical/twitter/*.jsonld   — items with life:TweetLike (987)
 *   ~/.life/canonical/youtube/2026-07-19.jsonld — life:YouTubeLikedVideo (567)
 *
 * Target: the SAME neo4j database as the other projections. Every node
 * carries :ProjectionNode plus :TwitterLike / :YouTubeLike and
 * `_projection='twitter-likes'` / `_projection='youtube-likes'` (+ stable
 * `_fid`), so each layer can be filtered, excluded, or wiped without
 * touching the baseline Bedrock data or any other projection:
 *     MATCH (n:ProjectionNode) WHERE n._projection='twitter-likes' DETACH DELETE n
 *
 * Idempotent: MERGE on _fid. Default wipes the two layers first and
 * re-ingests (--no-wipe to merge into existing).
 *
 * Search contract (matches /api/explore/search): nodes expose title, text,
 * kind, date, url.
 *
 * Usage:
 *   node scripts/ingest-social-likes.cjs [--dry-run] [--no-wipe]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const neo4j = require("neo4j-driver");

const REPO_ROOT = path.join(__dirname, "..", "..");
const LIFE = path.join(os.homedir(), ".life", "canonical");

function loadEnv() {
  const env = {};
  const p = path.join(REPO_ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const NO_WIPE = argv.includes("--no-wipe");

const fid = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const trunc = (s, n) => (s || "").length > n ? (s || "").slice(0, n - 1) + "…" : (s || "");

function readJsonldDir(dir) {
  const items = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".jsonld")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const arr = Array.isArray(d) ? d : d["@graph"] || d.items || [];
    for (const it of arr) items.push(it);
  }
  return items;
}

function twitterLikes() {
  const items = readJsonldDir(path.join(LIFE, "twitter"));
  const out = [];
  for (const it of items) {
    const types = it["@type"] || [];
    if (!types.includes("life:TweetLike")) continue;
    const text = it["schema:text"] || "";
    out.push({
      _fid: "twlike-" + fid(it["@id"] || it["life:tweetId"] || text.slice(0, 64)),
      _projection: "twitter-likes",
      kind: "Twitter like",
      title: trunc(text.replace(/\s+/g, " "), 90) || ("tweet " + (it["life:tweetId"] || "")),
      text,
      url: it["life:expandedUrl"] || "",
      tweetId: it["life:tweetId"] || "",
      date: "",
      source: it["life:source"] || "Twitter/X export",
    });
  }
  return out;
}

function youtubeLikes() {
  const f = path.join(LIFE, "youtube", "2026-07-19.jsonld");
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const arr = Array.isArray(d) ? d : d["@graph"] || d.items || [];
  const out = [];
  for (const it of arr) {
    const types = it["@type"] || [];
    if (!types.includes("life:YouTubeLikedVideo")) continue;
    const name = it["schema:name"] || "";
    const channel = it["life:channelTitle"] || "";
    const desc = it["schema:description"] || "";
    const vid = it["life:youtubeVideoId"] || "";
    out.push({
      _fid: "ytlike-" + fid(it["@id"] || vid || name.slice(0, 64)),
      _projection: "youtube-likes",
      kind: "YouTube like",
      title: trunc(name, 120),
      text: [name, channel ? "Channel: " + channel : "", trunc(desc, 1500)]
        .filter(Boolean).join("\n"),
      url: vid ? "https://www.youtube.com/watch?v=" + vid : "",
      videoId: vid,
      channel,
      date: "",
      source: "youtube",
    });
  }
  return out;
}

(async () => {
  const tw = twitterLikes();
  const yt = youtubeLikes();
  console.log(`twitter likes: ${tw.length}, youtube likes: ${yt.length}`);
  if (DRY_RUN) { console.log("dry run — no writes"); return; }

  const env = loadEnv();
  const driver = neo4j.driver(
    env.NEO4J_URI || "bolt://zimaos:17687",
    neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
  );
  const session = driver.session({ database: env.NEO4J_DATABASE || "neo4j" });
  try {
    for (const proj of ["twitter-likes", "youtube-likes"]) {
      if (!NO_WIPE) {
        const r = await session.run(
          "MATCH (n:ProjectionNode) WHERE n._projection=$p DETACH DELETE n",
          { p: proj }
        );
        console.log(`wiped ${proj}: ${r.summary.counters.updates().nodesDeleted} nodes`);
      }
    }
    const batches = [
      { label: "TwitterLike", rows: tw },
      { label: "YouTubeLike", rows: yt },
    ];
    for (const b of batches) {
      if (!b.rows.length) continue;
      await session.run(
        `UNWIND $rows AS r MERGE (n:ProjectionNode:${b.label} {_fid: r._fid})
         SET n += r`,
        { rows: b.rows }
      );
      console.log(`merged ${b.rows.length} :${b.label}`);
    }
    for (const proj of ["twitter-likes", "youtube-likes"]) {
      const r = await session.run(
        "MATCH (n:ProjectionNode) WHERE n._projection=$p RETURN count(n) AS c", { p: proj });
      console.log(`verify ${proj}: ${r.records[0].get("c").toString()} nodes`);
    }
  } finally {
    await session.close();
    await driver.close();
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
