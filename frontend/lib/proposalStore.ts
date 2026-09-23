import "server-only";

import { getResultDatabase } from "@/lib/resultStore";
import { humanizeRelationship } from "@/lib/documentSource";

export type ProposalKind = "node_type" | "relationship_pattern" | "relationship";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "deferred";
export type ProposalEvidence = { id: string; title: string; excerpt: string; kind: string };

export type ModelProposal = {
  id: string;
  createdAt: string;
  query: string;
  kind: ProposalKind;
  title: string;
  sourceId?: string;
  sourceLabel?: string;
  targetId?: string;
  targetLabel?: string;
  relationshipType?: string;
  rationale: string;
  confidence: number;
  evidence: ProposalEvidence[];
  status: ProposalStatus;
  decisionNote?: string;
};

function ensureProposalTables() {
  const db = getResultDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_proposals (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      query TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      source_id TEXT,
      source_label TEXT,
      target_id TEXT,
      target_label TEXT,
      relationship_type TEXT,
      rationale TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_json TEXT NOT NULL,
      status TEXT NOT NULL,
      decision_note TEXT
    );
    CREATE TABLE IF NOT EXISTS proposal_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_proposals_created_at_idx ON model_proposals(created_at DESC);
  `);
  return db;
}

const schemaLabels: Record<string, string> = { Chunk: "Document", DocumentId: "Document reference", Entity: "Concept", SemanticEntity: "Concept" };

function safeSchemaLabel(value: unknown): string | undefined {
  if (!value) return undefined;
  const label = String(value);
  return schemaLabels[label] || label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function safeEvidenceTitle(value: string): string {
  return value.replace(/^Entity \d+$/i, "Concept").replace(/^SemanticEntity \d+$/i, "Concept").replace(/^Chunk \d+$/i, "Document").replace(/^DocumentId \d+$/i, "Document reference");
}

function safeText(value: string): string {
  return value.replace(/\bEntity\b/g, "Concept").replace(/\bSemanticEntity\b/g, "Concept").replace(/\bChunk\b/g, "Document").replace(/\bDocumentId\b/g, "Document reference");
}

function parse(row: Record<string, unknown>): ModelProposal {
  const kind = row.kind as ProposalKind;
  const sourceLabel = safeSchemaLabel(row.sourceLabel);
  const targetLabel = safeSchemaLabel(row.targetLabel);
  const relationshipType = row.relationshipType ? humanizeRelationship(String(row.relationshipType)) : undefined;
  const rawTitle = safeText(String(row.title));
  const title = kind === "relationship" || kind === "relationship_pattern"
    ? `${sourceLabel || "Source"} -[${relationshipType || "related to"}]-> ${targetLabel || "Target"}`
    : kind === "node_type"
      ? `Model concept type: ${sourceLabel || rawTitle.replace(/^Model (?:node|concept) type:\s*/i, "")}`
      : rawTitle;
  const evidence = (JSON.parse(String(row.evidenceJson)) as ProposalEvidence[]).map((item) => ({ ...item, title: safeEvidenceTitle(item.title), excerpt: safeText(item.excerpt) }));
  return {
    id: String(row.id), createdAt: String(row.createdAt), query: String(row.query), kind, title,
    sourceId: row.sourceId ? String(row.sourceId) : undefined, sourceLabel,
    targetId: row.targetId ? String(row.targetId) : undefined, targetLabel,
    relationshipType, rationale: safeText(String(row.rationale)), confidence: Number(row.confidence),
    evidence, status: row.status as ProposalStatus, decisionNote: row.decisionNote ? String(row.decisionNote) : undefined,
  };
}

export function saveModelProposals(proposals: ModelProposal[]): ModelProposal[] {
  if (!proposals.length) return [];
  const db = ensureProposalTables();
  const insert = db.prepare(`INSERT INTO model_proposals (id, created_at, query, kind, title, source_id, source_label, target_id, target_label, relationship_type, rationale, confidence, evidence_json, status, decision_note) VALUES (@id, @createdAt, @query, @kind, @title, @sourceId, @sourceLabel, @targetId, @targetLabel, @relationshipType, @rationale, @confidence, @evidenceJson, @status, @decisionNote) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, query = excluded.query, kind = excluded.kind, title = excluded.title, source_id = excluded.source_id, source_label = excluded.source_label, target_id = excluded.target_id, target_label = excluded.target_label, relationship_type = excluded.relationship_type, rationale = excluded.rationale, confidence = excluded.confidence, evidence_json = excluded.evidence_json`);
  const transaction = db.transaction((items: ModelProposal[]) => items.forEach((proposal) => insert.run({ id: proposal.id, createdAt: proposal.createdAt, query: proposal.query, kind: proposal.kind, title: proposal.title, sourceId: proposal.sourceId ?? null, sourceLabel: proposal.sourceLabel ?? null, targetId: proposal.targetId ?? null, targetLabel: proposal.targetLabel ?? null, relationshipType: proposal.relationshipType ?? null, rationale: proposal.rationale, confidence: proposal.confidence, evidenceJson: JSON.stringify(proposal.evidence.slice(0, 12)), status: proposal.status, decisionNote: proposal.decisionNote ?? null })));
  const limited = proposals.slice(0, 40);
  transaction(limited);
  const ids = new Set(limited.map((proposal) => proposal.id));
  return listModelProposals().filter((proposal) => ids.has(proposal.id));
}

export function listModelProposals(): ModelProposal[] {
  const rows = ensureProposalTables().prepare(`SELECT id, created_at AS createdAt, query, kind, title, source_id AS sourceId, source_label AS sourceLabel, target_id AS targetId, target_label AS targetLabel, relationship_type AS relationshipType, rationale, confidence, evidence_json AS evidenceJson, status, decision_note AS decisionNote FROM model_proposals ORDER BY created_at DESC LIMIT 200`).all() as Array<Record<string, unknown>>;
  return rows.map(parse).filter((proposal) => !["Entity", "Chunk", "DocumentId", "Document reference", "neptune_"].some((technical) => proposal.title.includes(technical)));
}

export function decideModelProposal(id: string, status: ProposalStatus, note?: string): ModelProposal | undefined {
  if (!["accepted", "rejected", "deferred"].includes(status)) throw new Error("Invalid proposal decision");
  const db = ensureProposalTables();
  const timestamp = new Date().toISOString();
  const update = db.prepare("UPDATE model_proposals SET status = ?, decision_note = ? WHERE id = ?");
  const info = update.run(status, note?.slice(0, 1000) || null, id);
  if (info.changes === 0) return undefined;
  db.prepare("INSERT INTO proposal_decisions (proposal_id, decision, note, created_at) VALUES (?, ?, ?, ?)").run(id, status, note?.slice(0, 1000) || null, timestamp);
  const row = ensureProposalTables().prepare(`SELECT id, created_at AS createdAt, query, kind, title, source_id AS sourceId, source_label AS sourceLabel, target_id AS targetId, target_label AS targetLabel, relationship_type AS relationshipType, rationale, confidence, evidence_json AS evidenceJson, status, decision_note AS decisionNote FROM model_proposals WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : undefined;
}
