import path from "node:path";
import dotenv from "dotenv";
import neo4j, { type Driver, type Integer, type Record as Neo4jRecord, type Node as Neo4jNode } from "neo4j-driver";
import Graph from "graphology";
import { cypherToGraph } from "graphology-neo4j";
import { displayLabel, humanizeLabel, humanizeNodeTitle, humanizeRelationship } from "@/lib/documentSource";
import { mergeHybridResults } from "@/lib/semanticHybrid";

for (const envPath of [path.resolve(process.cwd(), "../.env"), path.resolve(process.cwd(), ".env")]) {
  dotenv.config({ path: envPath, override: false });
}

const MAX_NODES = 500;
const MAX_QUERY_TEXT = 12000;
let driver: Driver | undefined;

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    if (!uri || !username || !password) throw new Error("Neo4j configuration is unavailable");
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }
  return driver;
}

export function database() {
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
  score?: number;
  retrieval?: "lexical" | "semantic";
};

export type RetrievalMetadata = {
  strategy: "lexical" | "hybrid" | "lexical_fallback";
  semantic?: {
    indexName: string;
    label: string;
    property: string;
    seedCount: number;
    candidateCount: number;
  };
  fallbackReason?: string;
};

export type SearchResponse = {
  query: string;
  scope: SearchScope;
  mode: SearchMode;
  results: SearchResult[];
  context: ReturnType<typeof graphToPayload>;
  counts: { nodes: number; relationships: number; results: number };
  retrieval?: RetrievalMetadata;
};

const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_CONTEXT_NODES = 120;
const MAX_JEV_ITEM_RESULTS = 24;
const MAX_SNIPPET = 420;
const MAX_SEMANTIC_SEEDS = 3;
const MAX_SEMANTIC_CANDIDATES = 24;
const DEFAULT_VECTOR_INDEX = "entity_embeddings";

type VectorCapability = {
  indexName: string;
  label: string;
  property: string;
};


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

