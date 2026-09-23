import "server-only";

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { JevRunResponse } from "@/lib/jev";
import type { SearchMode, SearchScope } from "@/lib/sigmaNeo4j";

const MAX_SAVED_RESULTS = 100;
const MAX_JSON_CHARS = 100_000;

type StoredResult = {
  id: number;
  createdAt: string;
  query: string;
  scope: SearchScope;
  mode: SearchMode;
  question: string;
  boundedNodeCount: number;
  boundedRelationshipCount: number;
  resultCount: number;
  judgment: Record<string, unknown>;
  confidence: Record<string, number>;
  evidence: JevRunResponse["evidence"];
  proposedRelationships: JevRunResponse["proposedRelationships"];
};

let database: Database.Database | undefined;

function databasePath(): string {
  const configured = process.env.RESULTS_DB_PATH || ".data/graph-lab.sqlite";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export function getResultDatabase(): Database.Database {
  if (database) return database;
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS saved_jev_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      query TEXT NOT NULL,
      scope TEXT NOT NULL,
      mode TEXT NOT NULL,
      question TEXT NOT NULL,
      bounded_node_count INTEGER NOT NULL,
      bounded_relationship_count INTEGER NOT NULL,
      result_count INTEGER NOT NULL,
      judgment_json TEXT NOT NULL,
      confidence_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      proposed_relationships_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_jev_results_created_at_idx ON saved_jev_results(created_at DESC);
  `);
  return database;
}

function json(value: unknown, field: string): string {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length > MAX_JSON_CHARS) throw new Error(`${field} is too large to save`);
  return serialized;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return value;
}

export function saveJevResult(input: { query: string; scope: SearchScope; mode: SearchMode; result: JevRunResponse }): StoredResult {
  if (!input.query.trim()) throw new Error("query is required");
  const result = input.result;
  const row = {
    createdAt: new Date().toISOString(),
    query: input.query.trim().slice(0, 500),
    scope: input.scope,
    mode: input.mode,
    question: String(result.question || "").slice(0, 1000),
    boundedNodeCount: number(result.boundedContext?.nodeCount, "boundedContext.nodeCount"),
    boundedRelationshipCount: number(result.boundedContext?.relationshipCount, "boundedContext.relationshipCount"),
    resultCount: number(result.boundedContext?.resultCount, "boundedContext.resultCount"),
    judgmentJson: json(result.judgment, "judgment"),
    confidenceJson: json(result.confidence, "confidence"),
    evidenceJson: json(Array.isArray(result.evidence) ? result.evidence.slice(0, 24) : [], "evidence"),
    proposedRelationshipsJson: json(Array.isArray(result.proposedRelationships) ? result.proposedRelationships.slice(0, 12) : [], "proposedRelationships"),
  };
  const db = getResultDatabase();
  const insert = db.prepare(`INSERT INTO saved_jev_results (created_at, query, scope, mode, question, bounded_node_count, bounded_relationship_count, result_count, judgment_json, confidence_json, evidence_json, proposed_relationships_json) VALUES (@createdAt, @query, @scope, @mode, @question, @boundedNodeCount, @boundedRelationshipCount, @resultCount, @judgmentJson, @confidenceJson, @evidenceJson, @proposedRelationshipsJson)`);
  const info = insert.run(row);
  db.prepare(`DELETE FROM saved_jev_results WHERE id NOT IN (SELECT id FROM saved_jev_results ORDER BY created_at DESC LIMIT ?)`).run(MAX_SAVED_RESULTS);
  return getSavedJevResult(Number(info.lastInsertRowid))!;
}

export function listSavedJevResults(): StoredResult[] {
  const rows = getResultDatabase().prepare(`SELECT id, created_at AS createdAt, query, scope, mode, question, bounded_node_count AS boundedNodeCount, bounded_relationship_count AS boundedRelationshipCount, result_count AS resultCount, judgment_json AS judgmentJson, confidence_json AS confidenceJson, evidence_json AS evidenceJson, proposed_relationships_json AS proposedRelationshipsJson FROM saved_jev_results ORDER BY created_at DESC LIMIT ?`).all(MAX_SAVED_RESULTS) as Array<Record<string, unknown>>;
  return rows.map(parseRow);
}

export function getSavedJevResult(id: number): StoredResult | undefined {
  const row = getResultDatabase().prepare(`SELECT id, created_at AS createdAt, query, scope, mode, question, bounded_node_count AS boundedNodeCount, bounded_relationship_count AS boundedRelationshipCount, result_count AS resultCount, judgment_json AS judgmentJson, confidence_json AS confidenceJson, evidence_json AS evidenceJson, proposed_relationships_json AS proposedRelationshipsJson FROM saved_jev_results WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? parseRow(row) : undefined;
}

function parseRow(row: Record<string, unknown>): StoredResult {
  return {
    id: Number(row.id),
    createdAt: String(row.createdAt),
    query: String(row.query),
    scope: row.scope as SearchScope,
    mode: row.mode as SearchMode,
    question: String(row.question),
    boundedNodeCount: Number(row.boundedNodeCount),
    boundedRelationshipCount: Number(row.boundedRelationshipCount),
    resultCount: Number(row.resultCount),
    judgment: JSON.parse(String(row.judgmentJson)),
    confidence: JSON.parse(String(row.confidenceJson)),
    evidence: JSON.parse(String(row.evidenceJson)),
    proposedRelationships: JSON.parse(String(row.proposedRelationshipsJson)),
  };
}

export function closeResultStore(): void {
  database?.close();
  database = undefined;
}
