"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";

type ProposalStatus = "pending" | "accepted" | "rejected" | "deferred";
type Proposal = { id: string; createdAt: string; query: string; kind: "node_type" | "relationship_pattern" | "relationship"; title: string; sourceId?: string; sourceLabel?: string; targetId?: string; targetLabel?: string; relationshipType?: string; rationale: string; confidence: number; evidence: Array<{ id: string; title: string; excerpt: string; kind: string }>; status: ProposalStatus; decisionNote?: string };

function schemaNodeId(label: string) { return `type:${label}`; }
function statusColor(status: ProposalStatus) { return status === "accepted" ? "#34d399" : status === "deferred" ? "#94a3b8" : status === "rejected" ? "#64748b" : "#fbbf24"; }
function proposalNodeLabel(proposal: Proposal) { return proposal.sourceLabel || proposal.title.replace(/^Model (?:node|concept) type:\s*/i, "") || "Concept"; }

function ProposedSchemaGraph({ proposals, onSelectProposal }: { proposals: Proposal[]; onSelectProposal: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graph = useMemo(() => {
    const instance = new Graph({ type: "directed", multi: true });
    const visible = proposals.filter((proposal) => proposal.status !== "rejected");
    const addNode = (id: string, label: string, status: ProposalStatus, proposalId: string) => { if (!instance.hasNode(id)) { const index = instance.order; instance.addNode(id, { label, size: 12, color: statusColor(status), x: Math.cos(index * 1.7) * 10, y: Math.sin(index * 1.7) * 10, proposalIds: [proposalId] }); } else { const ids = (instance.getNodeAttribute(id, "proposalIds") as string[] | undefined) || []; instance.setNodeAttribute(id, "proposalIds", Array.from(new Set([...ids, proposalId]))); } };
    visible.forEach((proposal) => {
      if (proposal.kind === "node_type") addNode(schemaNodeId(proposalNodeLabel(proposal)), proposalNodeLabel(proposal), proposal.status, proposal.id);
      else {
        const source = schemaNodeId(proposal.sourceLabel || "Source"); const target = schemaNodeId(proposal.targetLabel || "Target");
        addNode(source, proposal.sourceLabel || "Source", proposal.status, proposal.id); addNode(target, proposal.targetLabel || "Target", proposal.status, proposal.id);
        if (!instance.hasEdge(proposal.id)) instance.addDirectedEdgeWithKey(proposal.id, source, target, { label: proposal.relationshipType || "related to", color: statusColor(proposal.status), size: proposal.status === "accepted" ? 2.5 : 1.5, explorerType: proposal.status, proposalId: proposal.id });
      }
    });
    return instance;
  }, [proposals]);

  useEffect(() => {
    if (!containerRef.current) return;
    sigmaRef.current?.kill();
    const renderer = new Sigma(graph, containerRef.current, { renderEdgeLabels: true, defaultEdgeType: "arrow", labelColor: { color: "#e2e8f0" }, edgeLabelColor: { color: "#cbd5e1" } });
    renderer.on("clickNode", ({ node }) => {
      const ids = (graph.getNodeAttribute(node, "proposalIds") as string[] | undefined) || [];
      if (ids[0]) onSelectProposal(ids[0]);
    });
    renderer.on("clickEdge", ({ edge }) => {
      const proposalId = graph.getEdgeAttribute(edge, "proposalId");
      if (proposalId) onSelectProposal(String(proposalId));
    });
    sigmaRef.current = renderer;
    return () => renderer.kill();
  }, [graph, onSelectProposal]);
  return <div ref={containerRef} className="proposal-canvas" aria-label="Proposed schema graph" />;
}

export function ModelingProposalWorkspace() {
  const [query, setQuery] = useState("graph extraction");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("No proposal draft loaded.");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "queue">("graph");

  async function loadProposals() {
    const response = await fetch("/api/modeling/proposals");
    const data = await response.json();
    if (response.ok) setProposals(data.proposals || []);
  }
  useEffect(() => { void loadProposals(); }, []);
  async function draft() {
    if (!query.trim()) return;
    setBusy(true); setStatus("Looking up bounded graph context and drafting review proposals…");
    try {
      const response = await fetch("/api/modeling/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, scope: "whole", mode: "keyword" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Proposal draft failed");
      setProposals((current) => [...data.proposals, ...current.filter((existing) => !data.proposals.some((proposal: Proposal) => proposal.id === existing.id))]);
      setStatus(`${data.proposals.length} review proposals drafted from ${data.boundedContext.nodes} nodes and ${data.boundedContext.relationships} relationships.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Proposal draft failed"); }
    finally { setBusy(false); }
  }
  async function decide(id: string, decision: Exclude<ProposalStatus, "pending" | "rejected"> | "rejected") {
    const response = await fetch("/api/modeling/proposals", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: decision }) });
    const data = await response.json();
    if (!response.ok) { setStatus(data.error || "Decision failed"); return; }
    setProposals((current) => current.map((proposal) => proposal.id === id ? data.proposal : proposal));
    setActiveId(id); setStatus(`Proposal ${id} marked ${decision}. The Neo4j graph was not changed.`);
  }
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const active = proposals.find((proposal) => proposal.id === activeId) || pending[0] || proposals[0];
  function selectProposal(id: string) { setActiveId(id); setStatus(`Selected proposal ${id}. Review the evidence and choose a decision.`); }
  return <section className="modeling-panel modeling-proposals"><div className="proposal-header"><div><div className="modeling-card-label">Review workspace</div><h2>Proposed Schema graph</h2><p className="modeling-note">Look up bounded graph evidence, review candidate schema objects, and accept or reject local proposals. Accepted items remain local and never write Neo4j.</p></div><span className="proposal-safety-badge">READ-ONLY SOURCE · LOCAL MODEL</span></div><div className="proposal-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Graph lookup for schema proposals" placeholder="Look up a concept, project, or relationship…" /><button className="modeling-primary" onClick={draft} disabled={busy}>{busy ? "Drafting…" : "Look up and draft"}</button><div className="proposal-view-toggle"><button className={view === "graph" ? "selected" : ""} onClick={() => setView("graph")}>Schema graph</button><button className={view === "queue" ? "selected" : ""} onClick={() => setView("queue")}>Proposal queue ({pending.length})</button></div></div><div className="proposal-status">{status}</div>{view === "graph" ? <div className="proposal-layout"><div><ProposedSchemaGraph proposals={proposals} onSelectProposal={selectProposal} /><div className="proposal-legend"><span><i className="pending" /> Pending</span><span><i className="accepted" /> Accepted</span><span><i className="deferred" /> Deferred</span></div></div>{active && <ProposalCard proposal={active} onSelect={setActiveId} onDecide={decide} />}</div> : <div className="proposal-queue">{proposals.length === 0 ? <p className="modeling-note">No proposals yet. Run a bounded lookup to draft candidates.</p> : proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onSelect={setActiveId} onDecide={decide} />)}</div>}</section>;
}

function ProposalCard({ proposal, onSelect, onDecide }: { proposal: Proposal; onSelect: (id: string) => void; onDecide: (id: string, decision: "accepted" | "rejected" | "deferred") => void }) {
  return <article className={`proposal-card ${proposal.status}`} onClick={() => onSelect(proposal.id)}><div className="proposal-card-heading"><strong>{proposal.title}</strong><span className={`proposal-status ${proposal.status}`}>{proposal.status}</span></div><div className="proposal-meta"><span>{proposal.kind.replaceAll("_", " ")}</span><span>confidence {proposal.confidence.toFixed(2)}</span></div><p>{proposal.rationale}</p>{proposal.evidence.length > 0 && <details><summary>{proposal.evidence.length} evidence items</summary><ul>{proposal.evidence.slice(0, 4).map((item) => <li key={item.id}>{item.title}: {item.excerpt}</li>)}</ul></details>}{proposal.status === "pending" && <div className="proposal-actions"><button onClick={(event) => { event.stopPropagation(); onDecide(proposal.id, "accepted"); }}>Yes · add to model</button><button onClick={(event) => { event.stopPropagation(); onDecide(proposal.id, "rejected"); }}>No · reject</button><button onClick={(event) => { event.stopPropagation(); onDecide(proposal.id, "deferred"); }}>Defer</button></div>}{proposal.status !== "pending" && <small>Decision recorded locally. Neo4j unchanged.</small>}</article>;
}