async function detectVectorCapability(preferredIndex = process.env.NEO4J_VECTOR_INDEX || DEFAULT_VECTOR_INDEX): Promise<VectorCapability | undefined> {
  try {
    const records = await readRecords(
      `SHOW INDEXES
       YIELD name, type, state, labelsOrTypes, properties
       WHERE type = 'VECTOR' AND state = 'ONLINE'
       RETURN name, labelsOrTypes, properties
       ORDER BY CASE WHEN name = $preferred THEN 0 ELSE 1 END, name
       LIMIT 10`,
      { preferred: preferredIndex },
    );
    for (const record of records) {
      const name = String(record.get("name") || "");
      const labels = plain(record.get("labelsOrTypes")) as unknown;
      const properties = plain(record.get("properties")) as unknown;
      const label = Array.isArray(labels) && labels.length ? String(labels[0]) : "";
      const property = Array.isArray(properties) && properties.length ? String(properties[0]) : "";
      if (name && label && property) return { indexName: name, label, property };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function semanticSeeds(selectedNodeIds: string[], capability: VectorCapability): Promise<Array<{ id: string; embedding: number[] }>> {
  const ids = selectedIds(selectedNodeIds);
  if (!ids.length) return [];
  const records = await readRecords(
    `MATCH (selected)
     WHERE id(selected) IN $ids
     MATCH p = (selected)-[*0..2]-(seed)
     WHERE $label IN labels(seed) AND seed[$property] IS NOT NULL
     WITH seed, min(length(p)) AS distance
     RETURN id(seed) AS seedId, seed[$property] AS embedding, distance
     ORDER BY distance, seedId
     LIMIT $limit`,
    { ids, label: capability.label, property: capability.property, limit: neo4j.int(MAX_SEMANTIC_SEEDS) },
  );
  return records.flatMap((record) => {
    const id = record.get("seedId")?.toString?.() ?? String(record.get("seedId") || "");
    const raw = plain(record.get("embedding"));
    if (!id || !Array.isArray(raw) || !raw.length || !raw.every((value) => typeof value === "number")) return [];
    return [{ id, embedding: raw as number[] }];
  });
}

function mergeContexts(...contexts: SearchResponse["context"][]): SearchResponse["context"] {
  const nodes = Array.from(new Map(contexts.flatMap((context) => context.nodes).map((node) => [node.id, node])).values()).slice(0, MAX_SEARCH_CONTEXT_NODES);
  const allowed = new Set(nodes.map((node) => node.id));
  const relationships = Array.from(new Map(
    contexts.flatMap((context) => context.relationships)
      .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
      .map((edge) => [edge.id, edge]),
  ).values()).slice(0, MAX_SEARCH_CONTEXT_NODES);
  return { nodes, relationships, counts: { nodes: nodes.length, relationships: relationships.length } };
}

function sourceNeighborIds(candidateId: string, context: SearchResponse["context"]): string[] {
  const nodes = new Map(context.nodes.map((node) => [node.id, node]));
  const neighbors = context.relationships.flatMap((edge) => {
    if (edge.source === candidateId) return [edge.target];
    if (edge.target === candidateId) return [edge.source];
    return [];
  });
  return Array.from(new Set(neighbors.filter((id) => {
    const node = nodes.get(id);
    if (!node) return false;
    const properties = node.properties as Record<string, unknown>;
    return node.labels.includes("Chunk") || Boolean(sourceUri(properties)) || "text" in properties;
  }))).slice(0, 4);
}

async function semanticSearchFromSelected(query: string, selectedNodeIds: string[], limit: number): Promise<{
  response?: SearchResponse;
  capability?: VectorCapability;
  seedCount: number;
  fallbackReason?: string;
}> {
  const capability = await detectVectorCapability();
  if (!capability) return { seedCount: 0, fallbackReason: "No online Neo4j vector index was detected." };

  let seeds: Array<{ id: string; embedding: number[] }>;
  try {
    seeds = await semanticSeeds(selectedNodeIds, capability);
  } catch (error) {
    return { capability, seedCount: 0, fallbackReason: error instanceof Error ? `Unable to resolve semantic seeds: ${error.message}` : "Unable to resolve semantic seeds." };
  }
  if (!seeds.length) return { capability, seedCount: 0, fallbackReason: `No selected or nearby ${capability.label} node has the indexed ${capability.property} embedding.` };

  const scores = new Map<string, number>();
  try {
    for (const seed of seeds) {
      const records = await readRecords(
        `CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
         YIELD node, score
         WHERE id(node) <> toInteger($seedId)
         RETURN id(node) AS nodeId, score
         ORDER BY score DESC
         LIMIT $topK`,
        {
          indexName: capability.indexName,
          topK: neo4j.int(Math.min(MAX_SEMANTIC_CANDIDATES, Math.max(4, limit))),
          embedding: seed.embedding,
          seedId: seed.id,
        },
      );
      for (const record of records) {
        const id = record.get("nodeId")?.toString?.() ?? String(record.get("nodeId") || "");
        const score = Number(record.get("score"));
        if (!id || !Number.isFinite(score)) continue;
        scores.set(id, Math.max(score, scores.get(id) ?? Number.NEGATIVE_INFINITY));
      }
    }
  } catch (error) {
    return { capability, seedCount: seeds.length, fallbackReason: error instanceof Error ? `Vector query failed: ${error.message}` : "Vector query failed." };
  }

  const candidateIds = Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.min(MAX_SEMANTIC_CANDIDATES, Math.max(4, limit)))
    .map(([id]) => id);
  if (!candidateIds.length) return { capability, seedCount: seeds.length, fallbackReason: "The vector index returned no candidates." };

  const context = await graphFromCypher(
    `MATCH (candidate)
     WHERE id(candidate) IN $ids
     OPTIONAL MATCH (candidate)-[r]-(related)
     RETURN candidate, r, related
     LIMIT $limit`,
    {
      ids: candidateIds.map((id) => neo4j.int(Number.parseInt(id, 10))),
      limit: neo4j.int(MAX_SEARCH_CONTEXT_NODES),
    },
  );
  const candidates = new Set(candidateIds);
  const results = context.nodes
    .filter((node) => candidates.has(node.id))
    .map((node) => {
      const result = nodeSearchResult(node as { id: string; labels: string[]; properties: Record<string, unknown> }, query);
      if (!result) return undefined;
      return {
        ...result,
        score: scores.get(node.id),
        retrieval: "semantic" as const,
        sourceNodeIds: sourceNeighborIds(node.id, context),
      };
    })
    .filter((result): result is SearchResult => Boolean(result))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit);

  return {
    capability,
    seedCount: seeds.length,
    response: {
      query,
      scope: "whole",
      mode: "keyword",
      results,
      context,
      counts: { nodes: context.nodes.length, relationships: context.relationships.length, results: results.length },
      retrieval: {
        strategy: "hybrid",
        semantic: {
          indexName: capability.indexName,
          label: capability.label,
          property: capability.property,
          seedCount: seeds.length,
          candidateCount: results.length,
        },
      },
    },
  };
}

export async function hybridSearchGraph(query: string, scope: SearchScope = "whole", mode: SearchMode = "keyword", selectedNodeIds: string[] = [], limit = MAX_SEARCH_RESULTS): Promise<SearchResponse> {
  const lexical = await searchGraph(query, scope, mode, selectedNodeIds, limit);
  if (!selectedNodeIds.length) {
    return { ...lexical, retrieval: { strategy: "lexical_fallback", fallbackReason: "Semantic retrieval requires a selected source or graph object." } };
  }

  const semantic = await semanticSearchFromSelected(query, selectedNodeIds, Math.min(limit, MAX_SEMANTIC_CANDIDATES));
  if (!semantic.response) {
    return {
      ...lexical,
      retrieval: {
        strategy: "lexical_fallback",
        semantic: semantic.capability ? {
          indexName: semantic.capability.indexName,
          label: semantic.capability.label,
          property: semantic.capability.property,
          seedCount: semantic.seedCount,
          candidateCount: 0,
        } : undefined,
        fallbackReason: semantic.fallbackReason,
      },
    };
  }

  const semanticResults = semantic.response.results;
  const combined = mergeHybridResults(
    semanticResults,
    lexical.results,
    Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit))),
  );
  const context = mergeContexts(semantic.response.context, lexical.context);

  return {
    query: lexical.query,
    scope,
    mode,
    results: combined,
    context,
    counts: { nodes: context.nodes.length, relationships: context.relationships.length, results: combined.length },
    retrieval: {
      strategy: "hybrid",
      semantic: semantic.response.retrieval?.semantic,
    },
  };
}

