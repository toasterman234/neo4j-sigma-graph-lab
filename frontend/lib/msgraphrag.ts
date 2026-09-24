import path from "node:path";
import dotenv from "dotenv";
import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";

for (const envPath of [path.resolve(process.cwd(), "../.env"), path.resolve(process.cwd(), ".env")]) {
  dotenv.config({ path: envPath, override: false });
}

const QUERY_TIMEOUT_MS = 15000;
const MAX_LIST_LIMIT = 100;
const MAX_GRAPH_NODES = 160;

let driver: Driver | undefined;

export function getMsgraphragDriver(): Driver {
  if (!driver) {
    const uri = process.env.MSGRAPHRAG_NEO4J_URI;
    const username = process.env.MSGRAPHRAG_NEO4J_USERNAME;
    const password = process.env.MSGRAPHRAG_NEO4J_PASSWORD;
    if (!uri || !username || !password) {
      throw new Error("MsGraphRAG Neo4j configuration is unavailable");
    }
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }
  return driver;
}

export function assertMsgraphragReadOnly(query: string) {
  if (!query) throw new Error("Query is empty");
  const normalized = query
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .toUpperCase();
  const forbidden =
    /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|FOREACH|GRANT|DENY|REVOKE|ALTER|RENAME|TERMINATE|TRANSACTION)\b/;
  if (forbidden.test(normalized)) throw new Error("Only read-only Cypher is allowed");
  if (!/\b(MATCH|OPTIONAL\s+MATCH|CALL|UNWIND|RETURN|WITH|SHOW|UNION)\b/.test(normalized)) {
    throw new Error("Query must contain a read clause");
  }
}

function plain(value: unknown): unknown {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

// Neo4j text properties are occasionally string arrays; normalize for display.
function textOf(value: unknown, max: number): string {
  const s = Array.isArray(value) ? value.map((v) => String(v)).join(" ") : String(value ?? "");
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

function recordToObject(record: Neo4jRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of record.keys as string[]) out[key] = plain(record.get(key));
  return out;
}

async function readRecords(query: string, parameters: Record<string, unknown> = {}) {
  assertMsgraphragReadOnly(query);
  // Retry once: the Mac -> ZimaOS Bolt connection can go stale when idle, so
  // the first query after a quiet period may fail on a dead pooled connection.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = getMsgraphragDriver().session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(query, parameters, { timeout: QUERY_TIMEOUT_MS });
      return result.records.map(recordToObject);
    } catch (error) {
      lastError = error;
    } finally {
      await session.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to query MsGraphRAG Neo4j");
}

export type CommunityListItem = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  members: number;
  excerpt: string;
  hasSummary: boolean;
};

export type CommunityListResponse = {
  communities: CommunityListItem[];
  total: number;
  limit: number;
  offset: number;
};

