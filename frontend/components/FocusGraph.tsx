"use client";

import { useEffect, useRef, useState } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import { colorFor, kindOf } from "@/lib/explore";

export type TrailItem = { id: string; title: string };

type PayloadNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};
type PayloadRel = { id: string; source: string; target: string; type: string };
type Neighbor = { node: PayloadNode; relType: string; outward: boolean };

function titleOf(props: Record<string, any>): string {
  return String(props.title || props.name || "untitled");
}
function textOf(props: Record<string, any>): string {
  return String(props.text || props.notes || props.content || "");
}
function sourceOf(props: Record<string, any>): string {
  const p = String(props._projection || "");
  if (p === "foundation") return "foundation";
  if (p === "muse-notes") return "muse notes";
  return p || "graph";
}
function kindLabel(kind: string): string {
  return kind === "MuseNote" ? "Muse note" : kind;
}
function nodeLabel(props: Record<string, any>, max = 26): string {
  const raw = titleOf(props) === "untitled" ? textOf(props) : titleOf(props);
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "untitled";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function deriveNeighbors(focusId: string, nodes: PayloadNode[], rels: PayloadRel[]): Neighbor[] {
  const seen = new Set<string>();
  const neighbors: Neighbor[] = [];
  for (const r of rels) {
    const otherId = r.source === focusId ? r.target : r.target === focusId ? r.source : null;
    if (!otherId || seen.has(otherId)) continue;
    const node = nodes.find((n) => n.id === otherId);
    if (!node) continue;
    seen.add(otherId);
    neighbors.push({ node, relType: r.type, outward: r.source === focusId });
  }
  return neighbors;
}

export function FocusGraph({
  focusId,
  trail,
  onSelect,
  onTrailSelect,
  onCenter,
}: {
  focusId: string;
  trail: TrailItem[];
  onSelect: (id: string) => void;
  onTrailSelect: (index: number) => void;
  onCenter: (id: string, title: string) => void;
}) {
  const [nodes, setNodes] = useState<PayloadNode[]>([]);
  const [rels, setRels] = useState<PayloadRel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [topCollapsed, setTopCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  const graphHeight = 300 + (bottomCollapsed ? 260 : 0) + (topCollapsed ? 140 : 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(false);
    fetch(`/api/explore/neighborhood?id=${encodeURIComponent(focusId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setNodes(data.nodes || []);
        setRels(data.relationships || []);
        const c = (data.nodes || []).find((n: PayloadNode) => n.id === focusId);
        if (c) onCenter(focusId, titleOf(c.properties));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const center = nodes.find((n) => n.id === focusId);
  const neighbors = deriveNeighbors(focusId, nodes, rels);
  const shown = neighbors.slice(0, 14);

  const centerKind = center ? kindOf(center.labels, center.properties.kind) : "Note";
  const centerText = center ? textOf(center.properties) : "";
  const showText = expanded || centerText.length <= 420;
  const legendKinds = center
    ? Array.from(new Set([centerKind, ...shown.map((nb) => kindOf(nb.node.labels, nb.node.properties.kind))]))
    : [];

  useEffect(() => {
    if (!containerRef.current || !center || shown.length === 0) return;
    const graph = new Graph({ type: "directed", multi: false });
    const haloId = `${focusId}::halo`;
    // Halo painted first so it sits underneath the center node: reads as a border.
    graph.addNode(haloId, {
      label: "",
      color: "#7c4a03",
      size: 30,
      x: 0,
      y: 0,
      halo: true,
    });
    graph.addNode(focusId, {
      label: "",
      color: colorFor(centerKind),
      size: 20,
      x: 0,
      y: 0,
    });
    const kindById = new Map<string, string>();
    kindById.set(focusId, kindLabel(centerKind));
    shown.forEach((nb, i) => {
      const a = (i / Math.max(1, shown.length)) * 2 * Math.PI - Math.PI / 2;
      const k = kindOf(nb.node.labels, nb.node.properties.kind);
      kindById.set(nb.node.id, kindLabel(k));
      graph.addNode(nb.node.id, {
        label: nodeLabel(nb.node.properties),
        color: colorFor(k),
        size: 11,
        x: Math.cos(a) * 3,
        y: Math.sin(a) * 3,
      });
      const attrs = { label: nb.relType, color: "#475569", size: 2.5 };
      if (nb.outward) graph.addEdge(focusId, nb.node.id, attrs);
      else graph.addEdge(nb.node.id, focusId, attrs);
    });
    const hovered: { node?: string; neighbors?: Set<string> } = {};
    function setHovered(node?: string) {
      hovered.node = node;
      hovered.neighbors = node ? new Set(graph.neighbors(node)) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      renderer.refresh({ skipIndexation: true });
    }
    const isHalo = (node: string) => Boolean(graph.getNodeAttribute(node, "halo"));
    sigmaRef.current?.kill();
    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true,
      defaultEdgeType: "arrow",
      labelColor: { color: "#e2e8f0" },
      edgeLabelColor: { color: "#7dd3fc" },
      labelSize: 12,
      edgeLabelSize: 11,
      minCameraRatio: 0.15,
      maxCameraRatio: 5,
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (isHalo(node)) return res;
        if (hovered.node) {
          if (node === hovered.node) {
            const kind = kindById.get(node);
            if (kind && res.label) res.label = `${res.label} · ${kind}`;
          } else if (!hovered.neighbors?.has(node)) {
            res.label = "";
            res.color = "#232c4a";
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        const [s, t] = graph.extremities(edge);
        const hot = hovered.node !== undefined && (s === hovered.node || t === hovered.node);
        if (hovered.node && !hot) {
          res.hidden = true;
        } else if (!hovered.node) {
          res.label = "";
        }
        return res;
      },
    });
    renderer.on("enterNode", ({ node }) => {
      if (!isHalo(node)) setHovered(node);
    });
    renderer.on("leaveNode", () => setHovered(undefined));
    renderer.on("clickNode", ({ node }) => {
      if (node === focusId || isHalo(node)) return;
      onSelectRef.current(String(node));
    });
    sigmaRef.current = renderer;
    const onResize = () => renderer.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      renderer.kill();
      if (sigmaRef.current === renderer) sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, nodes, rels]);

  // Re-fit the sigma canvas after collapse toggles resize its container.
  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [graphHeight]);

  return (
    <div>
      {trail.length > 0 && (
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, lineHeight: 1.7 }}>
          {trail.map((t, i) => (
            <span key={`${t.id}-${i}`}>
              <button
                onClick={() => onTrailSelect(i)}
                style={{ background: "none", border: "none", padding: 0, color: "#5eead4", fontSize: 12, cursor: "pointer" }}
              >
                {t.title.length > 26 ? t.title.slice(0, 26) + "…" : t.title}
              </button>
              <span style={{ margin: "0 6px" }}>›</span>
            </span>
          ))}
          <span style={{ color: "#94a3b8" }}>here</span>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: "#64748b", padding: "24px 0" }}>Loading…</div>}
      {error && (
        <div style={{ fontSize: 12, color: "#fca5a5", background: "#450a0a", borderRadius: 8, padding: "8px 10px" }}>
          {error}
        </div>
      )}

      {center && topCollapsed && (
        <button
          onClick={() => setTopCollapsed(false)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            borderRadius: 12,
            background: "#172033",
            border: "1px solid #2b3a5f",
            borderLeft: `4px solid ${colorFor(centerKind)}`,
            padding: "9px 12px",
            marginBottom: 10,
            cursor: "pointer",
            color: "#f1f5f9",
            fontSize: 13.5,
            fontWeight: 600,
            textAlign: "left",
          }}
        >
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: colorFor(centerKind), flex: "0 0 auto" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {titleOf(center.properties)}
          </span>
          <span style={{ marginLeft: "auto", color: "#5eead4", flex: "0 0 auto" }}>＋</span>
        </button>
      )}

      {center && !topCollapsed && (
        <div
          style={{
            borderRadius: 14,
            background: "#172033",
            border: "1px solid #2b3a5f",
            borderLeft: `4px solid ${colorFor(centerKind)}`,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#8b94ad", marginBottom: 6 }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: colorFor(centerKind) }} />
            {kindLabel(centerKind)}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {center.properties.date ? String(center.properties.date) : ""}
              <button
                onClick={() => setTopCollapsed(true)}
                aria-label="Collapse note card"
                style={{ background: "none", border: "none", color: "#5eead4", fontSize: 15, cursor: "pointer", padding: "0 2px" }}
              >
                －
              </button>
            </span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, lineHeight: 1.3, color: "#f1f5f9" }}>
            {titleOf(center.properties)}
          </div>
          {centerText && (
            <div style={{ fontSize: 13.5, color: "#c4ccdf", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {showText ? centerText : centerText.slice(0, 420) + "…"}
              {centerText.length > 420 && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  style={{ background: "none", border: "none", color: "#5eead4", fontSize: 13, cursor: "pointer", marginLeft: 6 }}
                >
                  {expanded ? "less" : "more"}
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
            Source: {sourceOf(center.properties)}
          </div>
        </div>
      )}

      {!loading && !error && neighbors.length > 0 && (
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: graphHeight,
            marginBottom: 4,
            background: "#0a0f1f",
            border: "1px solid #1c2440",
            borderRadius: 12,
            position: "relative",
            overflow: "hidden",
          }}
        />
      )}

      {!loading && !error && neighbors.length > 0 && legendKinds.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "2px 2px 4px", fontSize: 11.5, color: "#8b94ad" }}>
          {legendKinds.map((k) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: colorFor(k) }} />
              {kindLabel(k)}
            </span>
          ))}
        </div>
      )}

      {!loading && !error && neighbors.length === 0 && center && (
        <div style={{ fontSize: 12.5, color: "#64748b", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          No connections recorded for this note yet. Links appear as notes get linked or judged.
        </div>
      )}

      {!loading && neighbors.length > 0 && (
        <div>
          <button
            onClick={() => setBottomCollapsed((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              background: "none",
              border: "none",
              fontSize: 12,
              fontWeight: 650,
              color: "#94a3b8",
              margin: "6px 0 8px",
              letterSpacing: 0.4,
              cursor: "pointer",
              padding: 0,
            }}
          >
            CONNECTED · {neighbors.length}
            <span style={{ marginLeft: 6, color: "#5eead4" }}>{bottomCollapsed ? "＋" : "－"}</span>
          </button>
          {!bottomCollapsed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {neighbors.slice(0, 30).map((nb) => {
              const kind = kindOf(nb.node.labels, nb.node.properties.kind);
              return (
                <button
                  key={nb.node.id}
                  onClick={() => onSelect(nb.node.id)}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    textAlign: "left",
                    borderRadius: 12,
                    background: "#141b2e",
                    border: "1px solid #222b48",
                    padding: "11px 13px",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#0b0f1a",
                      background: "#5eead4",
                      borderRadius: 6,
                      padding: "3px 7px",
                    }}
                  >
                    {nb.outward ? `${nb.relType} ›` : `‹ ${nb.relType}`}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 550, lineHeight: 1.3, color: "#eef2f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {titleOf(nb.node.properties)}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "#8b94ad", marginTop: 2 }}>
                      {kindLabel(kind)}{nb.node.properties.date ? ` · ${String(nb.node.properties.date)}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
