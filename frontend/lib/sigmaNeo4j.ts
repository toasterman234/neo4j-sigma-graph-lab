import path from "node:path";
import dotenv from "dotenv";
import neo4j, { type Driver, type Record as Neo4jRecord, type Node as Neo4jNode } from "neo4j-driver";
import Graph from "graphology";
import { cypherToGraph } from "graphology-neo4j";

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
    return { id: record.get("nodeId").toString(), labels: node.labels, properties: plain(node.properties) };
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
