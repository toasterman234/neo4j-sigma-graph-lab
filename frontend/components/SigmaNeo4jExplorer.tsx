"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { LabNav } from "@/components/LabNav";
import { buildDocumentSourceView, displayDate, displayLabel, humanizeRelationship, rawSourceProperties, type GraphPayload, type NodePayload, type SourceSummary } from "@/lib/documentSource";
import type { SearchMode, SearchResult, SearchScope } from "@/lib/sigmaNeo4j";
import { DEFAULT_QUESTION_ID, QUESTION_CATALOG, getQuestionDefinition } from "@/lib/questions/catalog";

const DEFAULT_QUERY = "MATCH (n)-[r]-(m) RETURN n, r, m LIMIT $limit";
const palette = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f97316"];

function labelOf(node: NodePayload) { return String(node.properties._displayLabel ?? displayLabel(node)); }
function titleOf(node: NodePayload) {
  const p = node.properties || {};
  return String(p._displayTitle ?? p.name ?? p.title ?? p.path ?? displayLabel(node));
}
function colorOf(node: NodePayload) { return node.labels.join(":").includes("Document") ? "#22d3ee" : palette[node.labels.join(":").length % palette.length]; }
function mergePayload(graph: Graph, payload: GraphPayload) {
  payload.nodes.forEach((node, index) => {
    if (!graph.hasNode(node.id)) graph.addNode(node.id, {
      label: titleOf(node), size: node.labels.includes("Document") ? 13 : 8, color: colorOf(node), x: Math.cos(index * 0.7) * 10, y: Math.sin(index * 0.7) * 10,
      explorerLabels: node.labels, explorerDisplayLabel: labelOf(node), explorerProperties: node.properties,
    });
    else graph.mergeNodeAttributes(node.id, { explorerLabels: node.labels, explorerDisplayLabel: labelOf(node), explorerProperties: node.properties });
  });
  payload.relationships.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target) && !graph.hasEdge(edge.id)) {
      try { graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { label: humanizeRelationship(edge.type), size: 1.5, color: "#94a3b8", explorerType: edge.type }); } catch { /* duplicate edge key from bounded overlap */ }
    }
  });
}

function semanticNodes(source: SourceSummary, nodesById: Map<string, NodePayload>): NodePayload[] {
  return source.semanticNodeIds.map((id) => nodesById.get(id)).filter((node): node is NodePayload => Boolean(node));
}

type SavedResult = { id: number; createdAt: string; query: string; scope: SearchScope; mode: SearchMode; question: string; questionMeta?: { id: string; version: number; title: string; group: string; mode: string }; sourceContext?: { query: string; scope: string; searchMode: string; selectedNodeIds: string[]; userNote?: string }; boundedNodeCount: number; boundedRelationshipCount: number; resultCount: number; judgment: Record<string, unknown>; confidence: Record<string, number>; evidence: Array<{ id: string; title: string; excerpt: string; kind: string }>; proposedRelationships: Array<{ sourceId: string; targetId: string; type: string; status?: string; reason?: string }> };
type JevAnswer = { type?: string; probability?: number; choice?: string; probabilities?: Record<string, number>; score?: number };
const answerLabels: Record<string, string> = { missing_relationship: "Missing relationship", supersession: "Supersession", temporal_status: "Temporal status", evidence_alignment: "Evidence alignment", candidate_relationship: "Candidate relationship", question_focus: "Question focus" };
const scopeOptions: Array<{ value: SearchScope; label: string; detail: string }> = [{ value: "whole", label: "Whole graph", detail: "Search all bounded graph context" }, { value: "neighborhood", label: "Neighborhood", detail: "Search around selected nodes" }, { value: "selected", label: "Selected node", detail: "Search selected source or node" }];
const modeOptions: Array<{ value: SearchMode; label: string; detail: string }> = [{ value: "keyword", label: "Keyword", detail: "Names, text, and properties" }, { value: "property", label: "Properties", detail: "Structured fields, excluding document text" }, { value: "document", label: "Documents", detail: "Source identity and content" }, { value: "relationship", label: "Relationships", detail: "Relationship types and paths" }];

function answerEntries(reasoning: Record<string, unknown> | null): Array<[string, JevAnswer]> {
  const answers = reasoning?.judgment && typeof reasoning.judgment === "object" ? (reasoning.judgment as { answers?: Record<string, JevAnswer> }).answers : undefined;
  return answers ? Object.entries(answers) : [];
}