export async function listCommunities(options: {
  q?: string;
  level?: number | null;
  limit?: number;
  offset?: number;
  summarizedOnly?: boolean;
}): Promise<CommunityListResponse> {
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(options.limit ?? 25)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const q = (options.q ?? "").trim();
  const level = options.level === undefined || options.level === null ? null : Math.floor(options.level);
  const summarizedOnly = Boolean(options.summarizedOnly);
  const params = { q, level, summarizedOnly, skip: neo4j.int(offset), limit: neo4j.int(limit) };

  const where = `($q = '' OR toLower(c.title) CONTAINS toLower($q))
    AND ($level IS NULL OR c.level = $level)
    AND ($summarizedOnly = false OR c.summary IS NOT NULL)`;

  const countRows = await readRecords(
    `MATCH (c:__Community__) WHERE ${where} RETURN count(c) AS total`,
    params,
  );
  const rows = await readRecords(
    `MATCH (c:__Community__)
     WHERE ${where}
     OPTIONAL MATCH (e:__Entity__)-[:IN_COMMUNITY]->(c)
     WITH c, count(DISTINCT e) AS members
     RETURN c.id AS id, c.level AS level, c.title AS title, c.rating AS rating,
            members, c.summary AS summary,
            c.summary IS NOT NULL AS hasSummary
     ORDER BY c.rating DESC, members DESC, c.title ASC
     SKIP $skip LIMIT $limit`,
    params,
  );
  return {
    communities: rows.map((r) => ({
      id: String(r.id ?? ""),
      level: Number(r.level ?? 0),
      title: String(r.title ?? "Untitled community"),
      rating: typeof r.rating === "number" ? r.rating : null,
      members: Number(r.members ?? 0),
      excerpt: textOf(r.summary, 240),
      hasSummary: Boolean(r.hasSummary),
    })),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export type CommunityFinding = { summary: string; explanation: string };

export type CommunityMember = {
  name: string;
  type: string;
  description: string;
};

export type CommunityDetail = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  ratingExplanation: string;
  summary: string;
  findings: CommunityFinding[];
  parent: { id: string; title: string } | null;
  children: { id: string; title: string; level: number }[];
  members: CommunityMember[];
  memberCount: number;
};

function parseFindings(raw: unknown): CommunityFinding[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((f) => {
        const item = f as Record<string, unknown>;
        return {
          summary: String(item.summary ?? ""),
          explanation: String(item.explanation ?? ""),
        };
      })
      .filter((f) => f.summary.length > 0);
  } catch {
    return [];
  }
}

export async function getCommunity(id: string): Promise<CommunityDetail | null> {
  const rows = await readRecords(
    `MATCH (c:__Community__ {id: $id})
     OPTIONAL MATCH (c)-[:IN_COMMUNITY]->(parent:__Community__)
     OPTIONAL MATCH (child:__Community__)-[:IN_COMMUNITY]->(c)
     OPTIONAL MATCH (e:__Entity__)-[:IN_COMMUNITY]->(c)
     WITH c, parent,
          collect(DISTINCT {id: child.id, title: child.title, level: child.level}) AS children,
          collect(DISTINCT e) AS entities
     RETURN c.id AS id, c.level AS level, c.title AS title,
            c.summary AS summary, c.findings AS findings,
            c.rating AS rating, c.rating_explanation AS ratingExplanation,
            CASE WHEN parent IS NULL THEN NULL
                 ELSE {id: parent.id, title: parent.title} END AS parent,
            [x IN children WHERE x.id IS NOT NULL | x] AS children,
            size(entities) AS memberCount,
            [x IN entities | {
              name: x.name,
              labels: labels(x),
              description: x.description
            }] AS members`,
    { id },
  );
  const row = rows[0];
  if (!row) return null;
  const rawMembers = Array.isArray(row.members) ? (row.members as Record<string, unknown>[]) : [];
  const members: CommunityMember[] = rawMembers
    .filter((m) => m && typeof m.name === "string" && m.name.length > 0)
    .slice(0, 60)
    .map((m) => {
      const labels = Array.isArray(m.labels) ? (m.labels as string[]) : [];
      const type = labels.find((l) => l !== "__Entity__") ?? "Entity";
      return {
        name: String(m.name),
        type,
        description: textOf(m.description, 220),
      };
    });
  const rawChildren = Array.isArray(row.children) ? (row.children as Record<string, unknown>[]) : [];
  return {
    id: String(row.id ?? ""),
    level: Number(row.level ?? 0),
    title: String(row.title ?? "Untitled community"),
    rating: typeof row.rating === "number" ? row.rating : null,
    ratingExplanation: typeof row.ratingExplanation === "string" ? row.ratingExplanation : "",
    summary: typeof row.summary === "string" ? row.summary : "",
    findings: parseFindings(row.findings),
    parent:
      row.parent && typeof row.parent === "object"
        ? {
            id: String((row.parent as Record<string, unknown>).id ?? ""),
            title: String((row.parent as Record<string, unknown>).title ?? ""),
          }
        : null,
    children: rawChildren.slice(0, 50).map((x) => ({
      id: String(x.id ?? ""),
      title: String(x.title ?? ""),
      level: Number(x.level ?? 0),
    })),
    members,
    memberCount: Number(row.memberCount ?? members.length),
  };
}

