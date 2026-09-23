import path from "node:path";
import dotenv from "dotenv";
import neo4j, { type Driver, type Integer, type Record as Neo4jRecord, type Node as Neo4jNode } from "neo4j-driver";
import Graph from "graphology";
import { cypherToGraph } from "graphology-neo4j";
import { displayLabel, humanizeLabel, humanizeNodeTitle, humanizeRelationship } from "@/lib/documentSource";

for (const envPath of [path.resolve(process.cwd(), "../.env"), path.resolve(process.cwd(), ".env")]) {
  dotenv.config({ path: envPath, override: false });
}

const MAX_NODES = 500;
const MAX_QUERY_TEXT = 12000;
let driver: Driver | undefined;

function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    if (!uri || !username || !password) throw new Error("Neo4j configuration is unavailable");
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }
  return driver;
}

function database() {
  return process.env.NEO4J_DATABASE || "neo4j";
}

export function assertReadOnly(query: string) {
  if (!query || query.length > MAX_QUERY_TEXT) throw new Error("Query is empty or too large");
  const normalized = query.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").toUpperCase();
  const forbidden = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|FOREACH|GRANT|DENY|REVOKE|ALTER|RENAME|TERMINATE|TRANSACTION)\b/;
  if (forbidden.test(normalized)) throw new Error("Only read-only Cypher is allowed");
  if (!/\b(MATCH|OPTIONAL\s+MATCH|CALL|UNWIND|RETURN|WITH|SHOW|UNION|USE)\b/.test(normalized)) {
    throw new Error("Query must contain a read clause");
  }
}

function graphToPayload(graph: Graph) {
  const nodes = graph.nodes().slice(0, MAX_NODES).map((key) => {
    const attrs = graph.getNodeAttributes(key) as Record<string, unknown>;
    return {
      id: String(key),
      labels: Array.isArray(attrs["@labels"]) ? attrs["@labels"] : [],
      properties: attrs.properties ?? attrs,
    };
  });
  const allowed = new Set(nodes.map((n) => n.id));
  const relationships = graph.edges().flatMap((edge) => {
    const source = String(graph.source(edge));
    const target = String(graph.target(edge));
    if (!allowed.has(source) || !allowed.has(target)) return [];
    const attrs = graph.getEdgeAttributes(edge) as Record<string, unknown>;
    return [{ id: String(edge), source, target, type: String(attrs["@type"] ?? attrs.type ?? "RELATED_TO") }];
  });
  return { nodes, relationships, counts: { nodes: nodes.length, relationships: relationships.length } };
}

export async function graphFromCypher(query: string, parameters: Record<string, unknown> = {}) {
  assertReadOnly(query);
  const driverParameters = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [
    key, typeof value === "number" && Number.isInteger(value) ? neo4j.int(value) : value,
  ]));
  const graph = await cypherToGraph({ driver: getDriver(), database: database() }, query, driverParameters, {
    id: "@id", labels: "@labels", type: "@type",
  });
  return graphToPayload(graph);
}

export async function defaultGraph(limit = 300) {
  const bounded = Math.max(20, Math.min(MAX_NODES, Math.floor(limit)));
  return graphFromCypher(
    `MATCH (n)-[r]-(m)
     WITH n, r, m, id(n) AS nid, id(m) AS mid
     RETURN n, r, m
     LIMIT $limit`,
    { limit: neo4j.int(bounded) },
  );
}

export type SearchScope = "selected" | "neighborhood" | "whole";
export type SearchMode = "keyword" | "property" | "document" | "relationship";

export type SearchResult = {
  id: string;
  kind: "node" | "relationship" | "source";
  labels: string[];
  title: string;
  snippet: string;
  properties?: Record<string, unknown>;
  sourceNodeIds?: string[];
};

export type SearchResponse = {
  query: string;
  scope: SearchScope;
  mode: SearchMode;
  results: SearchResult[];
  context: ReturnType<typeof graphToPayload>;
  counts: { nodes: number; relationships: number; results: number };
};

const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_CONTEXT_NODES = 120;
const MAX_SNIPPET = 420;

