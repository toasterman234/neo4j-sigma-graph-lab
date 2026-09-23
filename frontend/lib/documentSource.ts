export type NodePayload = { id: string; labels: string[]; properties: Record<string, unknown> };
export type EdgePayload = { id: string; source: string; target: string; type: string };
export type GraphPayload = { nodes: NodePayload[]; relationships: EdgePayload[]; counts?: { nodes: number; relationships: number } };

export type SourceSummary = {
  key: string;
  title: string;
  path: string;
  originUri: string;
  sourceType: string;
  created?: string;
  modified?: string;
  ingested?: string;
  content: string;
  chunks: NodePayload[];
  semanticNodeIds: string[];
};

const TECHNICAL_LABELS = new Set(["Chunk", "DocumentId", "Entity", "SemanticEntity"]);

export function humanizeLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (character) => character.toUpperCase());
}

export function humanizeRelationship(value: string): string {
  return humanizeLabel(value).toLowerCase();
}

function opaque(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  return /^[a-f0-9]{24,}$/i.test(compact) || /^[a-z0-9+/]{28,}={0,2}$/i.test(compact);
}

function semanticName(value: string): string | undefined {
  const match = value.match(/(?:^|-)kb-(.+)$/i);
  const candidate = (match?.[1] || value).replace(/[_-]+/g, " ").trim();
  return candidate && !opaque(candidate) ? humanizeLabel(candidate) : undefined;
}

export function humanizeNodeTitle(node: NodePayload): string | undefined {
  const properties = node.properties || {};
  for (const key of ["name", "title", "label"]) {
    const value = text(properties[key]);
    if (value && !opaque(value)) return value;
  }
  const neptuneId = text(properties.neptune_id);
  if (neptuneId) return semanticName(neptuneId);
  const meaningfulLabel = node.labels.find((label) => !TECHNICAL_LABELS.has(label));
  return meaningfulLabel ? humanizeLabel(meaningfulLabel) : undefined;
}

export function displayLabel(node: NodePayload): string {
  const label = node.labels[0] || "Node";
  if (label === "Chunk") return "Document";
  if (label === "DocumentId") return "Document reference";
  if (label === "Entity" || label === "SemanticEntity") return "Concept";
  return humanizeLabel(label);
}

function humanizeNode(node: NodePayload): NodePayload | undefined {
  const title = humanizeNodeTitle(node);
  const technical = node.labels.some((label) => TECHNICAL_LABELS.has(label));
  if (technical && !title) return undefined;
  return { ...node, properties: { ...node.properties, _displayTitle: title || displayLabel(node), _displayLabel: displayLabel(node) } };
}

const SOURCE_URI_KEYS = [
  "metadata_x-amz-bedrock-kb-source-uri",
  "sourceUri",
  "sourceUrl",
  "source_uri",
  "source",
  "uri",
  "path",
];
const DATE_KEYS = ["created", "createdAt", "creationDate", "documentCreatedAt", "modified", "modifiedAt", "lastModified", "ingested", "ingestedAt", "ingestionDate"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataFor(node: NodePayload): Record<string, unknown> {
  const metadata = node.properties.metadata;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch { /* metadata is often a non-JSON ingestion string */ }
  }
  return metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
}

