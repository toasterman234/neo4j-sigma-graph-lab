"use client";

import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";

export const TYPE_COLORS: Record<string, string> = {
  Project: "#38bdf8",
  System: "#a78bfa",
  Repository: "#34d399",
  Agent: "#fbbf24",
  Service: "#f472b6",
  Decision: "#f87171",
  Artifact: "#94a3b8",
  Activity: "#4ade80",
  Observation: "#fb923c",
  Requirement: "#c084fc",
  Event: "#facc15",
  Technology: "#22d3ee",
  Process: "#a3e635",
  Person: "#e879f9",
  Organization: "#60a5fa",
};

type AggType = { type: string; count: number };
type AggEdge = { t1: string; t2: string; count: number };
type AggData = {
  types: AggType[];
  edges: AggEdge[];
  totalEntities: number;
  totalRelationships: number;
};

export function TypeGraph() {
  const [data, setData] = useState<AggData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/msgraphrag/type-aggregate")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load type aggregate");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !data) return;
    const live = data.types.filter((t) => t.count > 0);
    const maxCount = Math.max(1, ...live.map((t) => t.count));
    const maxEdge = Math.max(1, ...data.edges.map((e) => e.count));
    const graph = new Graph({ type: "undirected", multi: false });
    live.forEach((t, i) => {
      const a = (i / Math.max(1, live.length)) * 2 * Math.PI - Math.PI / 2;
      graph.addNode(t.type, {
        label: t.type,
        color: TYPE_COLORS[t.type] || "#64748b",
        size: 7 + 24 * Math.sqrt(t.count / maxCount),
        x: Math.cos(a) * 5,
        y: Math.sin(a) * 5,
      });
    });
    for (const e of data.edges) {
      if (!graph.hasNode(e.t1) || !graph.hasNode(e.t2)) continue;
      if (e.t1 === e.t2) continue;
      if (!graph.hasEdge(e.t1, e.t2)) {
        graph.addEdge(e.t1, e.t2, {
          color: "#3b4a6b",
          size: 0.8 + 5 * Math.sqrt(e.count / maxEdge),
        });
      }
    }
    const hovered: { node?: string; neighbors?: Set<string> } = {};
    function setHovered(node?: string) {
      hovered.node = node;
      hovered.neighbors = node ? new Set(graph.neighbors(node)) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      renderer.refresh({ skipIndexation: true });
    }
    sigmaRef.current?.kill();
    const renderer = new Sigma(graph, containerRef.current, {
      labelColor: { color: "#e2e8f0" },
      labelSize: 12,
      minCameraRatio: 0.3,
      maxCameraRatio: 4,
      nodeReducer: (node, attrs) => {
        const res = { ...attrs };
        if (hovered.node && node !== hovered.node && !hovered.neighbors?.has(node)) {
          res.label = "";
          res.color = "#232c4a";
        }
        return res;
      },
      edgeReducer: (edge, attrs) => {
        const res = { ...attrs };
        if (hovered.node) {
          const [s, t] = graph.extremities(edge);
          if (s !== hovered.node && t !== hovered.node) res.hidden = true;
        }
        return res;
      },
    });
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(undefined));
    renderer.on("clickNode", ({ node }) => setSelected(node));
    renderer.on("clickStage", () => setSelected(null));
    sigmaRef.current = renderer;
    const onResize = () => renderer.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.kill();
      if (sigmaRef.current === renderer) sigmaRef.current = null;
    };
  }, [data]);

  if (error) {
    return <div style={{ padding: 16, color: "#fca5a5", fontSize: 13 }}>Type graph failed to load: {error}</div>;
  }
  if (!data) {
    return <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>Loading type aggregate…</div>;
  }

  const selectedType = data.types.find((t) => t.type === selected);
  const selectedEdges = selected
    ? data.edges
        .filter((e) => e.t1 === selected || e.t2 === selected)
        .sort((a, b) => b.count - a.count)
    : [];
  const selfLoops = selected ? data.edges.find((e) => e.t1 === selected && e.t2 === selected) : undefined;
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    if (e.t1 === e.t2) continue;
    degree.set(e.t1, (degree.get(e.t1) ?? 0) + e.count);
    degree.set(e.t2, (degree.get(e.t2) ?? 0) + e.count);
  }
  const ranked = [...data.types].sort((a, b) => b.count - a.count);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height: 420, background: "#020617", borderRadius: 8 }} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
        {data.totalEntities.toLocaleString()} entities · {data.totalRelationships.toLocaleString()} relationships
        (RELATIONSHIP + SUMMARIZED_RELATIONSHIP) · node size = entity count · edge width = relationship count
      </div>
      {selectedType && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: TYPE_COLORS[selectedType.type] || "#64748b",
                display: "inline-block",
              }}
            />
            <b style={{ color: "#e2e8f0" }}>{selectedType.type}</b>
            <span style={{ color: "#94a3b8" }}>{selectedType.count.toLocaleString()} entities</span>
            {selfLoops && <span style={{ color: "#64748b" }}>· {selfLoops.count.toLocaleString()} self-links</span>}
          </div>
          {selectedEdges.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {selectedEdges.slice(0, 8).map((e) => {
                const other = e.t1 === selected ? e.t2 : e.t1;
                return (
                  <div key={other} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0" }}>
                    <span style={{ color: TYPE_COLORS[other] || "#94a3b8" }}>{other}</span>
                    <span style={{ color: "#64748b" }}>{e.count.toLocaleString()} relationships</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        {ranked.map((t) => (
          <div
            key={t.type}
            onClick={() => setSelected(t.type)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 4px",
              borderBottom: "1px solid #1e293b",
              fontSize: 13,
              cursor: "pointer",
              background: selected === t.type ? "#0f172a" : "transparent",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: TYPE_COLORS[t.type] || "#64748b",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#e2e8f0", width: 130 }}>{t.type}</span>
            <span style={{ color: "#94a3b8" }}>{t.count.toLocaleString()} entities</span>
            <span style={{ color: "#64748b", fontSize: 12 }}>
              {(degree.get(t.type) ?? 0).toLocaleString()} links
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