async function readRecords(query: string, parameters: Record<string, unknown>) {
  assertReadOnly(query);
  const session = getDriver().session({ database: database(), defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(query, parameters, { timeout: 15000 });
    return result.records;
  } finally {
    await session.close();
  }
}

function plain(value: unknown): unknown {
  if (neo4j.isInt(value)) return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, plain(v)]));
  return value;
}

function displayTitle(labels: string[], properties: Record<string, unknown>, id: string): string {
  const source = sourceUri(properties);
  if (source || labels.includes("Chunk")) {
    const clean = source ? decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(/\\/g, "/") : "";
    return clean.split("/").pop() || "Document";
  }
  return humanizeNodeTitle({ id, labels, properties }) || displayLabel({ id, labels, properties });
}

function displaySnippet(properties: Record<string, unknown>, query: string): string {
  const metadata = typeof properties.metadata === "string" ? (() => { try { return JSON.parse(properties.metadata) as Record<string, unknown>; } catch { return {}; } })() : {};
  const content = String(properties.text ?? metadata.parentText ?? properties.summary ?? properties.description ?? "").replace(/\\n/g, " ").replace(/\\s+/g, " ").trim();
  if (content) {
    const match = content.toLowerCase().indexOf(query.toLowerCase());
    const start = match > 80 ? match - 80 : 0;
    return content.slice(start, start + MAX_SNIPPET);
  }
  const humanFields = Object.entries(properties).filter(([key]) => !key.startsWith("neptune_") && !key.startsWith("metadata") && !key.startsWith("@") && key !== "id").map(([key, value]) => `${humanizeNodeTitle({ id: "", labels: [key], properties: { value } }) || humanizeLabel(key)}: ${plain(value)}`).join(" · ");
  return humanFields.slice(0, MAX_SNIPPET);
}

function sourceUri(properties: Record<string, unknown>): string | undefined {
  for (const key of ["metadata_x-amz-bedrock-kb-source-uri", "sourceUrl", "sourceUri", "path"]) {
    const value = properties[key];
    if (typeof value === "string" && value) return value;
  }
  const metadata = properties.metadata;
  if (typeof metadata === "string") {
    try { return sourceUri(JSON.parse(metadata)); } catch { /* unstructured metadata */ }
  }
  return undefined;
}

function nodeSearchResult(node: { id: string; labels: string[]; properties: Record<string, unknown> }, query: string): SearchResult | undefined {
  const source = node.labels.includes("Chunk") || Boolean(sourceUri(node.properties)) || "text" in node.properties;
  if (!source && node.labels.some((label) => ["Entity", "SemanticEntity", "DocumentId"].includes(label)) && !humanizeNodeTitle(node)) return undefined;
  return {
    id: node.id,
    kind: source ? "source" : "node",
    labels: [source ? "Document" : displayLabel(node)],
    title: displayTitle(node.labels, node.properties, node.id),
    snippet: displaySnippet(node.properties, query),
    properties: node.properties,
  };
}

function selectedIds(ids: string[]): Integer[] {
  return ids.slice(0, 20).map((id) => Number.parseInt(id, 10)).filter((id) => Number.isInteger(id) && id >= 0).map((id) => neo4j.int(id));
}