export type GraphPayload = {
  nodes: { id: string; labels: string[]; properties: Record<string, unknown> }[];
  relationships: { id: string; source: string; target: string; type: string }[];
  counts: { nodes: number; relationships: number };
};

export async function communityGraph(id: string, maxNodes = MAX_GRAPH_NODES): Promise<GraphPayload> {
  const bounded = Math.max(10, Math.min(MAX_GRAPH_NODES, Math.floor(maxNodes)));
  const memberRows = await readRecords(
    `MATCH (c:__Community__ {id: $id})<-[:IN_COMMUNITY]-(e:__Entity__)
     RETURN elementId(e) AS eid, e.name AS name, labels(e) AS labels,
            e.description AS description
     ORDER BY e.name ASC
     LIMIT $limit`,
    { id, limit: neo4j.int(bounded) },
  );
  if (memberRows.length === 0) {
    return { nodes: [], relationships: [], counts: { nodes: 0, relationships: 0 } };
  }
  const eids = memberRows.map((r) => String(r.eid));
  const edgeRows = await readRecords(
    `MATCH (a)-[r:RELATIONSHIP|SUMMARIZED_RELATIONSHIP]-(b)
     WHERE elementId(a) IN $eids AND elementId(b) IN $eids
     RETURN elementId(a) AS s, elementId(b) AS t, type(r) AS type
     LIMIT 2000`,
    { eids },
  );

  const commRows = await readRecords(`MATCH (c:__Community__ {id: $id}) RETURN c.title AS title, c.level AS level`, {
    id,
  });
  const centerId = `community:${id}`;
  const nodes = [
    {
      id: centerId,
      labels: ["__Community__"],
      properties: {
        title: String(commRows[0]?.title ?? "Community"),
        name: String(commRows[0]?.title ?? "Community"),
        level: Number(commRows[0]?.level ?? 0),
        kind: "Community",
      },
    },
    ...memberRows.map((r) => {
      const labels = Array.isArray(r.labels) ? (r.labels as string[]) : [];
      const type = labels.find((l) => l !== "__Entity__") ?? "Entity";
      return {
        id: String(r.eid),
        labels,
        properties: {
          name: String(r.name ?? "Unnamed"),
          title: String(r.name ?? "Unnamed"),
          kind: type,
          type,
          description: textOf(r.description, 200),
        },
      };
    }),
  ];
  const memberIds = new Set(nodes.map((n) => n.id));
  const relationships = [
    ...memberRows.map((r, i) => ({
      id: `member:${i}`,
      source: centerId,
      target: String(r.eid),
      type: "IN_COMMUNITY",
    })),
    ...edgeRows
      .filter((r) => memberIds.has(String(r.s)) && memberIds.has(String(r.t)))
      .map((r, i) => ({
        id: `edge:${i}`,
        source: String(r.s),
        target: String(r.t),
        type: String(r.type),
      })),
  ];
  return { nodes, relationships, counts: { nodes: nodes.length, relationships: relationships.length } };
}

export const CANONICAL_ENTITY_TYPES = [
  "Project",
  "System",
  "Repository",
  "Agent",
  "Service",
  "Decision",
  "Artifact",
  "Activity",
  "Observation",
  "Requirement",
  "Event",
  "Technology",
  "Process",
  "Person",
  "Organization",
] as const;

export type HierarchyNode = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  members: number;
  hasSummary: boolean;
  children: HierarchyNode[];
};

export type HierarchyResponse = {
  roots: HierarchyNode[];
  total: number;
};

type RawHierarchyNode = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  members: number;
  hasSummary: boolean;
  parentId: string | null;
  children: RawHierarchyNode[];
};

