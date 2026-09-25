import "server-only";

import { runJev } from "@/lib/questions/runner";
import { displayLabel, humanizeNodeTitle, humanizeRelationship } from "@/lib/documentSource";
import { saveModelProposals, type ModelProposal } from "@/lib/proposalStore";
import { searchGraph, type SearchMode, type SearchScope } from "@/lib/sigmaNeo4j";

type ContextNode = { id: string; labels: string[]; properties: Record<string, unknown> };

function nodeTitle(node: ContextNode): string {
  return humanizeNodeTitle(node) || displayLabel(node);
}

function nodeLabel(node: ContextNode): string { return displayLabel(node); }

function confidenceForCount(count: number): number { return Math.min(0.96, 0.58 + count / 20); }

export async function draftModelProposals(input: { query: string; scope: SearchScope; mode: SearchMode; selectedNodeIds?: string[] }): Promise<{ proposals: ModelProposal[]; boundedContext: { nodes: number; relationships: number }; judgment: Record<string, unknown> }> {
  const search = await searchGraph(input.query, input.scope, input.mode, input.selectedNodeIds || [], 60);
  const jev = await runJev({ question: "Which schema types and relationships should be reviewed as proposals from this bounded graph context? Identify missing or meaningful relationships, but do not authorize writes.", questionType: "missing_relationship", search });
  const proposals: ModelProposal[] = [];
  const nodesById = new Map(search.context.nodes.map((node) => [node.id, node]));
  const evidenceFor = (ids: string[]) => jev.evidence.filter((item) => ids.includes(item.id)).slice(0, 6).length ? jev.evidence.filter((item) => ids.includes(item.id)).slice(0, 6) : jev.evidence.slice(0, 4);
  const semanticNodes = search.context.nodes.filter((node) => node.labels.some((label) => !["Chunk", "DocumentId"].includes(label))) as ContextNode[];
  const labelGroups = new Map<string, ContextNode[]>();
  semanticNodes.forEach((node) => { const label = nodeLabel(node); labelGroups.set(label, [...(labelGroups.get(label) || []), node]); });
  labelGroups.forEach((nodes, label) => {
    const examples = nodes.map(nodeTitle).filter(Boolean).slice(0, 4).join(", ");
    proposals.push({ id: `node-type:${label}`, createdAt: new Date().toISOString(), query: input.query, kind: "node_type", title: `Model concept type: ${label}`, rationale: `The bounded retrieval contains ${nodes.length} named graph object${nodes.length === 1 ? "" : "s"} in the ${label} category${examples ? `, including ${examples}` : ""}. Review whether this should be a governed schema type.`, confidence: confidenceForCount(nodes.length), evidence: evidenceFor(nodes.map((node) => node.id)), status: "pending" });
  });
  const patterns = new Map<string, { sourceLabel: string; targetLabel: string; type: string; ids: string[] }>();
  search.context.relationships.forEach((edge) => {
    const source = nodesById.get(edge.source); const target = nodesById.get(edge.target);
    if (!source || !target || source.labels.includes("DocumentId") || target.labels.includes("DocumentId")) return;
    const sourceLabel = nodeLabel(source as ContextNode); const targetLabel = nodeLabel(target as ContextNode); const type = humanizeRelationship(edge.type);
    const key = `${sourceLabel}|${type}|${targetLabel}`;
    const current = patterns.get(key) || { sourceLabel, targetLabel, type, ids: [] as string[] };
    current.ids.push(edge.source, edge.target); patterns.set(key, current);
  });
  patterns.forEach((pattern) => proposals.push({ id: `pattern:${pattern.sourceLabel}:${pattern.type}:${pattern.targetLabel}`, createdAt: new Date().toISOString(), query: input.query, kind: "relationship_pattern", title: `${pattern.sourceLabel} -[${pattern.type}]-> ${pattern.targetLabel}`, sourceLabel: pattern.sourceLabel, targetLabel: pattern.targetLabel, relationshipType: pattern.type, rationale: `This relationship pattern was observed ${pattern.ids.length / 2} time${pattern.ids.length === 2 ? "" : "s"} in the bounded graph context. Confirm whether it belongs in the proposed schema.`, confidence: confidenceForCount(pattern.ids.length / 2), evidence: evidenceFor(Array.from(new Set(pattern.ids))), status: "pending" }));
  const missing = (jev.judgment.answers as { missing_relationship?: { probability?: number } } | undefined)?.missing_relationship?.probability || 0;
  jev.proposedRelationships.forEach((candidate) => {
    const source = nodesById.get(candidate.sourceId); const target = nodesById.get(candidate.targetId);
    if (!source || !target) return;
    const sourceNode = source as ContextNode; const targetNode = target as ContextNode; const relationshipType = humanizeRelationship(candidate.type);
    proposals.push({ id: `relationship:${candidate.sourceId}:${candidate.type}:${candidate.targetId}`, createdAt: new Date().toISOString(), query: input.query, kind: "relationship", title: `${nodeTitle(sourceNode)} -[${relationshipType}]-> ${nodeTitle(targetNode)}`, sourceId: source.id, sourceLabel: nodeLabel(sourceNode), targetId: target.id, targetLabel: nodeLabel(targetNode), relationshipType, rationale: candidate.reason, confidence: missing, evidence: jev.evidence.slice(0, 8), status: "pending" });
  });
  return { proposals: saveModelProposals(proposals.slice(0, 40)), boundedContext: { nodes: Math.min(search.context.nodes.length, 24), relationships: Math.min(search.context.relationships.length, 40) }, judgment: jev.judgment };
}
