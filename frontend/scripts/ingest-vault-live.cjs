#!/usr/bin/env node
/**
 * ingest-vault-live.cjs — ingest Ben's live Obsidian vault into Neo4j
 * as a queryable projection.
 *
 * Source: the live vault on this Mac (read-only walk; nothing here is a
 * source of truth). vault-v2-mirror on ZimaOS is deliberately excluded
 * (Ben's call, 2026-09-23).
 *
 * Target: the SAME neo4j database as the vault mirror + the existing
 * notes projection. Every ingested node carries :ProjectionNode:VaultNote
 * and `_projection='vault-live'` (+ the stable `_fid`), so this layer can
 * be filtered, excluded, or wiped without touching the baseline Bedrock
 * data OR the foundation/muse-notes projection:
 *     MATCH (n:ProjectionNode) WHERE n._projection='vault-live' DETACH DELETE n
 *
 * Deterministic edges ONLY (no Jev, no invented relationships):
 *   - (folder)-[:CONTAINS]->(doc)-[:CONTAINS]->(section)   structure
 *   - (doc)-[:RELATED_TO]->(doc)                          [[wikilinks]] that resolve
 *   - (older)-[:SUPERSEDED_BY]->(newer)                    explicit "superseded by [[X]]"
 *   - foundation supersession is intentionally NOT backfilled: the governed
 *     canvas snapshot excludes superseded nodes by design (all 26 `replaces`
 *     targets are absent from the snapshot itself, verified 2026-09-23), so
 *     there are no old endpoints to link; becomes-chains are already merged
 *     into the version family by the snapshot.
 *
 * The browser API stays read-only; this script is the only write path
 * for the vault-live projection.
 *
 * Usage:
 *   node scripts/ingest-vault-live.cjs [--dry-run] [--no-wipe]
 *       [--vault-dir PATH]
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
// NOTE: the vault dir uses a curly apostrophe (Ben’s Vault, U+2019).
const VAULT_DIR = opt(
  "--vault-dir",
  path.join(
    os.homedir(),
    "Library",
    "Mobile Documents",
    "iCloud~md~obsidian",
    "Documents",
    "Ben’s Vault"
  )
);

function splitSections(text) {
  // Split markdown into ## sections; preamble becomes its own section.
  // (Same approach as ingest-projections.cjs for consistent chunking.)
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

function collectVaultDocs(vaultDir) {
  const docs = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue; // skip .obsidian, .trash, etc.
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.name.toLowerCase().endsWith(".md")) continue;
      const rel = path.relative(vaultDir, p).split(path.sep).join("/");
      const segs = rel.split("/");
      const folder = segs.length > 1 ? segs[0] : "(root)";
      const name = segs[segs.length - 1].replace(/\.md$/i, "");
      const st = fs.statSync(p);
      let text;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      docs.push({
        rel,
        folder,
        name,
        title: name,
        text,
        mtime: st.mtime.toISOString(),
        size: st.size,
      });
    }
  };
  walk(vaultDir);
  docs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return docs;
}

// [[Target]], [[Target#heading]], [[Target|alias]], [[path/Target]]
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
function extractWikilinks(text) {
  const out = [];
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(text))) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

// Explicit supersession markers only: "superseded by [[X]]" (also
// "obsoleted by" / "replaced by"). The doc containing the marker is older.
const SUPERSEDE_RE =
  /(?:superseded|obsoleted|replaced)\s+by\s+\[\[([^\]]+)\]\]/gi;
function extractSupersession(text) {
  const out = [];
  SUPERSEDE_RE.lastIndex = 0;
  let m;
  while ((m = SUPERSEDE_RE.exec(text))) {
    const t = m[1].split("#")[0].split("|")[0].trim();
    if (t) out.push(t);
  }
  return out;
}

function buildNameIndex(docs) {
  const byBase = new Map(); // lower basename -> docs[]
  const byPath = new Map(); // lower rel-without-ext -> doc
  for (const d of docs) {
    const b = d.name.toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(d);
    byPath.set(d.rel.replace(/\.md$/i, "").toLowerCase(), d);
  }
  return { byBase, byPath };
}

function resolveWikilink(target, fromDoc, idx) {
  const cl = target.split("#")[0].split("|")[0].trim().toLowerCase();
  if (!cl) return null;
  if (idx.byPath.has(cl)) {
    const d = idx.byPath.get(cl);
    return d.rel === fromDoc.rel ? null : d;
  }
  const cands = (idx.byBase.get(cl) || []).filter((d) => d.rel !== fromDoc.rel);
  if (!cands.length) return null;
  const same = cands.filter((d) => d.folder === fromDoc.folder);
  return same.length ? same[0] : cands[0];
}

function fetchFoundation() {
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

async function main() {
  const env = loadEnv();
  const neo4j = require(path.join(FRONTEND_DIR, "node_modules", "neo4j-driver"));

  const docs = collectVaultDocs(VAULT_DIR);
  console.log(`vault: ${docs.length} markdown files from ${VAULT_DIR}`);
  if (!docs.length) {
    console.error("no markdown files found — refusing to wipe. Aborting.");
    process.exit(1);
  }
  const folders = [...new Set(docs.map((d) => d.folder))].sort();
  console.log(`folders (${folders.length}): ${folders.join(", ")}`);

  const idx = buildNameIndex(docs);

  // --- build node rows ---
  const nodeRows = [];
  const edgeSet = new Set();
  const edgeRows = [];
  const addEdge = (from, to, type, tag) => {
    if (!from || !to || from === to) return;
    const k = `${from}|${type}|${to}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edgeRows.push({ from, to, type, tag });
  };

  const summary = {
    docs: docs.length,
    folders: folders.length,
    sections: 0,
    nodes: 0,
    containsEdges: 0,
    relatedEdges: 0,
    supersededEdges: 0,
    unresolvedWikilinks: 0,
    supersessionMarkers: 0,
  };

  for (const f of folders) {
    nodeRows.push({
      fid: `vault:folder:${f}`,
      level: "folder",
      kind: "VaultNote",
      title: f,
      text: "",
      folder: f,
      source_path: f,
      name: f,
      updated: null,
      size: null,
    });
  }

  let totalWikilinks = 0;
  for (const d of docs) {
    const docFid = `vault:doc:${d.rel}`;
    nodeRows.push({
      fid: docFid,
      level: "doc",
      kind: "VaultNote",
      title: d.title.slice(0, 200),
      text: d.text.slice(0, 12000),
      folder: d.folder,
      source_path: d.rel,
      name: d.name,
      updated: d.mtime,
      size: d.size,
    });
    addEdge(`vault:folder:${d.folder}`, docFid, "CONTAINS", "vault-live");

    const sections = splitSections(d.text);
    if (sections.length > 1) {
      sections.forEach((s, i) => {
        nodeRows.push({
          fid: `vault:sec:${d.rel}#${i}`,
          level: "section",
          kind: "VaultNote",
          title: `${d.title} — ${s.title}`.slice(0, 200),
          text: s.body.slice(0, 8000),
          folder: d.folder,
          source_path: d.rel,
          name: d.name,
          updated: d.mtime,
          size: d.size,
        });
        addEdge(docFid, `vault:sec:${d.rel}#${i}`, "CONTAINS", "vault-live");
      });
      summary.sections += sections.length;
    }

    // wikilinks -> RELATED_TO (only resolved targets; never invent)
    for (const target of extractWikilinks(d.text)) {
      totalWikilinks++;
      const resolved = resolveWikilink(target, d, idx);
      if (resolved) {
        addEdge(docFid, `vault:doc:${resolved.rel}`, "RELATED_TO", "vault-live");
      } else {
        summary.unresolvedWikilinks++;
      }
    }
    // explicit supersession markers -> SUPERSEDED_BY
    for (const target of extractSupersession(d.text)) {
      summary.supersessionMarkers++;
      const resolved = resolveWikilink(target, d, idx);
      if (resolved) {
        addEdge(docFid, `vault:doc:${resolved.rel}`, "SUPERSEDED_BY", "vault-live");
      } else {
        summary.unresolvedWikilinks++;
      }
    }
  }
  summary.nodes = nodeRows.length;

  // --- foundation supersession: intentionally NOT backfilled ---
  // The governed canvas snapshot merges `becomes` chains into the version
  // family and excludes superseded nodes by design. Verified 2026-09-23:
  // all 26 `replaces` targets are absent from the snapshot itself, so there
  // are no old endpoints to draw SUPERSEDED_BY edges between. Supersession
  // is already represented via the snapshot's becomes-chain merging. If
  // explicit chains are ever wanted in /explore, the snapshot scope (not
  // this script) is the place to widen.
  const snap = fetchFoundation();
  const replacesCount = (snap.nodes || []).filter((n) => n.replaces).length;
  console.log(
    `foundation snapshot: ${(snap.nodes || []).length} nodes, ${replacesCount} with replaces field (superseded targets excluded from snapshot by design — no backfill)`
  );

  if (DRY_RUN) {
    for (const e of edgeRows) {
      if (e.type === "CONTAINS") summary.containsEdges++;
      else if (e.type === "RELATED_TO") summary.relatedEdges++;
      else if (e.type === "SUPERSEDED_BY") summary.supersededEdges++;
    }
    console.log("DRY RUN — no writes.");
    console.log(
      JSON.stringify(
        {
          ...summary,
          totalWikilinkMentions: totalWikilinks,
        },
        null,
        2
      )
    );
    return;
  }

  const driver = neo4j.driver(
    env.NEO4J_URI || "bolt://zimaos:17687",
    neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
  );
  const db = env.NEO4J_DATABASE || "neo4j";
  const session = driver.session({ database: db });
  const B = 200;

  try {
    if (!NO_WIPE) {
      console.log("wiping previous vault-live projection…");
      await session.run(
        "MATCH (n:ProjectionNode) WHERE n._projection = 'vault-live' DETACH DELETE n"
      );
    }

    // --- vault nodes (all :ProjectionNode:VaultNote) ---
    for (let i = 0; i < nodeRows.length; i += B) {
      await session.run(
        `UNWIND $rows AS r MERGE (n:ProjectionNode { _fid: r.fid })
         SET n:VaultNote,
             n._projection = 'vault-live', n.level = r.level, n.kind = r.kind,
             n.title = r.title, n.text = r.text, n.folder = r.folder,
             n.source_path = r.source_path, n.name = r.name,
             n.updated = r.updated, n.size = r.size`,
        { rows: nodeRows.slice(i, i + B) }
      );
    }
    console.log("vault nodes ingested:", summary.nodes);

    // --- vault edges (grouped by type; Neo4j needs static types) ---
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
           SET r._projection = e.tag`,
          { rows: rows.slice(i, i + B) }
        );
        const created = res.summary.counters.updates().relationshipsCreated;
        if (type === "CONTAINS") summary.containsEdges += created;
        else if (type === "RELATED_TO") summary.relatedEdges += created;
        else if (type === "SUPERSEDED_BY") summary.supersededEdges += created;
      }
      const dang = await session.run(
        `UNWIND $rows AS e
         OPTIONAL MATCH (a:ProjectionNode { _fid: e.from })
         OPTIONAL MATCH (b:ProjectionNode { _fid: e.to })
         RETURN sum(CASE WHEN a IS NULL OR b IS NULL THEN 1 ELSE 0 END) AS missing`,
        { rows }
      );
      const missing = Number(dang.records[0].get("missing") || 0);
      if (missing) console.log(`  ${type}: ${missing} dangling refs skipped`);
    }

    // --- foundation supersession backfill ---
    // See above: intentionally not backfilled (superseded targets are
    // excluded from the governed snapshot by design).

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