export async function searchGraph(query: string, scope: SearchScope = "whole", mode: SearchMode = "keyword", selectedNodeIds: string[] = [], limit = MAX_SEARCH_RESULTS): Promise<SearchResponse> {
  const clean = query.trim();
  const bounded = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(limit)));
  if (!clean) return { query: clean, scope, mode, results: [], context: { nodes: [], relationships: [], counts: { nodes: 0, relationships: 0 } }, counts: { nodes: 0, relationships: 0, results: 0 }, retrieval: { strategy: "lexical" } };
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
  return { query: clean, scope, mode, results: unique.map((result) => ({ ...result, retrieval: "lexical" as const })), context, counts: { nodes: context.nodes.length, relationships: context.relationships.length, results: unique.length }, retrieval: { strategy: "lexical" } };
}


export async function selectedItemContext(selectedNodeIds: string[], query = "selected item", limit = MAX_JEV_ITEM_RESULTS): Promise<SearchResponse> {
  const ids = selectedIds(selectedNodeIds);
  const clean = query.trim() || "selected item";
  const bounded = Math.max(1, Math.min(MAX_JEV_ITEM_RESULTS, Math.floor(limit)));

  if (!ids.length) {
    return {
      query: clean,
      scope: "selected",
      mode: "document",
      results: [],
      context: { nodes: [], relationships: [], counts: { nodes: 0, relationships: 0 } },
      counts: { nodes: 0, relationships: 0, results: 0 },
    };
  }

  const context = await graphFromCypher(
    `MATCH (n)
     WHERE id(n) IN $ids
     RETURN n
     LIMIT $limit`,
    { ids, limit: neo4j.int(bounded) },
  );

  const results = context.nodes
    .slice(0, bounded)
    .map((node) => nodeSearchResult(node as { id: string; labels: string[]; properties: Record<string, unknown> }, clean))
    .filter((result): result is SearchResult => Boolean(result));

  return {
    query: clean,
    scope: "selected",
    mode: "document",
    results,
    context,
    counts: { nodes: context.nodes.length, relationships: 0, results: results.length },
  };
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
