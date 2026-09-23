#!/usr/bin/env node
/**
 * ingest-central-ops-docs.cjs — ingest ~/central-ops documentation & notes
 * into Neo4j as a queryable projection. Ben's call 2026-09-23: "Just docs
 * and notes, skip the code."
 *
 * Source: ~/central-ops on this Mac (read-only walk; the symlink to the
 * external SSD is resolved and walked). Included: Markdown, plain text,
 * RST, AsciiDoc, Org, README/TODO/PLAN/NOTES/CHANGELOG files. Excluded:
 * source code, configs, build artifacts, vendored deps (.git, node_modules,
 * target, dist, build, .next, __pycache__, .venv, venv, vendor at any depth),
 * and binaries.
 *
 * Target: the SAME neo4j database as the other projections. Every ingested
 * node carries :ProjectionNode:CentralOpsDoc and `_projection =
 * 'central-ops-docs'` (+ the stable `_fid`), so this layer can be filtered,
 * excluded, or wiped without touching anything else:
 *     MATCH (n:ProjectionNode) WHERE n._projection='central-ops-docs' DETACH DELETE n
 *
 * Deterministic edges ONLY (no Jev, no invented relationships):
 *   - (folder)-[:CONTAINS]->(folder)   directory nesting
 *   - (folder)-[:CONTAINS]->(doc)      doc membership
 *
 * The browser API stays read-only; this script is the only write path
 * for the central-ops-docs projection.
 *
 * Usage:
 *   node scripts/ingest-central-ops-docs.cjs [--dry-run] [--no-wipe]
 *       [--source-dir <path>] [--projection <name>] [--fid-prefix <prefix>]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

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

const SOURCE_DIR = path.resolve(
  opt("--source-dir", path.join(os.homedir(), "central-ops"))
);
const PROJECTION = opt("--projection", "central-ops-docs");
const FIDP = opt("--fid-prefix", "codocs");

const TEXT_EXTS = new Set(["md", "markdown", "txt", "rst", "adoc", "org"]);
const PROSE_BASENAMES = /^(readme|todo|plan|notes|changelog)(\..*)?$/i;
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "rb", "java",
  "c", "h", "cpp", "cs", "php", "swift", "kt", "scala", "sh", "bash", "zsh",
  "css", "scss", "less", "json", "yaml", "yml", "toml", "xml", "gq", "graphql",
  "sql", "lock", "map",
]);
const PRUNE_DIRS = new Set([
  ".git", "node_modules", "target", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "vendor",
]);
const MAX_TEXT = 60000;

function isDocFile(name) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (CODE_EXTS.has(ext)) return false;
  if (TEXT_EXTS.has(ext)) return true;
  return PROSE_BASENAMES.test(name);
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    // .agents/ holds agent machinery (skills, hooks) — code-adjacent, skipped
    // per "docs and notes, skip the code". .central-ops/runs holds agent-run
    // notes and IS included.
    if (ent.name === ".agents") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (PRUNE_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile() && isDocFile(ent.name)) {
      out.push(full);
    }
  }
}

function extractTitle(text, fallback) {
  const m = text.match(/^#{1,3}\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 200);
  return fallback;
}

async function main() {
  const root = fs.realpathSync(SOURCE_DIR);
  const files = [];
  walk(root, files);
  files.sort();

  const nodeRows = [];
  const edgeRows = [];
  const folders = new Map(); // relDir -> fid
  const summary = {
    projection: PROJECTION,
    sourceDir: root,
    filesFound: files.length,
    skippedBinary: 0,
    skippedEmpty: 0,
    truncated: 0,
    nodes: 0,
    containsEdges: 0,
  };

  const folderFid = (relDir) =>
    relDir === "." ? `${FIDP}:dir:.` : `${FIDP}:dir:${relDir}`;
  const ensureFolder = (relDir) => {
    if (folders.has(relDir)) return folders.get(relDir);
    const fid = folderFid(relDir);
    folders.set(relDir, fid);
    nodeRows.push({
      fid,
      kind: "folder",
      title: relDir === "." ? "central-ops" : path.basename(relDir),
      text: "",
      rel_path: relDir,
      folder: relDir === "." ? "" : path.dirname(relDir),
      ext: "",
      size: 0,
      updated: "",
      truncated: false,
    });
    if (relDir !== ".") {
      const parent = path.dirname(relDir);
      const parentKey = parent === "." ? "." : parent;
      ensureFolder(parentKey);
      edgeRows.push({ from: folderFid(parentKey), to: fid, type: "CONTAINS" });
    }
    return fid;
  };
  ensureFolder(".");

  for (const full of files) {
    const rel = path.relative(root, full);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buf.length === 0) {
      summary.skippedEmpty++;
      continue;
    }
    if (buf.includes(0)) {
      summary.skippedBinary++;
      continue;
    }
    let text = buf.toString("utf8");
    let truncated = false;
    if (text.length > MAX_TEXT) {
      text = text.slice(0, MAX_TEXT);
      truncated = true;
      summary.truncated++;
    }
    const stat = fs.statSync(full);
    const relDir = path.dirname(rel);
    const dirKey = relDir === "." ? "." : relDir;
    ensureFolder(dirKey);
    const fid = `${FIDP}:${rel}`;
    const stem = path.basename(full, path.extname(full));
    nodeRows.push({
      fid,
      kind: "doc",
      title: extractTitle(text, stem),
      text,
      rel_path: rel,
      folder: dirKey === "." ? "" : dirKey,
      ext: path.extname(full).toLowerCase().replace(/^\./, ""),
      size: buf.length,
      updated: stat.mtime.toISOString(),
      truncated,
    });
    edgeRows.push({ from: folderFid(dirKey), to: fid, type: "CONTAINS" });
  }
  summary.nodes = nodeRows.length;
  summary.containsEdges = edgeRows.length;

  if (DRY_RUN) {
    console.log("DRY RUN — no writes.");
    console.log(
      JSON.stringify(
        {
          ...summary,
          sampleTitles: nodeRows
            .filter((n) => n.kind === "doc")
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
         SET n:CentralOpsDoc,
             n._projection = $proj, n.kind = r.kind,
             n.title = r.title, n.text = r.text, n.rel_path = r.rel_path,
             n.folder = r.folder, n.ext = r.ext, n.size = r.size,
             n.updated = r.updated, n.truncated = r.truncated`,
        { rows: nodeRows.slice(i, i + B), proj: PROJECTION }
      );
    }
    console.log("central-ops doc nodes ingested:", summary.nodes);

    let created = 0;
    for (let i = 0; i < edgeRows.length; i += B) {
      const res = await session.run(
        `UNWIND $rows AS e
         MATCH (a:ProjectionNode { _fid: e.from }), (b:ProjectionNode { _fid: e.to })
         MERGE (a)-[r:CONTAINS]->(b)
         SET r._projection = $proj`,
        { rows: edgeRows.slice(i, i + B), proj: PROJECTION }
      );
      created += res.summary.counters.updates().relationshipsCreated;
    }
    summary.containsEdgesCreated = created;
    const dang = await session.run(
      `UNWIND $rows AS e
       OPTIONAL MATCH (a:ProjectionNode { _fid: e.from })
       OPTIONAL MATCH (b:ProjectionNode { _fid: e.to })
       RETURN sum(CASE WHEN a IS NULL OR b IS NULL THEN 1 ELSE 0 END) AS missing`,
      { rows: edgeRows }
    );
    const missing = Number(dang.records[0].get("missing") || 0);
    if (missing) console.log(`  CONTAINS: ${missing} dangling refs skipped`);

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
