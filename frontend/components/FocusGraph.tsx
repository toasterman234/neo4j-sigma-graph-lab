"use client";

import { useEffect, useState } from "react";
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
function shortKind(kind: string): string {
  const map: Record<string, string> = {
    Thought: "THOUGHT",
    Idea: "IDEA",
    Preference: "PREF",
    Goal: "GOAL",
    Document: "DOC",
    MuseNote: "NOTE",
    Observation: "OBS",
  };
  return map[kind] || kind.slice(0, 5).toUpperCase();
}

const W = 360;
const H = 236;
const CX = 180;
const CY = 108;

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
  const shown = neighbors.slice(0, 14);
  const positions = shown.map((_, i) => {
    const a = (i / Math.max(1, shown.length)) * 2 * Math.PI - Math.PI / 2;
    return { x: CX + Math.cos(a) * 148, y: CY + Math.sin(a) * 92 };
  });

  const centerKind = center ? kindOf(center.labels, center.properties.kind) : "Note";
  const centerText = center ? textOf(center.properties) : "";
  const showText = expanded || centerText.length <= 420;

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

      {center && (
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
            <span style={{ marginLeft: "auto" }}>
              {center.properties.date ? String(center.properties.date) : ""}
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
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", marginBottom: 4 }}>
          {shown.map((nb, i) => {
            const p = positions[i];
            return (
              <line
                key={nb.node.id}
                x1={CX}
                y1={CY}
                x2={p.x}
                y2={p.y}
                stroke="#2a3552"
                strokeWidth={1.2}
              />
            );
          })}
          <circle cx={CX} cy={CY} r={26} fill={colorFor(centerKind)} />
          <text x={CX} y={CY + 3.5} textAnchor="middle" fontSize={10} fill="#0b0f1a" fontWeight={700}>
            {shortKind(centerKind)}
          </text>
          {shown.map((nb, i) => {
            const p = positions[i];
            const kind = kindOf(nb.node.labels, nb.node.properties.kind);
            return (
              <g key={nb.node.id} onClick={() => onSelect(nb.node.id)} style={{ cursor: "pointer" }}>
                <circle cx={p.x} cy={p.y} r={17} fill={colorFor(kind)} />
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={8.5} fill="#0b0f1a" fontWeight={700}>
                  {shortKind(kind)}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {!loading && !error && neighbors.length === 0 && center && (
        <div style={{ fontSize: 12.5, color: "#64748b", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          No connections recorded for this note yet. Links appear as notes get linked or judged.
        </div>
      )}

      {!loading && neighbors.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 650, color: "#94a3b8", margin: "6px 0 8px", letterSpacing: 0.4 }}>
            CONNECTED · {neighbors.length}
          </div>
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
        </div>
      )}
    </div>
  );
}
