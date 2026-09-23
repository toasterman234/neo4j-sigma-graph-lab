#!/usr/bin/env node
/*
 * ingest-things3.cjs — ingest a Things 3 SQLite database into Neo4j
 * as a queryable projection (never the source of truth).
 *
 * Source is typically an archived Things Database.thingsdatabase/main.sqlite
 * (Things 3 is a closed box: no API; the live container may be gone).
 * Provenance is stamped on every node: `_projection='things3'`,
 * `source_snapshot` (the db file's mtime), and the stable `_fid`.
 *
 * Layers (all :ProjectionNode + a kind label):
 *   ThingsArea, ThingsProject, ThingsTask, ThingsHeading,
 *   ThingsChecklistItem, ThingsTag
 * Edges (deterministic, from the db's own parent refs):
 *   CONTAINS  (area→project/task, project→heading/task, heading→task,
 *              task→checklist item)
 *   HAS_TAG   (task/project→tag)
 *
 * Trashed items are ingested with trashed=true (ingest it all, filter at
 * query time). Tombstones are skipped (deletion markers, not content).
 *
 * Usage:
 *   node scripts/ingest-things3.cjs [--dry-run] [--no-wipe]
 *       [--db <path to main.sqlite>] [--snapshot <label, default=db mtime>]
 */
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
  return i > -1 && argv[i + 1] ? argv[i + 1] : def;
};
const DB_PATH = opt("--db", null);
const PROJECTION = "things3";
const FIDP = "things3";