function answerTitle(id: string): string {
  const [questionId, criterion] = id.split("__", 2);
  const definition = getQuestionDefinition(questionId);
  if (definition && criterion) return `${definition.title}: ${criterion.replaceAll("_", " ")}`;
  if (definition) return definition.title;
  return answerLabels[id] || id.replaceAll("_", " ");
}
function scorePercent(value: number): string { return `${Math.max(0, Math.min(1, value)) * 100}%`; }

function JevAnswerCard({ id, answer, confidence }: { id: string; answer: JevAnswer; confidence?: number }) {
  const probability = typeof answer.probability === "number" ? answer.probability : undefined;
  const distributions = answer.probabilities ? Object.entries(answer.probabilities).sort(([, left], [, right]) => right - left) : [];
  return <article className="jev-answer-card"><div className="jev-answer-heading"><strong>{answerTitle(id)}</strong><span className="sigma-badge">{answer.type === "boolean" ? "noul" : answer.type || "choice"}</span></div>{probability !== undefined && <><div className="jev-answer-value">{probability >= 0.5 ? "Likely true" : "Likely false"} <strong>{probability.toFixed(2)}</strong></div><div className="jev-meter"><span style={{ width: scorePercent(probability) }} /></div></>}{answer.choice && <div className="jev-answer-value"><strong>{answer.choice}</strong></div>}{typeof answer.score === "number" && <div className="jev-answer-value"><strong>{answer.score.toFixed(2)}</strong><span className="sigma-muted"> score</span></div>}{distributions.length > 0 && <div className="jev-distribution">{distributions.map(([label, value]) => <div key={label} className="jev-distribution-row"><span>{label}</span><div className="jev-meter"><span style={{ width: scorePercent(value) }} /></div><b>{value.toFixed(2)}</b></div>)}</div>}{confidence !== undefined && <div className="jev-answer-confidence">Provider confidence {confidence.toFixed(2)}</div>}</article>;
}

