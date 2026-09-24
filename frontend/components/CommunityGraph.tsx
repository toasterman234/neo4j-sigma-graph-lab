"use client";

import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import { colorFor, kindOf } from "@/lib/explore";

type PayloadNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};
type PayloadRel = { id: string; source: string; target: string; type: string };

function nodeLabel(props: Record<string, any>, max = 24): string {
  const raw = String(props.title || props.name || "untitled").trim().replace(/\s+/g, " ");
  if (!raw || raw === "untitled") return "";
  return raw.length > max ? raw.slice(0, max - 1) + "…" : raw;
}

export function CommunityGraph({ communityId, title }: { communityId: string; title: string }) {
  const [payload, setPayload] = useState<{
    nodes: PayloadNode[];
    relationships: PayloadRel[];
    counts?: { nodes: number; relationships: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PayloadNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const centerId = `community:${communityId}`;

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    setSelected(null);
    fetch(`/api/msgraphrag/communities/${encodeURIComponent(communityId)}/graph`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setPayload({ nodes: data.nodes || [], relationships: data.relationships || [] });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load graph");
      });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  useEffect(() => {
    if (!containerRef.current || !payload || payload.nodes.length === 0) return;
    const center = payload.nodes.find((n) => n.id === centerId);
    const members = payload.nodes.filter((n) => n.id !== centerId);
    const graph = new Graph({ type: "undirected", multi: false });
    if (center) {
      graph.addNode(center.id, {
        label: nodeLabel(center.properties, 30) || "Community",
        color: "#f59e0b",
        size: 22,
        x: 0,
        y: 0,
      });
    }
    members.forEach((n, i) => {
      const a = (i / Math.max(1, members.length)) * 2 * Math.PI - Math.PI / 2;
      const kind = kindOf(n.labels, n.properties.kind);
      graph.addNode(n.id, {
        label: nodeLabel(n.properties),
        color: colorFor(kind),
        size: 9,
        x: Math.cos(a) * 4,
        y: Math.sin(a) * 4,
      });
    });
    for (const r of payload.relationships) {
      if (!graph.hasNode(r.source) || !graph.hasNode(r.target)) continue;
      if (r.type === "IN_COMMUNITY") continue;
      if (!graph.hasEdge(r.source, r.target)) {
        graph.addEdge(r.source, r.target, { color: "#475569", size: 1.6 });
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
      labelSize: 11,
      minCameraRatio: 0.15,
      maxCameraRatio: 5,
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (hovered.node && node !== hovered.node && !hovered.neighbors?.has(node)) {
          res.label = "";
          res.color = "#232c4a";
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        if (hovered.node) {
          const [s, t] = graph.extremities(edge);
          if (s !== hovered.node && t !== hovered.node) res.hidden = true;
        }
        return res;
      },
    });
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(undefined));
    renderer.on("clickNode", ({ node }) => {
      const found = payload.nodes.find((n) => n.id === node) ?? null;
      setSelected(found && found.id !== centerId ? found : null);
    });
    renderer.on("clickStage", () => setSelected(null));
    sigmaRef.current = renderer;
    const onResize = () => renderer.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.kill();
      if (sigmaRef.current === renderer) sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, centerId]);

  if (error) {
    return <div style={{ padding: 16, color: "#fca5a5", fontSize: 13 }}>Graph failed to load: {error}</div>;
  }
  if (!payload) {
    return <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>Loading community graph…</div>;
  }
  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height: 380, background: "#020617", borderRadius: 8 }} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
        {payload.counts?.nodes ?? payload.nodes.length} nodes ·{" "}
        {payload.counts?.relationships ?? payload.relationships.length} relationships · {title}
      </div>
      {selected && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>
            {String(selected.properties.title || selected.properties.name)}
          </div>
          <div style={{ color: "#7dd3fc", fontSize: 12, marginTop: 2 }}>
            {String(selected.properties.kind || selected.labels.find((l) => l !== "__Entity__") || "Entity")}
          </div>
          {selected.properties.description && (
            <div style={{ color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
              {String(selected.properties.description)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
