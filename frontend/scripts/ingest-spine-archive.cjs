#!/usr/bin/env node
/**
 * ingest-spine-archive.cjs — project spine_archive's work_items, decisions,
 * artifacts, and documents into Neo4j as a queryable projection.
 * Ben's call 2026-09-23: "Just the work items, decisions, artifacts and docs."
 *
 * Source: Postgres spine_archive on this Mac, read via the read-only
 * spine_ro role. The dumps are produced first by dump-spine-archive.sh
 * (this script only reads /tmp/spine-dump/*.json); Postgres is never
 * written to.
 *
 * Target: the SAME neo4j database as the other projections. Every ingested
 * node carries :ProjectionNode:SpineRecord and `_projection =
 * 'spine-archive'` (+ the stable `_fid`), so this layer can be filtered,
 * excluded, or wiped without touching anything else:
 *     MATCH (n:ProjectionNode) WHERE n._projection='spine-archive' DETACH DELETE n
 *
 * Deterministic edges ONLY (no Jev, no invented relationships — every edge
 * comes from a Postgres foreign key or an explicit grouping):
 *   - (root)-[:CONTAINS]->(area)            document areas
 *   - (area)-[:CONTAINS]->(document)        doc membership
 *   - (root)-[:CONTAINS]->(work item|decision|artifact)
 *   - (work item)-[:SUBTASK_OF]->(work item) parent_work_item_id FK
 *   - (decision)-[:SUPERSEDES]->(decision)  supersedes_id FK
 *   - (artifact)-[:OF_WORK_ITEM]->(work item) work_item_id FK
 *
 * The browser API stays read-only; this script is the only write path
 * for the spine-archive projection.
 *
 * Usage:
 *   node scripts/ingest-spine-archive.cjs [--dry-run] [--no-wipe]
 *       [--dump-dir <path>] [--projection <name>]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

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
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const DUMP_DIR = path.resolve(opt("--dump-dir", "/tmp/spine-dump"));
const PROJECTION = opt("--projection", "spine-archive");
const MAX_META_CHARS = 20000;

const scalar = (v) => (v === null || v === undefined ? "" : String(v));
const jsonStr = (v) => {
  try {
    const s = JSON.stringify(v ?? {});
    return s.length > MAX_META_CHARS ? s.slice(0, MAX_META_CHARS) : s;
  } catch {
    return "{}";
  }
};
const base = (p) => String(p || "").split("/").pop();

function load(name) {
  const rows = JSON.parse(
    fs.readFileSync(path.join(DUMP_DIR, name + ".json"), "utf8")
  );
  return Array.isArray(rows) ? rows : [];
}

async function main() {
  const workItems = load("work_items");
  const decisions = load("decisions");
  const artifacts = load("artifacts");
  const documents = load("documents");

  const nodeRows = [];
  const edgeRows = [];
  const add = (n) => nodeRows.push(n);
  const edge = (from, to, type) => edgeRows.push({ from, to, type });

  const summary = {
    projection: PROJECTION,
    workItems: workItems.length,
    decisions: decisions.length,
    artifacts: artifacts.length,
    documents: documents.length,
    truncatedTexts: 0,
  };

  add({
    fid: "spine:root",
    kind: "Spine archive",
    title: "spine_archive",
    text: "Archived agent work history (Postgres spine_archive): work items, decisions, artifacts, documents.",
  });

  // ---- work items ----
  const wiFid = (id) => `spine:wi:${id}`;
  for (const w of workItems) {
    if (w.truncated) summary.truncatedTexts++;
    add({
      fid: wiFid(w.id),
      kind: "Work item",
      title: w.title || w.id,
      text: w.text || "",
      status: scalar(w.status),
      priority: scalar(w.priority),
      project_id: scalar(w.project_id),
      phase_id: scalar(w.phase_id),
      claimed_by: scalar(w.claimed_by),
      created_at: scalar(w.created_at),
      updated_at: scalar(w.updated_at),
      started_at: scalar(w.started_at),
      completed_at: scalar(w.completed_at),
      truncated: !!w.truncated,
      metadata_json: jsonStr(w.metadata),
    });
  }
  for (const w of workItems) {
    if (w.parent_work_item_id) {
      edge(wiFid(w.id), wiFid(w.parent_work_item_id), "SUBTASK_OF");
    } else {
      edge("spine:root", wiFid(w.id), "CONTAINS");
    }
  }

  // ---- decisions ----
  const decFid = (id) => `spine:dec:${id}`;
  for (const d of decisions) {
    add({
      fid: decFid(d.id),
      kind: "Decision",
      title: d.title || d.id,
      text: d.text || "",
      status: scalar(d.status),
      ref: scalar(d.ref),
      rationale: d.rationale || "",
      consequence: d.consequence || "",
      decided_at: scalar(d.decided_at),
      source_ref: scalar(d.source_ref),
      project_id: scalar(d.project_id),
      created_by: scalar(d.created_by),
      created_at: scalar(d.created_at),
      metadata_json: jsonStr(d.metadata),
    });
    edge("spine:root", decFid(d.id), "CONTAINS");
    if (d.supersedes_id) edge(decFid(d.id), decFid(d.supersedes_id), "SUPERSEDES");
  }

  // ---- artifacts ----
  const artFid = (id) => `spine:art:${id}`;
  for (const a of artifacts) {
    add({
      fid: artFid(a.id),
      kind: "Artifact",
      title: a.title || a.id,
      text: a.text || "",
      artifact_kind: scalar(a.kind),
      ref: scalar(a.ref),
      project_id: scalar(a.project_id),
      created_by: scalar(a.created_by),
      created_at: scalar(a.created_at),
      metadata_json: jsonStr(a.metadata),
    });
    edge("spine:root", artFid(a.id), "CONTAINS");
    if (a.work_item_id) edge(artFid(a.id), wiFid(a.work_item_id), "OF_WORK_ITEM");
  }

  // ---- documents (grouped by area) ----
  const docFid = (repo, p) => `spine:doc:${repo}:${p}`;
  const areaFid = (a) => `spine:area:${a}`;
  const areas = new Set();
  for (const d of documents) {
    const area = d.area || "uncategorized";
    areas.add(area);
    if (d.truncated) summary.truncatedTexts++;
    const fm = d.frontmatter || {};
    const title = fm.title || fm.name || base(d.path) || d.path;
    add({
      fid: docFid(d.repo, d.path),
      kind: "Document",
      title: String(title).slice(0, 200),
      text: d.text || "",
      repo: scalar(d.repo),
      path: scalar(d.path),
      area,
      format: scalar(d.format),
      sha256: scalar(d.sha256),
      bytes: Number(d.bytes) || 0,
      first_seen_at: scalar(d.first_seen_at),
      last_changed_at: scalar(d.last_changed_at),
      truncated: !!d.truncated,
      frontmatter_json: jsonStr(d.frontmatter),
    });
    edge(areaFid(area), docFid(d.repo, d.path), "CONTAINS");
  }
  for (const area of [...areas].sort()) {
    add({
      fid: areaFid(area),
      kind: "Area",
      title: area,
      text: `Document area in spine_archive: ${area}`,
    });
    edge("spine:root", areaFid(area), "CONTAINS");
  }
  summary.areas = areas.size;

  summary.nodes = nodeRows.length;
  summary.edges = edgeRows.length;

  if (DRY_RUN) {
    console.log("DRY RUN — no writes.");
    console.log(
      JSON.stringify(
        {
          ...summary,
          sampleTitles: nodeRows
            .filter((n) => n.kind === "Work item")
            .slice(0, 5)
            .map((n) => n.title),
        },
        null,
        2
      )
    );
    return;
  }

  const neo4j = require("neo4j-driver");
  const env = loadEnv();
  const driver = neo4j.driver(
    env.NEO4J_URI || "bolt://zimaos:17687",
    neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
  );
  const db = env.NEO4J_DATABASE || "neo4j";
  const session = driver.session({ database: db });
  const B = 200;

  try {
    if (!NO_WIPE) {
      console.log(`wiping previous ${PROJECTION} projection…`);
      await session.run(
        "MATCH (n:ProjectionNode) WHERE n._projection = $proj DETACH DELETE n",
        { proj: PROJECTION }
      );
    }

    for (let i = 0; i < nodeRows.length; i += B) {
      await session.run(
        `UNWIND $rows AS r MERGE (n:ProjectionNode { _fid: r.fid })
         SET n:SpineRecord,
             n._projection = $proj, n.kind = r.kind,
             n.title = r.title, n.text = r.text,
             n.status = r.status, n.priority = r.priority,
             n.project_id = r.project_id, n.phase_id = r.phase_id,
             n.claimed_by = r.claimed_by, n.created_by = r.created_by,
             n.created_at = r.created_at, n.updated_at = r.updated_at,
             n.started_at = r.started_at, n.completed_at = r.completed_at,
             n.decided_at = r.decided_at,
             n.ref = r.ref, n.rationale = r.rationale,
             n.consequence = r.consequence, n.source_ref = r.source_ref,
             n.artifact_kind = r.artifact_kind,
             n.repo = r.repo, n.path = r.path, n.area = r.area,
             n.format = r.format, n.sha256 = r.sha256, n.bytes = r.bytes,
             n.first_seen_at = r.first_seen_at,
             n.last_changed_at = r.last_changed_at,
             n.truncated = r.truncated,
             n.metadata_json = r.metadata_json,
             n.frontmatter_json = r.frontmatter_json`,
        { rows: nodeRows.slice(i, i + B), proj: PROJECTION }
      );
    }
    console.log("spine nodes ingested:", summary.nodes);

    const byType = new Map();
    for (const e of edgeRows) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    let created = 0;
    for (const [type, rows] of byType) {
      for (let i = 0; i < rows.length; i += B) {
        const res = await session.run(
          `UNWIND $rows AS e
           MATCH (a:ProjectionNode { _fid: e.from }), (b:ProjectionNode { _fid: e.to })
           MERGE (a)-[r:${type}]->(b)
           SET r._projection = $proj`,
          { rows: rows.slice(i, i + B), proj: PROJECTION }
        );
        created += res.summary.counters.updates().relationshipsCreated;
      }
      console.log(`  ${type}: ${rows.length} rows`);
    }
    summary.edgesCreated = created;

    const dang = await session.run(
      `UNWIND $rows AS e
       OPTIONAL MATCH (a:ProjectionNode { _fid: e.from })
       OPTIONAL MATCH (b:ProjectionNode { _fid: e.to })
       RETURN sum(CASE WHEN a IS NULL OR b IS NULL THEN 1 ELSE 0 END) AS missing`,
      { rows: edgeRows }
    );
    const missing = Number(dang.records[0].get("missing") || 0);
    if (missing) console.log(`  ${missing} dangling refs skipped`);

    const counts = await session.run(
      `MATCH (n:ProjectionNode) WHERE n._projection = $proj
       RETURN n.kind AS kind, count(*) AS c ORDER BY c DESC`,
      { proj: PROJECTION }
    );
    console.log(
      "counts:",
      counts.records.map((r) => `${r.get("kind")}=${r.get("c")}`).join(" ")
    );

    console.log("INGEST COMPLETE", JSON.stringify(summary));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((e) => {
  console.error("INGEST FAILED:", e.message);
  process.exit(1);
});