export function SigmaNeo4jExplorer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph({ type: "directed", multi: true }));
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [selected, setSelected] = useState<NodePayload | null>(null);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchScope, setSearchScope] = useState<SearchScope>("whole");
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [reasonQuestion, setReasonQuestion] = useState("");
  const [questionId, setQuestionId] = useState(DEFAULT_QUESTION_ID);
  const [reasoning, setReasoning] = useState<Record<string, unknown> | null>(null);
  const [reasonBusy, setReasonBusy] = useState(false);
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<number | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [hiddenLabels, setHiddenLabels] = useState<string[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading real Neo4j data…");
  const [busy, setBusy] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const view = useMemo(() => payload ? buildDocumentSourceView(payload) : null, [payload]);
  const visiblePayload = view?.payload || null;
  const selectedSource = selected?.labels.includes("Document") ? view?.sources.get(selected.id) : null;
  const nodesById = useMemo(() => new Map((visiblePayload?.nodes || []).map((n) => [n.id, n])), [visiblePayload]);
  const allLabels = useMemo(() => Array.from(new Set((visiblePayload?.nodes || []).map((node) => labelOf(node)))).sort(), [visiblePayload]);
  const allTypes = useMemo(() => Array.from(new Set((visiblePayload?.relationships || []).map((r) => r.type))).sort(), [visiblePayload]);
  const resultGroups = useMemo(() => ({
    Sources: searchResults.filter((result) => result.kind === "source"),
    Nodes: searchResults.filter((result) => result.kind === "node"),
    Relationships: searchResults.filter((result) => result.kind === "relationship"),
  }), [searchResults]);
  const selectedQuestion = useMemo(() => getQuestionDefinition(questionId) || QUESTION_CATALOG[0], [questionId]);
  const canRunQuestion = selectedQuestion.mode === "item" ? Boolean(selected) : Boolean(search.trim());

  async function load(url: string) {
    setBusy(true);
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neo4j request failed");
      setPayload(data); setStatus(`${data.counts?.nodes ?? data.nodes.length} graph nodes · ${data.counts?.relationships ?? data.relationships.length} relationships · document view · read-only`);
      return data as GraphPayload;
    } catch (error) { setStatus(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function runQuery() { await load(`/api/explorer/graph?limit=300&query=${encodeURIComponent(query)}`); }
  async function expand() {
    if (!selected) return;
    const sourceChunk = selectedSource?.chunks[0];
    const nodeId = sourceChunk?.id || selected.id;
    await load(`/api/explorer/expand?nodeId=${encodeURIComponent(nodeId)}&limit=160`);
  }

  useEffect(() => { void load("/api/explorer/graph?limit=300"); void fetch("/api/results").then((response) => response.json()).then((data) => setSavedResults(data.results || [])).catch(() => undefined); }, []);
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      const selectedIds = selectedSource ? selectedSource.chunks.map((chunk) => chunk.id).slice(0, 20) : selected ? [selected.id] : [];
      const response = await fetch(`/api/explorer/search?q=${encodeURIComponent(search)}&scope=${searchScope}&mode=${searchMode}&selected=${encodeURIComponent(selectedIds.join(","))}&limit=40`);
      const data = await response.json(); setSearchResults(data.results || []);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, searchScope, searchMode, selected]);
  useEffect(() => {
    if (!containerRef.current || !visiblePayload) return;
    const graph = graphRef.current;
    graph.clear(); mergePayload(graph, visiblePayload);
    sigmaRef.current?.kill();
    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true, defaultEdgeType: "arrow", labelColor: { color: "#e2e8f0" }, edgeLabelColor: { color: "#cbd5e1" },
      nodeReducer: (node, attrs) => { const hidden = hiddenLabels.includes(String(attrs.explorerDisplayLabel || "")); return { ...attrs, hidden, label: hidden ? "" : attrs.label }; },
      edgeReducer: (edge, attrs) => ({ ...attrs, hidden: hiddenTypes.includes(String(attrs.explorerType)) }),
    });
    renderer.on("clickNode", ({ node }) => { const found = nodesById.get(String(node)); if (found) setSelected(found); renderer.getCamera().animate({ ...renderer.getNodeDisplayData(node), ratio: 0.35 }, { duration: 500 }); });
    sigmaRef.current = renderer;
    return () => renderer.kill();
  }, [visiblePayload, hiddenLabels, hiddenTypes, nodesById]);

  function focus(node: NodePayload) {
    const source = view && Array.from(view.sources.values()).find((candidate) => candidate.chunks.some((chunk) => chunk.id === node.id));
    const visibleNode = source ? visiblePayload?.nodes.find((candidate) => candidate.id === source.key) : node;
    if (!visibleNode) return;
    setSelected(visibleNode); setSearch("");
    const renderer = sigmaRef.current;
    if (renderer && graphRef.current.hasNode(visibleNode.id)) renderer.getCamera().animate({ ...renderer.getNodeDisplayData(visibleNode.id), ratio: 0.25 }, { duration: 500 });
  }
  function focusResult(result: SearchResult) {
    const id = result.kind === "relationship" ? result.sourceNodeIds?.[0] : result.id;
    if (!id) return;
    const node = visiblePayload?.nodes.find((candidate) => candidate.id === id);
    if (node) return focus(node);
    focus({ id, labels: result.labels, properties: result.properties || { title: result.title } });
  }
  async function reasonWithJev() {
    const selectedNodeIds = selectedSource ? selectedSource.chunks.map((chunk) => chunk.id).slice(0, 20) : selected ? [selected.id] : [];
    const queryText = selectedQuestion.mode === "item"
      ? (search.trim() || selectedSource?.title || (selected ? titleOf(selected) : selectedQuestion.title))
      : search.trim();
    if (!queryText || (selectedQuestion.mode === "item" && !selectedNodeIds.length)) return;
    setReasonBusy(true); setReasoning(null); setActiveSavedId(null);
    try {
      const response = await fetch("/api/jev/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: queryText,
          scope: searchScope,
          mode: searchMode,
          selectedNodeIds,
          question: reasonQuestion,
          questionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Jev request failed");
      setReasoning(data);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Jev request failed"); }
    finally { setReasonBusy(false); }
  }
  function openSavedResult(result: SavedResult) {
    setActiveSavedId(result.id);
    setSearch(result.query); setSearchScope(result.scope); setSearchMode(result.mode);
    if (result.questionMeta?.id && getQuestionDefinition(result.questionMeta.id)) setQuestionId(result.questionMeta.id);
    setReasonQuestion(result.sourceContext?.userNote || "");
    setReasoning({
      question: result.question,
      questionMeta: result.questionMeta,
      sourceContext: result.sourceContext,
      boundedContext: { nodeCount: result.boundedNodeCount, relationshipCount: result.boundedRelationshipCount, resultCount: result.resultCount },
      judgment: result.judgment,
      confidence: result.confidence,
      evidence: result.evidence,
      proposedRelationships: result.proposedRelationships,
    });
    setStatus(`Opened saved Jev result #${result.id}`);
  }
  async function saveReasoning() {
    if (!reasoning) return;
    const sourceContext = reasoning.sourceContext as { query?: string; scope?: SearchScope; searchMode?: SearchMode } | undefined;
    const saveQuery = sourceContext?.query || search.trim() || selectedQuestion.title;
    setSaveBusy(true);
    try {
      const response = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: saveQuery,
          scope: sourceContext?.scope || searchScope,
          mode: sourceContext?.searchMode || searchMode,
          result: reasoning,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save result");
      setSavedResults((current) => [data.result, ...current.filter((result) => result.id !== data.result.id)].slice(0, 100));
      setStatus(`Saved Jev result #${data.result.id} locally in SQLite`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to save result"); }
    finally { setSaveBusy(false); }
  }
  function toggle(items: string[], value: string, setter: (value: string[]) => void) { setter(items.includes(value) ? items.filter((x) => x !== value) : [...items, value]); }

  return <div className="sigma-explorer">
    <LabNav active="explorer" />
    <div className="sigma-toolbar"><div><strong>Neo4j Sigma Explorer</strong><span className="sigma-muted"> document/source view · raw evidence on demand</span></div><button onClick={runQuery} disabled={busy}>{busy ? "Loading…" : "Run Cypher"}</button><button onClick={expand} disabled={!selected || busy}>Expand selected</button></div>
    <div className="sigma-controls">
      <div className="sigma-search-heading"><strong>Graph-wide search</strong><span className="sigma-muted">retrieval is bounded before any Jev reasoning</span></div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search graph extraction, Neo4j decisions, related documents…" />
      <div className="sigma-selector-group"><span>Scope</span><div className="sigma-segmented" role="group" aria-label="Search scope">{scopeOptions.map((option) => <button key={option.value} className={searchScope === option.value ? "selected" : ""} title={option.detail} onClick={() => setSearchScope(option.value)}>{option.label}</button>)}</div></div>
      <div className="sigma-selector-group"><span>Mode</span><div className="sigma-segmented" role="group" aria-label="Search mode">{modeOptions.map((option) => <button key={option.value} className={searchMode === option.value ? "selected" : ""} title={option.detail} onClick={() => setSearchMode(option.value)}>{option.label}</button>)}</div></div>
      <div className="sigma-search-actions"><button className="sigma-primary-button" onClick={reasonWithJev} disabled={!canRunQuestion || reasonBusy}>{reasonBusy ? "Reasoning…" : "Run catalog question"}</button>{search && <button onClick={() => { setSearch(""); setSearchResults([]); setReasoning(null); setActiveSavedId(null); }}>Clear search</button>}</div>
      {searchResults.length > 0 && <div className="sigma-search-results">{Object.entries(resultGroups).map(([group, results]) => results.length > 0 && <div key={group}><h4>{group} <small>{results.length}</small></h4>{results.map((result) => <button key={`${result.kind}:${result.id}`} onClick={() => focusResult(result)}><strong>{result.title}</strong><span>{result.labels.join(" · ")} · {result.snippet}</span></button>)}</div>)}</div>}
      <div className="sigma-selector-group"><span>Question catalog</span><select aria-label="Jev catalog question" value={questionId} onChange={(e) => { setQuestionId(e.target.value); setReasoning(null); setActiveSavedId(null); }}>{QUESTION_CATALOG.map((question) => <option key={question.id} value={question.id}>{question.group} · {question.title}</option>)}</select><span className="sigma-muted">{selectedQuestion.mode} · v{selectedQuestion.version} · {selectedQuestion.description}</span><input aria-label="Optional Jev context note" value={reasonQuestion} onChange={(e) => setReasonQuestion(e.target.value)} placeholder="Optional extra context for this run…" />{selectedQuestion.mode === "item" && !selected && <small className="sigma-muted">Select a document/source or graph object to run this item question.</small>}{selectedQuestion.mode === "graph" && !search.trim() && <small className="sigma-muted">Enter a bounded graph search query to run this relationship question.</small>}</div>
      <textarea value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Read-only Cypher query" />
      <div className="sigma-filter-row"><span>Hide labels:</span>{allLabels.slice(0, 12).map((label) => <button key={label} className={hiddenLabels.includes(label) ? "active" : ""} onClick={() => toggle(hiddenLabels, label, setHiddenLabels)}>{label}</button>)}</div><div className="sigma-filter-row"><span>Hide relationships:</span>{allTypes.slice(0, 12).map((type) => <button key={type} className={hiddenTypes.includes(type) ? "active" : ""} onClick={() => toggle(hiddenTypes, type, setHiddenTypes)}>{humanizeRelationship(type)}</button>)}</div>
    </div>
    <div className="sigma-status">{status}</div>
    {reasoning && <section className="sigma-reasoning"><div><div><strong>{activeSavedId ? `Saved result #${activeSavedId}` : "Provider response"}</strong><span className="sigma-badge">{activeSavedId ? "saved" : "unverified decision"}</span></div><span className="sigma-muted">{String((reasoning.questionMeta as { title?: string; group?: string; mode?: string } | undefined)?.title || "Jev judgment")} · {String((reasoning.questionMeta as { group?: string } | undefined)?.group || "legacy")} · {String((reasoning.questionMeta as { mode?: string } | undefined)?.mode || "graph")}</span><span className="sigma-muted">bounded context: {String((reasoning.boundedContext as { nodeCount?: number })?.nodeCount || 0)} nodes · {String((reasoning.boundedContext as { relationshipCount?: number })?.relationshipCount || 0)} relationships</span><button className="sigma-save-button" onClick={saveReasoning} disabled={saveBusy}>{saveBusy ? "Saving…" : "Save result"}</button></div><div className="jev-answer-grid">{answerEntries(reasoning).map(([id, answer]) => <JevAnswerCard key={id} id={id} answer={answer} confidence={(reasoning.confidence as Record<string, number> | undefined)?.[id]} />)}</div><p className="sigma-unverified-note">Typed judgment, not proof. Review the evidence before acting.</p>{Array.isArray(reasoning.evidence) && <><h4>Supporting evidence</h4><div className="sigma-evidence-list">{(reasoning.evidence as Array<{ id: string; title: string; excerpt: string }>).map((item) => <button key={item.id} onClick={() => focusResult({ id: item.id, kind: "source", labels: [], title: item.title, snippet: item.excerpt })}>{item.title}: {item.excerpt}</button>)}</div></>}{Array.isArray(reasoning.proposedRelationships) && (reasoning.proposedRelationships as Array<{ sourceId: string; targetId: string; type: string }>).length > 0 && <><h4>Provisional relationship suggestions</h4><p className="sigma-muted">Suggestions only. No graph write was performed.</p><pre>{JSON.stringify(reasoning.proposedRelationships, null, 2)}</pre></>}</section>}
    {savedResults.length > 0 && <section className="sigma-saved-results"><strong>Saved results</strong><span className="sigma-muted">local SQLite · {savedResults.length}</span><div>{savedResults.slice(0, 8).map((result) => <button className={activeSavedId === result.id ? "active" : ""} key={result.id} onClick={() => openSavedResult(result)}><strong>#{result.id} · {result.query}</strong><span>{result.scope} · {result.mode} · {new Date(result.createdAt).toLocaleString()}</span><small>{result.questionMeta?.title || result.question}</small></button>)}</div></section>}
    <div className="sigma-body"><div ref={containerRef} className="sigma-canvas" /><aside className="sigma-inspector"><h3>{selectedSource ? "Document / Source" : "Selected graph object"}</h3>{selected ? selectedSource ? <><div className="sigma-node-title">{selectedSource.title}</div><div className="sigma-source-path">{selectedSource.path}</div><div className="sigma-labels"><span>Document</span><span>{selectedSource.sourceType}</span></div><dl className="sigma-provenance"><dt>Location</dt><dd>{selectedSource.path}</dd><dt>Created</dt><dd>{displayDate(selectedSource.created)}</dd><dt>Modified</dt><dd>{displayDate(selectedSource.modified)}</dd><dt>Ingested</dt><dd>{displayDate(selectedSource.ingested)}</dd></dl><h4>Contents</h4>{selectedSource.content ? <pre className="sigma-content">{selectedSource.content}</pre> : <p className="sigma-muted">No readable chunk text is available.</p>}<h4>Extracted from this document</h4><div className="sigma-semantic-list">{semanticNodes(selectedSource, nodesById).map((node) => <button key={node.id} onClick={() => focus(node)}>{labelOf(node)} · {titleOf(node)}</button>)}</div><div className="sigma-inspector-actions"><button onClick={expand}>Expand evidence</button><button onClick={() => setRawOpen((open) => !open)}>{rawOpen ? "Hide raw evidence" : "Show raw evidence"}</button></div>{rawOpen && <pre>{JSON.stringify(rawSourceProperties(selectedSource), null, 2)}</pre>}</> : <><div className="sigma-node-title">{titleOf(selected)}</div><div className="sigma-muted">{labelOf(selected)} · named graph concept</div><div className="sigma-labels">{selected.labels.map((label) => <span key={label}>{label}</span>)}</div><p className="sigma-muted">This semantic object is connected to source evidence when available.</p><button onClick={expand}>Expand neighbors</button>{rawOpen && <pre>{JSON.stringify(selected.properties, null, 2)}</pre>}<button onClick={() => setRawOpen((open) => !open)}>{rawOpen ? "Hide raw properties" : "Show raw properties"}</button></> : <p className="sigma-muted">Select a document/source to see provenance, readable contents, extracted objects, and evidence relationships.</p>}</aside></div>
  </div>;
}
