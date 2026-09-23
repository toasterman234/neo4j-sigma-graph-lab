"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { LabNav } from "@/components/LabNav";

type NodePayload = { id: string; labels: string[]; properties: Record<string, unknown> };
type EdgePayload = { id: string; source: string; target: string; type: string };
type GraphPayload = { nodes: NodePayload[]; relationships: EdgePayload[]; counts?: { nodes: number; relationships: number } };

const DEFAULT_QUERY = "MATCH (n)-[r]-(m) RETURN n, r, m LIMIT $limit";
const palette = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f97316"];

function labelOf(node: NodePayload) { return node.labels[0] || "Node"; }
function titleOf(node: NodePayload) {
  const p = node.properties || {};
  return String(p.name ?? p.title ?? p.path ?? p.id ?? `${labelOf(node)} ${node.id}`);
}
function colorOf(node: NodePayload) { return palette[node.labels.join(":").length % palette.length]; }
function mergePayload(graph: Graph, payload: GraphPayload) {
  payload.nodes.forEach((node, index) => {
    if (!graph.hasNode(node.id)) graph.addNode(node.id, {
      label: titleOf(node), size: 8, color: colorOf(node), x: Math.cos(index * 0.7) * 10, y: Math.sin(index * 0.7) * 10,
      explorerLabels: node.labels, explorerProperties: node.properties,
    });
    else graph.mergeNodeAttributes(node.id, { explorerLabels: node.labels, explorerProperties: node.properties });
  });
  payload.relationships.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target) && !graph.hasEdge(edge.id)) {
      try { graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, { label: edge.type, size: 1.5, color: "#94a3b8", explorerType: edge.type }); } catch { /* duplicate edge key from bounded overlap */ }
    }
  });
}

export function SigmaNeo4jExplorer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph({ type: "directed", multi: true }));
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [selected, setSelected] = useState<NodePayload | null>(null);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<NodePayload[]>([]);
  const [hiddenLabels, setHiddenLabels] = useState<string[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading real Neo4j data…");
  const [busy, setBusy] = useState(false);

  const nodesById = useMemo(() => new Map((payload?.nodes || []).map((n) => [n.id, n])), [payload]);
  const allLabels = useMemo(() => Array.from(new Set((payload?.nodes || []).flatMap((n) => n.labels))).sort(), [payload]);
  const allTypes = useMemo(() => Array.from(new Set((payload?.relationships || []).map((r) => r.type))).sort(), [payload]);

  async function load(url: string, body?: GraphPayload) {
    setBusy(true);
    try {
      const response = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neo4j request failed");
      setPayload(data); setStatus(`${data.counts?.nodes ?? data.nodes.length} nodes · ${data.counts?.relationships ?? data.relationships.length} relationships · read-only`);
      return data as GraphPayload;
    } catch (error) { setStatus(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function runQuery() { await load(`/api/explorer/graph?limit=300&query=${encodeURIComponent(query)}`); }
  async function expand() { if (!selected) return; await load(`/api/explorer/expand?nodeId=${encodeURIComponent(selected.id)}&limit=160`); }

  useEffect(() => { void load("/api/explorer/graph?limit=300"); }, []);
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/explorer/search?q=${encodeURIComponent(search)}&limit=30`);
      const data = await response.json(); setSearchResults(data.results || []);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!containerRef.current || !payload) return;
    const graph = graphRef.current;
    graph.clear(); mergePayload(graph, payload);
    sigmaRef.current?.kill();
    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true,
      defaultEdgeType: "arrow",
      labelColor: { color: "#e2e8f0" },
      edgeLabelColor: { color: "#cbd5e1" },
      nodeReducer: (node, attrs) => {
        const labels = (attrs.explorerLabels || []) as string[];
        const hidden = labels.some((x) => hiddenLabels.includes(x));
        return { ...attrs, hidden, label: hidden ? "" : attrs.label };
      },
      edgeReducer: (edge, attrs) => ({ ...attrs, hidden: hiddenTypes.includes(String(attrs.explorerType)) }),
    });
    renderer.on("clickNode", ({ node }) => {
      const found = nodesById.get(String(node)); if (found) setSelected(found);
      renderer.getCamera().animate({ ...renderer.getNodeDisplayData(node), ratio: 0.35 }, { duration: 500 });
    });
    sigmaRef.current = renderer;
    return () => renderer.kill();
  }, [payload, hiddenLabels, hiddenTypes, nodesById]);

  function focus(node: NodePayload) {
    setSelected(node); setSearch("");
    const renderer = sigmaRef.current; if (renderer && graphRef.current.hasNode(node.id)) renderer.getCamera().animate({ ...renderer.getNodeDisplayData(node.id), ratio: 0.25 }, { duration: 500 });
  }
  function toggle(items: string[], value: string, setter: (value: string[]) => void) { setter(items.includes(value) ? items.filter((x) => x !== value) : [...items, value]); }

  return <div className="sigma-explorer">
    <LabNav active="explorer" />
    <div className="sigma-toolbar">
      <div><strong>Neo4j Sigma Explorer</strong><span className="sigma-muted"> read-only · bounded to 300–500 nodes</span></div>
      <button onClick={runQuery} disabled={busy}>{busy ? "Loading…" : "Run Cypher"}</button>
      <button onClick={expand} disabled={!selected || busy}>Expand selected</button>
    </div>
    <div className="sigma-controls">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search node properties…" />
      {searchResults.length > 0 && <div className="sigma-search-results">{searchResults.map((node) => <button key={node.id} onClick={() => focus(node)}>{labelOf(node)} · {titleOf(node)} <small>#{node.id}</small></button>)}</div>}
      <textarea value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Read-only Cypher query" />
      <div className="sigma-filter-row"><span>Hide labels:</span>{allLabels.slice(0, 12).map((label) => <button key={label} className={hiddenLabels.includes(label) ? "active" : ""} onClick={() => toggle(hiddenLabels, label, setHiddenLabels)}>{label}</button>)}</div>
      <div className="sigma-filter-row"><span>Hide relationships:</span>{allTypes.slice(0, 12).map((type) => <button key={type} className={hiddenTypes.includes(type) ? "active" : ""} onClick={() => toggle(hiddenTypes, type, setHiddenTypes)}>{type}</button>)}</div>
    </div>
    <div className="sigma-status">{status}</div>
    <div className="sigma-body"><div ref={containerRef} className="sigma-canvas" />
      <aside className="sigma-inspector"><h3>Selected node</h3>{selected ? <><div className="sigma-node-title">{titleOf(selected)}</div><div className="sigma-muted">Neo4j id: {selected.id}</div><div className="sigma-labels">{selected.labels.map((label) => <span key={label}>{label}</span>)}</div><pre>{JSON.stringify(selected.properties, null, 2)}</pre><button onClick={expand}>Expand neighbors</button></> : <p className="sigma-muted">Click a node to inspect labels and real properties.</p>}</aside>
    </div>
  </div>;
}
