"use client";

import { useMemo, useState } from "react";
import { LabNav } from "@/components/LabNav";
import { ModelingProposalWorkspace } from "@/components/ModelingProposalWorkspace";

type ModelingWorkspaceProps = { onOpenExplorer: () => void };

const concepts = [
  { title: "Graph source", value: "Existing ZimaOS Neo4j", detail: "bolt://zimaos:17687 · database neo4j · read-only" },
  { title: "Visualization", value: "Sigma.js + Graphology", detail: "Browser rendering and in-memory graph model" },
  { title: "Adapter", value: "graphology-neo4j", detail: "cypherToGraph translates Neo4j nodes and relationships" },
  { title: "Safety boundary", value: "Server-side driver", detail: "Credentials stay in the server environment; the browser receives serialized results" },
];

const exampleQueries = [
  ["Bounded neighborhood", "MATCH (n)-[r]-(m) RETURN n, r, m LIMIT $limit"],
  ["Projects", "MATCH (n:Project) RETURN n LIMIT $limit"],
  ["Relationship inventory", "MATCH (a)-[r]->(b) RETURN a, r, b LIMIT $limit"],
  ["Vault chunks", "MATCH (n:Chunk) WHERE n.`metadata_x-amz-bedrock-kb-source-uri` CONTAINS '/ben-vault/' RETURN n LIMIT $limit"],
];

export function ModelingWorkspace({ onOpenExplorer }: ModelingWorkspaceProps) {
  const [activeSection, setActiveSection] = useState("overview");
  const [copied, setCopied] = useState("");
  const sections = useMemo(() => [
    ["overview", "Overview"], ["schema", "Live schema"], ["proposals", "Proposed schema"], ["queries", "Query patterns"], ["handoff", "Agent handoff"],
  ], []);
  async function copy(text: string) {
    await navigator.clipboard?.writeText(text);
    setCopied(text); setTimeout(() => setCopied(""), 1200);
  }

  return <div className="modeling-workspace">
    <LabNav active="modeling" />
    <header className="modeling-header">
      <div><div className="modeling-kicker">Neo4j Sigma Graph Lab</div><h1>Modeling</h1><p>Understand the connected graph before exploring it.</p></div>
      <button className="modeling-primary" onClick={onOpenExplorer}>Open explorer →</button>
    </header>
    <nav className="modeling-nav" aria-label="Modeling sections">{sections.map(([id, label]) => <button key={id} className={activeSection === id ? "selected" : ""} onClick={() => setActiveSection(id)}>{label}</button>)}</nav>
    <main className="modeling-content">
      {activeSection === "overview" && <>
        <section className="modeling-hero"><span className="modeling-status-dot" /><div><h2>A read-only lens on the existing graph</h2><p>This lab intentionally does not own the database. It queries the configured Neo4j instance, converts bounded results into Graphology, and renders them with Sigma.js.</p></div></section>
        <div className="modeling-card-grid">{concepts.map((concept) => <article className="modeling-card" key={concept.title}><div className="modeling-card-label">{concept.title}</div><strong>{concept.value}</strong><p>{concept.detail}</p></article>)}</div>
        <section className="modeling-panel"><h2>Request flow</h2><div className="flow-row"><span>Browser</span><b>→</b><span>Next.js API</span><b>→</b><span>neo4j-driver</span><b>→</b><span>Neo4j</span></div><p className="modeling-note">The server validates custom Cypher, forces read sessions, bounds requests, and serializes graph results. No browser code receives Neo4j credentials.</p></section>
      </>}
      {activeSection === "schema" && <>
        <section className="modeling-panel"><h2>Observed live schema</h2><p className="modeling-note">These are the labels and relationship families found during the live integration work. The graph is larger than the explorer viewport, so use bounded queries and expansion rather than loading everything.</p><div className="schema-columns"><div><h3>Common node labels</h3><div className="token-list">{["Chunk", "DocumentId", "Entity", "SemanticEntity", "Project", "Task", "Decision", "Process", "System", "Service", "Platform"].map((x) => <span key={x}>{x}</span>)}</div></div><div><h3>Relationship types</h3><div className="token-list relationship-tokens">{["CONTAINS", "EVIDENCED_BY", "FOLLOWED_BY", "FROM", "HAS_DECISION", "HAS_OPTION", "HOSTED_ON", "INTEGRATES", "IN_STATE", "RELATED_TO", "SUPPORTED_ON", "USES"].map((x) => <span key={x}>{x}</span>)}</div></div></div></section>
        <section className="modeling-panel"><h2>Source lineage</h2><p>Vault material is primarily represented by <code>Chunk</code> nodes. Inspect <code>metadata_x-amz-bedrock-kb-source-uri</code>, <code>metadata</code>, and <code>text</code> to trace a result back to its source document.</p></section>
      </>}
      {activeSection === "proposals" && <ModelingProposalWorkspace />}
      {activeSection === "queries" && <section className="modeling-panel"><h2>Safe query patterns</h2><p className="modeling-note">Custom queries must be read-only. Use <code>$limit</code> and return Neo4j nodes and relationships when you want a visual graph.</p>{exampleQueries.map(([name, text]) => <div className="query-example" key={name}><div><strong>{name}</strong><code>{text}</code></div><button onClick={() => copy(text)}>{copied === text ? "Copied" : "Copy"}</button></div>)}</section>}
      {activeSection === "handoff" && <section className="modeling-panel handoff-panel"><h2>Continuation contract</h2><ol><li>Read <code>AGENTS.md</code>, <code>ARCHITECTURE.md</code>, and <code>README.md</code> before changing code.</li><li>Keep Neo4j read-only. Do not run seed, reset, migration, delete, or write Cypher.</li><li>Keep credentials in the ignored <code>.env</code>; never expose them to client bundles.</li><li>Preserve the bounded graph contract: initial loads max at 500 nodes, expansion and search are separately capped.</li><li>Verify with the frontend build, backend tests, live health, and the explorer API checks.</li></ol><button className="modeling-primary" onClick={onOpenExplorer}>Continue in explorer →</button></section>}
    </main>
  </div>;
}
