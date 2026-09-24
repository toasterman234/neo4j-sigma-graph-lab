#!/usr/bin/env node
/**
 * select-calibration-batch.cjs — pick a deterministic, stratified sample of
 * vault notes for the Jev calibration batch Ben grades before any bulk
 * labeling run.
 *
 * 36 notes: Profile 20, Workspace 5, Archive 3, Motion 2, Spike 2,
 * System 1, (root) 1, Self 1, Daily Triage 1. Evenly spaced by sorted path
 * within each folder (deterministic). Proposals are simple heuristics,
 * clearly labeled — NOT Jev judgments.
 *
 * Usage: node scripts/select-calibration-batch.cjs --out /tmp/batch.json
 *        [--vault-dir PATH] [--n 36]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const OUT = opt("--out", "/tmp/jev-calibration-batch.json");
const N = parseInt(opt("--n", "36"), 10) || 36;
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

// folder -> sample count (sums to 36; heavy on Profile = the unknown 87%)
const STRATA = {
  Profile: 20,
  Workspace: 5,
  Archive: 3,
  Motion: 2,
  Spike: 2,
  System: 1,
  "(root)": 1,
  Self: 1,
  "Daily Triage": 1,
};

function collect(vaultDir) {
  const docs = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
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
      if (text.trim().length < 50) continue; // skip stubs
      docs.push({ rel, folder, name, title: name, text, mtime: st.mtime.toISOString(), size: st.size });
    }
  };
  walk(vaultDir);
  return docs;
}

function heuristicType(d) {
  if (/^\d{4}-\d{2}-\d{2}/.test(d.name)) return "daily-log";
  const tasks = (d.text.match(/^[-*]\s+\[[ xX]\]/gm) || []).length;
  if (tasks >= 2) return "task-list";
  if (d.folder === "Profile" || d.folder === "Archive") return "reference";
  if (d.folder === "Motion" || d.folder === "Spike") return "capture";
  return "note";
}

function heuristicTopic(d) {
  const lines = d.text.split("\n");
  for (const ln of lines) {
    const h = ln.match(/^#{1,3}\s+(.+)/);
    if (h && h[1].trim()) return h[1].trim().slice(0, 80);
  }
  for (const ln of lines) {
    const t = ln.replace(/^[#>*\-\d.\s]+/, "").trim();
    if (t.length > 12) return t.slice(0, 80);
  }
  return d.title;
}

function excerpt(text, n = 600) {
  const t = text.replace(/\r/g, "").trim().slice(0, n);
  return text.trim().length > n ? t + "…" : t;
}

function main() {
  const docs = collect(VAULT_DIR);
  const byFolder = new Map();
  for (const d of docs) {
    if (!byFolder.has(d.folder)) byFolder.set(d.folder, []);
    byFolder.get(d.folder).push(d);
  }
  for (const arr of byFolder.values())
    arr.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const notes = [];
  let n = 0;
  for (const [folder, count] of Object.entries(STRATA)) {
    const arr = byFolder.get(folder) || [];
    if (!arr.length) continue;
    const step = Math.max(1, Math.floor(arr.length / count));
    for (let i = 0; i < arr.length && notes.length < N && n < count; i += step, n++) {
      const d = arr[Math.min(i, arr.length - 1)];
      if (notes.some((x) => x.relpath === d.rel)) continue;
      const wl = (d.text.match(/\[\[[^\]]+\]\]/g) || []).length;
      notes.push({
        id: `cal-${String(notes.length + 1).padStart(2, "0")}`,
        relpath: d.rel,
        folder: d.folder,
        title: d.title,
        excerpt: excerpt(d.text),
        size: d.size,
        updated: d.mtime,
        wikilinks: wl,
        heuristic_type: heuristicType(d),
        heuristic_topic: heuristicTopic(d),
      });
    }
    n = 0;
  }

  const batch = {
    generated: new Date().toISOString().slice(0, 10),
    source: "Ben's Vault (live, Mac mini)",
    status: "awaiting-ben-grade",
    jev_run: null,
    note: "Proposals are deterministic heuristics, NOT Jev judgments. Ben grades yes/no + comment per question. No bulk Jev labeling until he grades this batch.",
    questions: [
      {
        id: "note-type",
        label: "Note type",
        proposal_field: "heuristic_type",
        hint: "daily-log / task-list / reference / capture / note",
      },
      {
        id: "topic",
        label: "Topic",
        proposal_field: "heuristic_topic",
        hint: "one-line topic guess from the note's own headings",
      },
    ],
    notes,
  };
  fs.writeFileSync(OUT, JSON.stringify(batch, null, 2));
  const perFolder = {};
  for (const x of notes) perFolder[x.folder] = (perFolder[x.folder] || 0) + 1;
  console.log(`wrote ${notes.length} notes to ${OUT}`);
  console.log("per folder:", JSON.stringify(perFolder));
}

main();
