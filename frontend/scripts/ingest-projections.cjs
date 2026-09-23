#!/usr/bin/env node
/**
 * ingest-projections.cjs — ingest personal-notes projections into Neo4j.
 *
 * Sources (all read-only; nothing here is a source of truth):
 *   1. Foundation governed snapshot (TerminusDB admin/foundation) via the
 *      VPS graph-viewer API over the Mac's ovhvps SSH hop.
 *   2. Muse notes from the synced memory tree (~/muse-sync/memory on the Mac).
 *
 * Target: the SAME neo4j database as the vault mirror. Every ingested node
 * carries :ProjectionNode (+ :FoundationNode / :MuseNoteNote source marker),
 * `_projection` and the original id, so the projection can be filtered,
 * excluded, or wiped without touching the baseline Bedrock data:
 *     MATCH (n:ProjectionNode) DETACH DELETE n
 *
 * The browser API stays read-only; this script is the only write path.
 *
 * Usage:
 *   node scripts/ingest-projections.cjs [--dry-run] [--no-wipe]
 *       [--foundation-json PATH] [--memory-dir PATH]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FRONTEND_DIR = path.resolve(__dirname, "..");

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
const FOUNDATION_JSON = opt("--foundation-json", null);
const MEMORY_DIR = opt(
  "--memory-dir",
  path.join(os.homedir(), "muse-sync", "memory")
);

const sanitizeLabel = (s) =>
  String(s || "").replace(/[^A-Za-z0-9]/g, "") || "ProjectionThing";
const sanitizeRel = (s) => {
  const t = String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return t || "RELATED_TO";
};

function fetchFoundation() {
  if (FOUNDATION_JSON) {
    console.log("reading foundation snapshot from", FOUNDATION_JSON);
    return JSON.parse(fs.readFileSync(FOUNDATION_JSON, "utf8"));
  }
  console.log("fetching foundation governed snapshot via ovhvps hop…");
  const out = execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "ovhvps",
      "curl -s -m 90 http://127.0.0.1:8091/api/foundation/canvas",
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(out.toString("utf8"));
}

function splitSections(text) {
  // Split markdown into ## sections; preamble becomes its own section.
  const parts = text.split(/^##\s+/m);
  const sections = [];
  const pre = parts[0].trim();
  if (pre) sections.push({ title: "(intro)", body: pre });
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i].indexOf("\n");
    const title = (nl >= 0 ? parts[i].slice(0, nl) : parts[i]).trim();
    const body = (nl >= 0 ? parts[i].slice(nl + 1) : "").trim();
    if (title || body) sections.push({ title: title || "(untitled)", body });
  }
  // merge splinter sections (<300 chars of body) into the previous one
  const merged = [];
  for (const s of sections) {
    if (merged.length && s.body.length < 300) {
      merged[merged.length - 1].body += "\n\n" + s.body;
    } else merged.push(s);
  }
  return merged;
}

function collectMuseNotes() {
  const notes = [];
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log("memory dir not found, skipping muse notes:", MEMORY_DIR);
    return notes;
  }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["bank", "index", "node_modules"].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith(".md")) files.push(p);
    }
  };
  walk(MEMORY_DIR);
  for (const f of files.sort()) {
    const rel = path.relative(MEMORY_DIR, f);
    const text = fs.readFileSync(f, "utf8");
    const dateM = rel.match(/(20\d\d-\d\d-\d\d)/);
    const date = dateM ? dateM[1] : null;
    const sections = splitSections(text);
    if (sections.length <= 1) {
      notes.push({
        fid: "muse:" + rel,
        title: rel,
        text: text.slice(0, 8000),
        date,
        source_file: rel,
      });
    } else {
      sections.forEach((s, i) => {
        notes.push({
          fid: `muse:${rel}#${i}`,
          title: `${rel} — ${s.title}`.slice(0, 200),
          text: s.body.slice(0, 8000),
          date,
          source_file: rel,
        });
      });
    }
  }
  return notes;
}

async function main() {
  const env = loadEnv();
  const neo4j = require(
    path.join(FRONTEND_DIR, "node_modules", "neo4j-driver")
  );
  const driver = neo4j.driver(
    env.NEO4J_URI || "bolt://zimaos:17687",
    neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
  );
  const db = env.NEO4J_DATABASE || "neo4j";
  const session = driver.session({ database: db });

  const summary = { foundationNodes: 0, foundationEdges: 0, superseded: 0, museNotes: 0, skippedEdges: 0 };

  try {
    const snap = fetchFoundation();
    const fnodes = snap.nodes || [];
    const fedges = snap.edges || snap.links || [];
    console.log(`foundation snapshot: ${fnodes.length} nodes, ${fedges.length} edges`);

    const museNotes = collectMuseNotes();
    console.log(`muse notes: ${museNotes.length} sections from ${MEMORY_DIR}`);

    if (DRY_RUN) {
      console.log("DRY RUN — no writes.");
      console.log(JSON.stringify({ ...summary, foundationNodes: fnodes.length, foundationEdges: fedges.length, museNotes: museNotes.length }, null, 2));
      return;
    }

    if (!NO_WIPE) {
      console.log("wiping previous projection…");
      await session.run("MATCH (n:ProjectionNode) DETACH DELETE n");
    }

    // --- foundation nodes ---
    const B = 200;
    for (let i = 0; i < fnodes.length; i += B) {
      const batch = fnodes.slice(i, i + B).map((n) => ({
        fid: n.id,
        label: sanitizeLabel(n.kind),
        title: n.title || n.id,
        text: (n.notes || "").slice(0, 12000),
        kind: n.kind || null,
        obj_type: n.obj_type || null,
        status: n.status || null,
        owner: n.owner || null,
        done_when: n.done_when || null,
        priority: n.priority || null,
        tier: n.tier || null,
        parent: n.parent || null,
        orphan: !!n.orphan,
      }));
      // one query per distinct label in the batch (labels can't be parameterized)
      const byLabel = new Map();
      for (const r of batch) {
        if (!byLabel.has(r.label)) byLabel.set(r.label, []);
        byLabel.get(r.label).push(r);
      }
      for (const [label, rows] of byLabel) {
        await session.run(
          `UNWIND $rows AS r MERGE (n:ProjectionNode { _fid: r.fid })
           SET n:FoundationNode:\`${label}\`,
               n._projection = 'foundation', n.title = r.title, n.text = r.text,
               n.kind = r.kind, n.obj_type = r.obj_type, n.status = r.status,
               n.owner = r.owner, n.done_when = r.done_when, n.priority = r.priority,
               n.tier = r.tier, n.parent = r.parent, n.orphan = r.orphan`,
          { rows }
        );
      }
      summary.foundationNodes += batch.length;
    }
    console.log("foundation nodes ingested:", summary.foundationNodes);

    // --- foundation edges (grouped by rel type; Neo4j needs static types) ---
    const edgeRows = fedges
      .map((e) => ({ from: e.from, to: e.to, type: sanitizeRel(e.label) }))
      .filter((e) => e.from && e.to);
    const byType = new Map();
    for (const e of edgeRows) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    for (const [type, rows] of byType) {
      for (let i = 0; i < rows.length; i += B) {
        const res = await session.run(
          `UNWIND $rows AS e
           MATCH (a:ProjectionNode { _fid: e.from }), (b:ProjectionNode { _fid: e.to })
           MERGE (a)-[r:\`${type}\`]->(b)
           SET r._projection = 'foundation'`,
          { rows: rows.slice(i, i + B) }
        );
        summary.foundationEdges += res.summary.counters.updates().relationshipsCreated;
      }
      // count dangling refs
      const dang = await session.run(
        `UNWIND $rows AS e
         OPTIONAL MATCH (a:ProjectionNode { _fid: e.from })
         OPTIONAL MATCH (b:ProjectionNode { _fid: e.to })
         RETURN count(*) AS total, sum(CASE WHEN a IS NULL OR b IS NULL THEN 1 ELSE 0 END) AS missing`,
        { rows }
      );
      summary.skippedEdges += Number(dang.records[0].get("missing") || 0);
    }
    console.log("foundation relationships created:", summary.foundationEdges,
      "| skipped (dangling):", summary.skippedEdges);

    // --- supersession from `replaces` ---
    const supRows = fnodes.filter((n) => n.replaces).map((n) => ({ id: n.id, replaces: n.replaces }));
    for (let i = 0; i < supRows.length; i += B) {
      const res = await session.run(
        `UNWIND $rows AS r
         MATCH (older:ProjectionNode { _fid: r.replaces }), (newer:ProjectionNode { _fid: r.id })
         MERGE (older)-[s:SUPERSEDED_BY]->(newer)
         SET s._projection = 'foundation'`,
        { rows: supRows.slice(i, i + B) }
      );
      summary.superseded += res.summary.counters.updates().relationshipsCreated;
    }
    console.log("SUPERSEDED_BY edges:", summary.superseded);

    // --- muse notes ---
    for (let i = 0; i < museNotes.length; i += B) {
      await session.run(
        `UNWIND $rows AS r MERGE (n:ProjectionNode { _fid: r.fid })
         SET n:MuseNote, n._projection = 'muse-notes', n.title = r.title,
             n.text = r.text, n.date = r.date, n.source_file = r.source_file`,
        { rows: museNotes.slice(i, i + B) }
      );
    }
    summary.museNotes = museNotes.length;
    console.log("muse notes ingested:", summary.museNotes);

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