export async function getHierarchy(): Promise<HierarchyResponse> {
  const rows = await readRecords(
    `MATCH (c:__Community__)
     OPTIONAL MATCH (c)-[:IN_COMMUNITY]->(p:__Community__)
     OPTIONAL MATCH (e:__Entity__)-[:IN_COMMUNITY]->(c)
     WITH c, p, count(DISTINCT e) AS members
     RETURN c.id AS id, c.level AS level, c.title AS title, c.rating AS rating,
            c.summary IS NOT NULL AS hasSummary, members,
            p.id AS parentId`,
  );
  const byId = new Map<string, RawHierarchyNode>();
  for (const r of rows) {
    const id = String(r.id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      level: Number(r.level ?? 0),
      title: String(r.title ?? "Untitled community"),
      rating: typeof r.rating === "number" ? r.rating : null,
      members: Number(r.members ?? 0),
      hasSummary: Boolean(r.hasSummary),
      parentId: r.parentId == null ? null : String(r.parentId),
      children: [],
    });
  }
  const roots: RawHierarchyNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (a: RawHierarchyNode, b: RawHierarchyNode) =>
    b.level - a.level ||
    (b.rating ?? -1) - (a.rating ?? -1) ||
    a.title.localeCompare(b.title);
  const sortTree = (nodes: RawHierarchyNode[]) => {
    nodes.sort(sortNodes);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);
  const strip = (n: RawHierarchyNode): HierarchyNode => ({
    id: n.id,
    level: n.level,
    title: n.title,
    rating: n.rating,
    members: n.members,
    hasSummary: n.hasSummary,
    children: n.children.map(strip),
  });
  return { roots: roots.map(strip), total: byId.size };
}

export type TypeAggregateResponse = {
  types: { type: string; count: number }[];
  edges: { t1: string; t2: string; count: number }[];
  totalEntities: number;
  totalRelationships: number;
};

export async function getTypeAggregate(): Promise<TypeAggregateResponse> {
  const types = [...CANONICAL_ENTITY_TYPES];
  const [countRows, totalRows, edgeRows] = await Promise.all([
    readRecords(
      `MATCH (e:__Entity__)
       WITH e, [l IN labels(e) WHERE l <> '__Entity__'][0] AS t
       WHERE t IN $types
       RETURN t AS type, count(*) AS n`,
      { types },
    ),
    readRecords(`MATCH (e:__Entity__) RETURN count(*) AS n`),
    readRecords(
      `MATCH (a:__Entity__)-[r:RELATIONSHIP|SUMMARIZED_RELATIONSHIP]-(b:__Entity__)
       // Undirected patterns match each relationship twice (once per direction);
       // elementId ordering keeps exactly one row per relationship, self-loops included.
       WHERE elementId(a) <= elementId(b)
       WITH a, b,
            [l IN labels(a) WHERE l <> '__Entity__'][0] AS ta,
            [l IN labels(b) WHERE l <> '__Entity__'][0] AS tb
       WHERE ta IN $types AND tb IN $types
       WITH CASE WHEN ta <= tb THEN ta ELSE tb END AS t1,
            CASE WHEN ta <= tb THEN tb ELSE ta END AS t2,
            count(*) AS n
       RETURN t1, t2, n
       ORDER BY n DESC`,
      { types },
    ),
  ]);
  const counted = new Map<string, number>();
  for (const r of countRows) counted.set(String(r.type ?? ""), Number(r.n ?? 0));
  const typeList = types.map((t) => ({ type: t, count: counted.get(t) ?? 0 }));
  const edges = edgeRows.map((r) => ({
    t1: String(r.t1 ?? ""),
    t2: String(r.t2 ?? ""),
    count: Number(r.n ?? 0),
  }));
  const totalRelationships = edges.reduce((sum, e) => sum + e.count, 0);
  return {
    types: typeList,
    edges,
    totalEntities: Number(totalRows[0]?.n ?? 0),
    totalRelationships,
  };
}