function valueFrom(node: NodePayload, keys: string[]): string | undefined {
  const metadata = metadataFor(node);
  for (const key of keys) {
    const value = text(node.properties[key]) ?? text(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function sourceUri(node: NodePayload): string | undefined {
  return valueFrom(node, SOURCE_URI_KEYS);
}

function filename(uri: string): string {
  const clean = decodeURIComponent(uri.split(/[?#]/, 1)[0]).replace(/\\/g, "/").replace(/\/$/, "");
  return clean.split("/").pop() || clean;
}

function relativePath(uri: string): string {
  const clean = decodeURIComponent(uri.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  const vaultMarker = clean.search(/(?:^|\/)(?:ben-)?vault\//i);
  if (vaultMarker >= 0) return clean.slice(vaultMarker + 1).replace(/^ben-vault\//i, "");
  const marker = clean.search(/(?:^|\/)(?:ingest|documents?|source)\//i);
  return marker >= 0 ? clean.slice(marker + 1) : clean.replace(/^[a-z]+:\/\/[^/]+\/?/i, "");
}

function sourceType(uri: string, node: NodePayload): string {
  const explicit = valueFrom(node, ["sourceType", "contentType", "mimeType", "type"]);
  if (explicit && !["Chunk", "Document", "Source"].includes(explicit)) return explicit;
  const extension = filename(uri).match(/\.([a-z0-9]+)$/i)?.[1];
  return extension ? extension.toUpperCase() : "Document";
}

function chunkOrder(node: NodePayload): number {
  const value = valueFrom(node, ["chunkIndex", "chunk_index", "ordinal", "index", "position"]);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sourceDate(nodes: NodePayload[], keys: string[]): string | undefined {
  for (const node of nodes) {
    const value = valueFrom(node, keys);
    if (value) return value;
  }
  return undefined;
}

function sourceKey(node: NodePayload): string | undefined {
  const uri = sourceUri(node);
  if (uri) return uri;
  const pathValue = valueFrom(node, ["path", "filename", "fileName", "title"]);
  return pathValue ? `local:${pathValue}` : undefined;
}

export function isChunk(node: NodePayload): boolean {
  return node.labels.includes("Chunk") || "text" in node.properties || SOURCE_URI_KEYS.some((key) => key in node.properties);
}

export function sourceTitle(source: SourceSummary): string {
  return source.title || filename(source.originUri) || source.path;
}

export function buildDocumentSourceView(payload: GraphPayload): { payload: GraphPayload; sources: Map<string, SourceSummary> } {
  const chunkGroups = new Map<string, NodePayload[]>();
  const chunkToSource = new Map<string, string>();
  const sources = new Map<string, SourceSummary>();

  payload.nodes.filter(isChunk).forEach((node) => {
    const key = sourceKey(node);
    if (!key) return;
    const group = chunkGroups.get(key) || [];
    group.push(node);
    chunkGroups.set(key, group);
    chunkToSource.set(node.id, `source:${key}`);
  });

  chunkGroups.forEach((chunks, key) => {
    const ordered = [...chunks].sort((a, b) => chunkOrder(a) - chunkOrder(b));
    const originUri = sourceUri(ordered[0]) || key.replace(/^local:/, "");
    const firstTitle = valueFrom(ordered[0], ["title", "name", "filename", "fileName"]);
    const contentParts = ordered.map((chunk) => text(metadataFor(chunk).parentText) || text(chunk.properties.text)).filter((part): part is string => Boolean(part));
    const content = Array.from(new Set(contentParts)).join("\n\n");
    sources.set(`source:${key}`, {
      key: `source:${key}`,
      title: firstTitle || filename(originUri),
      path: relativePath(originUri),
      originUri,
      sourceType: sourceType(originUri, ordered[0]),
      created: sourceDate(ordered, ["created", "createdAt", "creationDate", "documentCreatedAt"]),
      modified: sourceDate(ordered, ["modified", "modifiedAt", "lastModified"]),
      ingested: sourceDate(ordered, ["ingested", "ingestedAt", "ingestionDate"]),
      content,
      chunks: ordered,
      semanticNodeIds: [],
    });
  });

  const nodes: NodePayload[] = [];
  payload.nodes.forEach((node) => {
    const sourceId = chunkToSource.get(node.id);
    if (sourceId) {
      if (nodes.some((candidate) => candidate.id === sourceId)) return;
      const source = sources.get(sourceId)!;
      nodes.push({
        id: sourceId,
        labels: ["Document", "Source"],
        properties: {
          name: source.title,
          title: source.title,
          path: source.path,
          sourceUri: source.originUri,
          sourceType: source.sourceType,
          ...(source.created ? { created: source.created } : {}),
          ...(source.modified ? { modified: source.modified } : {}),
          ...(source.ingested ? { ingested: source.ingested } : {}),
          _source: source,
        },
      });
      return;
    }
    const humanNode = humanizeNode(node);
    if (humanNode) nodes.push(humanNode);
  });

  const seenEdges = new Set<string>();
  const relationships: EdgePayload[] = [];
  payload.relationships.forEach((edge) => {
    const source = chunkToSource.get(edge.source) || edge.source;
    const target = chunkToSource.get(edge.target) || edge.target;
    if (source === target || !nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) return;
    const dedupeKey = `${source}|${target}|${edge.type}`;
    if (seenEdges.has(dedupeKey)) return;
    seenEdges.add(dedupeKey);
    relationships.push({ ...edge, id: `${edge.id}:${source}:${target}`, source, target });
    const targetNode = payload.nodes.find((node) => node.id === target);
    const sourceNode = payload.nodes.find((node) => node.id === edge.source);
    if (sources.has(source) && targetNode && !isChunk(targetNode)) sources.get(source)!.semanticNodeIds.push(target);
    if (sources.has(target) && sourceNode && !isChunk(sourceNode)) sources.get(target)!.semanticNodeIds.push(source);
  });

  sources.forEach((source) => { source.semanticNodeIds = Array.from(new Set(source.semanticNodeIds)); });
  return { payload: { ...payload, nodes, relationships, counts: { nodes: nodes.length, relationships: relationships.length } }, sources };
}

export function displayDate(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function rawSourceProperties(source: SourceSummary): Record<string, unknown> {
  return Object.fromEntries(source.chunks.map((chunk) => [chunk.id, chunk.properties]));
}