export async function searchGraph(query: string, scope: SearchScope = "whole", mode: SearchMode = "keyword", selectedNodeIds: string[] = [], limit = MAX_SEARCH_RESULTS): Promise<SearchResponse> {
  const clean = query.trim();
  const bounded = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit)));
  if (!clean) return { query: clean, scope, mode, results: [], context: { nodes: [], relationships: [], counts: { nodes: 0, relationships: 0 } }, counts: { nodes: 0, relationships: 0, results: 0 } };
  const ids = selectedIds(selectedNodeIds);
  const params: Record<string, unknown> = { q: clean, ids, limit: neo4j.int(MAX_SEARCH_CONTEXT_NODES) };
  const nodePredicateFor = (variable: string) => mode === "document"
    ? `(${variable}:Chunk OR any(k IN keys(${variable}) WHERE k IN ['metadata_x-amz-bedrock-kb-source-uri', 'sourceUrl', 'sourceUri', 'text'])) AND any(k IN keys(${variable}) WHERE toString(${variable}[k]) CONTAINS $q)`
    : mode === "property"
      ? `any(k IN keys(${variable}) WHERE k <> 'text' AND k <> 'metadata' AND toString(${variable}[k]) CONTAINS $q)`
      : `any(k IN keys(${variable}) WHERE toString(${variable}[k]) CONTAINS $q)`;
  let queryText: string;
  if (mode === "relationship") {
    const scopePredicate = ids.length && scope !== "whole" ? " AND (id(n) IN $ids OR id(m) IN $ids)" : "";
    queryText = `MATCH (n)-[r]-(m) WHERE toUpper(type(r)) CONTAINS toUpper($q)${scopePredicate} RETURN n, r, m LIMIT $limit`;
  } else if (scope === "neighborhood" && ids.length) {
    queryText = `MATCH (n)-[r]-(m) WHERE id(n) IN $ids AND (${nodePredicateFor("n")} OR ${nodePredicateFor("m")}) RETURN n, r, m LIMIT $limit`;
  } else {
    const selectedPredicate = scope === "selected" && ids.length ? `id(n) IN $ids AND ` : "";
    queryText = `MATCH (n)-[r]-(m) WHERE ${selectedPredicate}${nodePredicateFor("n")} RETURN n, r, m LIMIT $limit`;
  }
  const context = await graphFromCypher(queryText, params);
  const nodeResults = context.nodes.slice(0, bounded).map((node) => nodeSearchResult(node as { id: string; labels: string[]; properties: Record<string, unknown> }, clean)).filter((result): result is SearchResult => Boolean(result));
  const nodesById = new Map(context.nodes.map((node) => [node.id, node]));
  const relationshipResults = context.relationships.filter((edge) => mode === "relationship" || edge.type.toLowerCase().includes(clean.toLowerCase())).slice(0, bounded).map((edge) => {
    const source = nodesById.get(edge.source); const target = nodesById.get(edge.target);
    const sourceTitle = source ? displayTitle(source.labels, source.properties as Record<string, unknown>, source.id) : "Source";
    const targetTitle = target ? displayTitle(target.labels, target.properties as Record<string, unknown>, target.id) : "Target";
    return { id: edge.id, kind: "relationship" as const, labels: [humanizeRelationship(edge.type)], title: humanizeRelationship(edge.type), snippet: `${sourceTitle} ${humanizeRelationship(edge.type)} ${targetTitle}`, sourceNodeIds: [edge.source, edge.target] };
  });
  const unique = Array.from(new Map([...((mode === "relationship") ? relationshipResults : nodeResults), ...((mode === "relationship") ? nodeResults : relationshipResults)].map((result) => [`${result.kind}:${result.id}`, result])).values()).slice(0, bounded);
  return { query: clean, scope, mode, results: unique, context, counts: { nodes: context.nodes.length, relationships: context.relationships.length, results: unique.length } };
}

export async function searchNodes(q: string, limit = 40) {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const records = await readRecords(
    `MATCH (n)
     WHERE any(k IN keys(n) WHERE toString(n[k]) CONTAINS $q)
     RETURN n, id(n) AS nodeId
     LIMIT $limit`, { q, limit: neo4j.int(bounded) },
  );
  return records.map((record: Neo4jRecord) => {
    const node = record.get("n") as Neo4jNode;
    return { id: record.get("nodeId").toString(), labels: node.labels, properties: plain(node.properties) as Record<string, unknown> };
  });
}

export async function expandNode(nodeId: string, limit = 120) {
  const bounded = Math.max(10, Math.min(250, Math.floor(limit)));
  return graphFromCypher(
    `MATCH (n)-[r]-(m)
     WHERE id(n) = toInteger($nodeId)
     RETURN n, r, m
     LIMIT $limit`, { nodeId, limit: neo4j.int(bounded) },
  );
}

export async function closeDriver() {
  if (driver) { await driver.close(); driver = undefined; }
}