// Things timestamps: Core Data epoch (2001-01-01) as REAL, but some columns
// (stopDate) are Unix epoch. Detect per value.
const COREDATA_OFFSET = 978307200;
function toISO(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!n) return null;
  const unix = n > 1e10 ? n / 1000 : n > 1e9 ? n : n + COREDATA_OFFSET;
  const d = new Date(unix * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function q(db, sql) {
  const out = execFileSync("sqlite3", ["-json", db, sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  return out ? JSON.parse(out) : [];
}

const STATUS = { 0: "open", 1: "cancelled", 2: "completed", 3: "completed" };
const KIND = { 0: "ThingsTask", 1: "ThingsProject", 2: "ThingsHeading" };

async function main() {
  if (!DB_PATH) {
    console.error("ingest-things3: --db <path to main.sqlite> is required");
    process.exit(2);
  }
  // Copy to tmp so the original is never touched/locked.
  const tmpDb = path.join(
    os.tmpdir(),
    `things3-ingest-${Date.now()}.sqlite`
  );
  fs.copyFileSync(DB_PATH, tmpDb);
  const snapDefault = fs.statSync(DB_PATH).mtime.toISOString().slice(0, 10);
  const SNAPSHOT = opt("--snapshot", snapDefault);
  console.log(`things3 db: ${DB_PATH} (snapshot ${SNAPSHOT})`);

  const areas = q(tmpDb, "SELECT uuid, title FROM TMArea");
  const tasks = q(
    tmpDb,
    `SELECT uuid, title, notes, type, status, trashed, creationDate,
            userModificationDate, stopDate, startDate, deadline, "start" AS startFlag,
            area, project, heading, contact
     FROM TMTask`
  );
  const checklist = q(
    tmpDb,
    `SELECT uuid, title, status, stopDate, task FROM TMChecklistItem`
  );
  const tags = q(tmpDb, "SELECT uuid, title FROM TMTag");
  const taskTags = q(tmpDb, "SELECT tasks AS taskUuid, tags AS tagUuid FROM TMTaskTag");
  fs.unlinkSync(tmpDb);

  const nodeRows = [];
  const edgeRows = [];
  const addEdge = (from, to, type) =>
    edgeRows.push({ from, to, type, tag: PROJECTION });

  for (const a of areas) {
    nodeRows.push({
      fid: `${FIDP}:area:${a.uuid}`,
      level: "area",
      kind: "ThingsArea",
      label: "ThingsArea",
      title: (a.title || "(untitled area)").slice(0, 200),
      text: "",
      status: null,
      trashed: false,
      created: null,
      modified: null,
      stopped: null,
      deadline: null,
      start: null,
      contact: null,
      source_snapshot: SNAPSHOT,
    });
  }
  const taskByUuid = new Map();
  for (const t of tasks) {
    const fid = `${FIDP}:task:${t.uuid}`;
    taskByUuid.set(t.uuid, fid);
    const kind = KIND[t.type] || "ThingsTask";
    nodeRows.push({
      fid,
      level: t.type === 1 ? "project" : t.type === 2 ? "heading" : "task",
      kind,
      label: kind,
      title: (t.title || "(untitled)").slice(0, 200),
      text: (t.notes || "").slice(0, 8000),
      status: STATUS[t.status] || `status-${t.status}`,
      trashed: !!t.trashed,
      created: toISO(t.creationDate),
      modified: toISO(t.userModificationDate),
      stopped: toISO(t.stopDate),
      deadline: toISO(t.deadline),
      start: toISO(t.startDate),
      contact: t.contact || null,
      source_snapshot: SNAPSHOT,
    });
  }
  for (const c of checklist) {
    nodeRows.push({
      fid: `${FIDP}:checklist:${c.uuid}`,
      level: "checklist",
      kind: "ThingsChecklistItem",
      label: "ThingsChecklistItem",
      title: (c.title || "(untitled)").slice(0, 200),
      text: "",
      status: c.status === 1 ? "completed" : "open",
      trashed: false,
      created: null,
      modified: null,
      stopped: toISO(c.stopDate),
      deadline: null,
      start: null,
      contact: null,
      source_snapshot: SNAPSHOT,
    });
    const parent = taskByUuid.get(c.task);
    if (parent) addEdge(parent, `${FIDP}:checklist:${c.uuid}`, "CONTAINS");
  }
  const tagByUuid = new Map();
  for (const g of tags) {
    const fid = `${FIDP}:tag:${g.uuid}`;
    tagByUuid.set(g.uuid, fid);
    nodeRows.push({
      fid,
      level: "tag",
      kind: "ThingsTag",
      label: "ThingsTag",
      title: (g.title || "(untitled tag)").slice(0, 200),
      text: "",
      status: null,
      trashed: false,
      created: null,
      modified: null,
      stopped: null,
      deadline: null,
      start: null,
      contact: null,
      source_snapshot: SNAPSHOT,
    });
  }
  for (const tt of taskTags) {
    const from = taskByUuid.get(tt.taskUuid);
    const to = tagByUuid.get(tt.tagUuid);
    if (from && to) addEdge(from, to, "HAS_TAG");
  }

  // Hierarchy from the db's own parent refs (never invented).
  const areaFid = (uuid) => (uuid ? `${FIDP}:area:${uuid}` : null);
  let danglingParents = 0;
  for (const t of tasks) {
    const fid = taskByUuid.get(t.uuid);
    const area = t.area ? areaFid(t.area) : null;
    const proj = t.project ? taskByUuid.get(t.project) : null;
    const head = t.heading ? taskByUuid.get(t.heading) : null;
    if (head) addEdge(head, fid, "CONTAINS");
    else if (proj) addEdge(proj, fid, "CONTAINS");
    else if (area) addEdge(area, fid, "CONTAINS");
    if ((t.project && !proj) || (t.heading && !head)) danglingParents++;
  }

  const summary = {
    areas: areas.length,
    tasks: tasks.length,
    checklist: checklist.length,
    tags: tags.length,
    nodes: nodeRows.length,
    edges: edgeRows.length,
    danglingParents,
    snapshot: SNAPSHOT,
  };
  console.log("things3 extracted:", JSON.stringify(summary));

  if (DRY_RUN) {
    console.log("DRY RUN — no writes.");
    return;
  }

  const env = loadEnv();
  const neo4j = require(path.join(FRONTEND_DIR, "node_modules", "neo4j-driver"));
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
    const byLabel = new Map();
    for (const r of nodeRows) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, []);
      byLabel.get(r.label).push(r);
    }
    for (const [label, rows] of byLabel) {
      for (let i = 0; i < rows.length; i += B) {
        await session.run(
          `UNWIND $rows AS r MERGE (n:ProjectionNode { _fid: r.fid })
           SET n:\`${label}\`,
               n._projection = $proj, n.level = r.level, n.kind = r.kind,
               n.title = r.title, n.text = r.text, n.status = r.status,
               n.trashed = r.trashed, n.created = r.created,
               n.modified = r.modified, n.stopped = r.stopped,
               n.deadline = r.deadline, n.start = r.start,
               n.contact = r.contact, n.source_snapshot = r.source_snapshot`,
          { rows: rows.slice(i, i + B), proj: PROJECTION }
        );
      }
    }
    console.log("things3 nodes ingested:", nodeRows.length);

    const byType = new Map();
    for (const e of edgeRows) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    for (const [type, rows] of byType) {
      let created = 0;
      for (let i = 0; i < rows.length; i += B) {
        const res = await session.run(
          `UNWIND $rows AS e
           MATCH (a:ProjectionNode { _fid: e.from }), (b:ProjectionNode { _fid: e.to })
           MERGE (a)-[r:\`${type}\`]->(b)
           SET r._projection = e.tag`,
          { rows: rows.slice(i, i + B) }
        );
        created += res.summary.counters.updates().relationshipsCreated;
      }
      console.log(`  ${type}: ${created} edges`);
      summary[type] = created;
    }
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
