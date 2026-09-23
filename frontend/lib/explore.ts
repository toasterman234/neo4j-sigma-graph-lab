// Shared helpers for the Explore tab: kind metadata, projection Cypher
// builders, and the ask-box intent router. All queries are read-only.

export const NOTE_KINDS = [
  "Thought",
  "Idea",
  "Preference",
  "Goal",
  "Document",
  "MuseNote",
] as const;

export const TELEMETRY_KIND = "Observation";

export const KIND_COLORS: Record<string, string> = {
  Thought: "#f59e0b",
  Idea: "#22c55e",
  Preference: "#3b82f6",
  Goal: "#a855f7",
  Document: "#94a3b8",
  MuseNote: "#14b8b8",
  Observation: "#57534e",
};

/** Human grouping key for a projection node. */
export function kindOf(labels: string[], kindProp: unknown): string {
  if (labels.includes("MuseNote")) return "MuseNote";
  if (typeof kindProp === "string" && kindProp) return kindProp;
  const label = labels.find(
    (l) => l !== "ProjectionNode" && l !== "FoundationNode"
  );
  return label || "Note";
}

export function colorFor(kind: string): string {
  return KIND_COLORS[kind] || "#64748b";
}

function kindList(kinds: string[]): string {
  return kinds.map((k) => `'${k.replace(/'/g, "")}'`).join(", ");
}

/** Projection subgraph filtered to the given kinds. Empty kinds = everything. */
export function projectionQuery(kinds: string[]): string {
  const list = kindList(kinds);
  const where = kinds.length
    ? `WHERE n.kind IN [${list}] OR any(l IN labels(n) WHERE l IN [${list}])`
    : "";
  const mWhere = kinds.length
    ? `WHERE m.kind IN [${list}] OR any(l IN labels(m) WHERE l IN [${list}])`
    : "";
  return `MATCH (n:ProjectionNode)
${where}
OPTIONAL MATCH (n)-[r]-(m:ProjectionNode)
${mWhere}
RETURN n, r, m
LIMIT $limit`;
}

export const SUPERSESSION_QUERY = `MATCH (a:ProjectionNode)-[s:SUPERSEDED_BY]->(b:ProjectionNode)
RETURN a, s, b
LIMIT $limit`;

export type AskIntent = "supersession" | "search";

/** Deterministic intent router for the ask box. No LLM, no surprises. */
export function detectIntent(question: string): AskIntent {
  const s = question.toLowerCase();
  if (/supersed|replac|obsolet|\bnewer\b|\bolder version\b|previous version/.test(s))
    return "supersession";
  return "search";
}

const KIND_WORDS: Record<string, string> = {
  thought: "Thought",
  thoughts: "Thought",
  idea: "Idea",
  ideas: "Idea",
  preference: "Preference",
  preferences: "Preference",
  goal: "Goal",
  goals: "Goal",
  note: "MuseNote",
  notes: "MuseNote",
  document: "Document",
  documents: "Document",
  telemetry: "Observation",
  observation: "Observation",
  observations: "Observation",
};

/** If the question names note kinds ("show my thoughts"), return them so the
 *  graph filter can jump straight there. Otherwise null. */
export function kindsFromQuestion(question: string): string[] | null {
  const found = new Set<string>();
  for (const word of question.toLowerCase().split(/[^a-z]+/)) {
    const kind = KIND_WORDS[word];
    if (kind) found.add(kind);
  }
  return found.size > 0 ? [...found] : null;
}
