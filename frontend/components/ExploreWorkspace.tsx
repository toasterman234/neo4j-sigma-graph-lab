"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { LabNav } from "@/components/LabNav";
import {
  NOTE_KINDS,
  TELEMETRY_KIND,
  SUPERSESSION_QUERY,
  projectionQuery,
  detectIntent,
  kindsFromQuestion,
  kindOf,
  colorFor,
} from "@/lib/explore";

type PayloadNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};
type PayloadRel = { id: string; source: string; target: string; type: string };
type GraphPayload = {
  nodes: PayloadNode[];
  relationships: PayloadRel[];
  counts?: { nodes: number; relationships: number };
};

type EvidenceItem = {
  id: string;
  title: string;
  kind: string;
  excerpt: string;
  source: string;
  date?: string;
};

type SelectedNode = {
  id: string;
  title: string;
  kind: string;
  text: string;
  source: string;
  date?: string;
};

const DEFAULT_KINDS: string[] = [...NOTE_KINDS];

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

/** Deterministic layout: one cluster per kind, arranged in a ring. */
function layoutByKind(g: Graph): void {
  const groups = new Map<string, string[]>();
  g.forEachNode((node, attrs) => {
    const kind = String(attrs.kind || "Note");
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind)!.push(node);
  });
  const keys = [...groups.keys()];
  keys.forEach((kind, gi) => {
    const angle = (gi / Math.max(1, keys.length)) * 2 * Math.PI;
    const cx = Math.cos(angle) * 12;
    const cy = Math.sin(angle) * 12;
    const members = groups.get(kind)!;
    const radius = 1.6 + Math.sqrt(members.length) * 0.5;
    members.forEach((node, i) => {
      const a = (i / Math.max(1, members.length)) * 2 * Math.PI;
      g.setNodeAttribute(node, "x", cx + Math.cos(a) * radius);
      g.setNodeAttribute(node, "y", cy + Math.sin(a) * radius);
    });
  });
}

function buildGraph(payload: GraphPayload): Graph {
  const g = new Graph({ multi: false });
  for (const n of payload.nodes) {
    const kind = kindOf(n.labels || [], n.properties.kind);
    const title = titleOf(n.properties);
    g.addNode(n.id, {
      label: title.length > 44 ? title.slice(0, 44) + "…" : title,
      kind,
      color: colorFor(kind),
      size: 4 + Math.min(6, textOf(n.properties).length / 900),
      fullTitle: title,
      text: textOf(n.properties),
      source: sourceOf(n.properties),
      date: n.properties.date ? String(n.properties.date) : undefined,
      x: 0,
      y: 0,
    });
  }
  for (const r of payload.relationships) {
    if (g.hasNode(r.source) && g.hasNode(r.target)) {
      if (!g.hasEdge(r.source, r.target)) {
        g.addEdge(r.source, r.target, {
          label: r.type,
          color: "#475569",
          size: 1,
        });
      }
    }
  }
  layoutByKind(g);
  return g;
}

async function fetchGraph(query: string, limit = 300): Promise<GraphPayload> {
  const res = await fetch(
    `/api/explorer/graph?limit=${limit}&query=${encodeURIComponent(query)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as GraphPayload;
}

function evidenceFromNode(n: PayloadNode): EvidenceItem {
  const kind = kindOf(n.labels || [], n.properties.kind);
  const text = textOf(n.properties);
  return {
    id: n.id,
    title: titleOf(n.properties),
    kind,
    excerpt: text.length > 180 ? text.slice(0, 180) + "…" : text,
    source: sourceOf(n.properties),
    date: n.properties.date ? String(n.properties.date) : undefined,
  };
}

export function ExploreWorkspace() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const [kinds, setKinds] = useState<string[]>(DEFAULT_KINDS);
  const [telemetryOn, setTelemetryOn] = useState(false);
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [selected, setSelected] = useState<SelectedNode | null>(null);

  const effectiveKinds = telemetryOn ? [...kinds, TELEMETRY_KIND] : kinds;

  const loadProjection = useCallback(async (ks: string[]) => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await fetchGraph(projectionQuery(ks)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load projection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjection(effectiveKinds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds.join(","), telemetryOn]);

  useEffect(() => {
    if (!containerRef.current || !payload) return;
    const g = buildGraph(payload);
    const renderer = new Sigma(g, containerRef.current, {
      renderEdgeLabels: false,
      labelSize: 12,
      labelColor: { color: "#cbd5e1" },
    });
    renderer.on("clickNode", (e: any) => {
      const attrs = g.getNodeAttributes(e.node);
      setSelected({
        id: e.node,
        title: String(attrs.fullTitle || attrs.label || "untitled"),
        kind: String(attrs.kind || "Note"),
        text: String(attrs.text || ""),
        source: String(attrs.source || "graph"),
        date: attrs.date ? String(attrs.date) : undefined,
      });
    });
    renderer.on("clickStage", () => setSelected(null));
    rendererRef.current = renderer;
    return () => {
      renderer.kill();
      rendererRef.current = null;
    };
  }, [payload]);

  const toggleKind = (kind: string) => {
    setKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
    );
  };

  const focusNode = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/explorer/expand?nodeId=${encodeURIComponent(id)}&limit=120`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPayload(data as GraphPayload);
      setEvidenceTitle("Neighborhood");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to expand node");
    } finally {
      setLoading(false);
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const intent = detectIntent(q);
      if (intent === "supersession") {
        const data = await fetchGraph(SUPERSESSION_QUERY);
        setPayload(data);
        const pairs: EvidenceItem[] = [];
        for (const r of data.relationships) {
          const older = data.nodes.find((n) => n.id === r.source);
          const newer = data.nodes.find((n) => n.id === r.target);
          if (older && newer) {
            pairs.push({
              id: `sup-${r.id}`,
              title: `${titleOf(older.properties)} → ${titleOf(newer.properties)}`,
              kind: "Supersession",
              excerpt: "Older note superseded by newer note.",
              source: sourceOf(older.properties),
            });
          }
        }
        setEvidence(
          pairs.length > 0
            ? pairs
            : [
                {
                  id: "sup-empty",
                  title: "No superseded notes yet",
                  kind: "Supersession",
                  excerpt:
                    "Nothing in the projection is marked as superseded. When a note replaces an older one, the chain will show up here.",
                  source: "projection",
                },
              ]
        );
        setEvidenceTitle("Supersession");
      } else {
        const kindJump = kindsFromQuestion(q);
        if (kindJump) {
          const next = kindJump.includes("Observation")
            ? kindJump.filter((k) => k !== "Observation")
            : kindJump;
          if (kindJump.includes("Observation")) setTelemetryOn(true);
          setKinds(next.length > 0 ? next : DEFAULT_KINDS);
          setEvidence([]);
          setEvidenceTitle("");
        } else {
          const res = await fetch(
            `/api/explore/search?q=${encodeURIComponent(q)}&limit=40`
          );
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          const items = ((data.nodes || []) as PayloadNode[]).map(evidenceFromNode);
          setEvidence(items);
          setEvidenceTitle(
            items.length > 0
              ? `${items.length} matching note${items.length === 1 ? "" : "s"}`
              : "No matching notes"
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  };

  const nodeCount = payload?.counts?.nodes ?? payload?.nodes.length ?? 0;

  return (
    <div className="sigma-explorer" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <LabNav active="explore" />
      <div style={{ padding: "10px 12px 0" }}>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Explore your notes</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          {loading ? "Loading…" : `${nodeCount} notes in view`} · projection of your vault, foundation &amp; Muse notes
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 12px" }}>
        {NOTE_KINDS.map((kind) => {
          const active = kinds.includes(kind);
          return (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              style={{
                flex: "0 0 auto",
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? colorFor(kind) : "#334155"}`,
                background: active ? "#0f172a" : "transparent",
                color: active ? "#e2e8f0" : "#94a3b8",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: colorFor(kind), marginRight: 6 }} />
              {kind === "MuseNote" ? "Muse notes" : `${kind}s`}
            </button>
          );
        })}
        <button
          onClick={() => setTelemetryOn((v) => !v)}
          style={{
            flex: "0 0 auto",
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 999,
            border: `1px solid ${telemetryOn ? colorFor(TELEMETRY_KIND) : "#334155"}`,
            background: "transparent",
            color: telemetryOn ? "#e2e8f0" : "#64748b",
            cursor: "pointer",
          }}
        >
          Telemetry
        </button>
      </div>

      {error && (
        <div style={{ margin: "0 12px 8px", fontSize: 12, color: "#fca5a5", background: "#450a0a", borderRadius: 8, padding: "8px 10px" }}>
          {error}
        </div>
      )}

      <div ref={containerRef} style={{ height: "52vh", minHeight: 320, margin: "0 12px", borderRadius: 12, background: "#020617", border: "1px solid #1e293b" }} />

      {selected && (
        <div style={{ margin: "10px 12px 0", borderRadius: 12, background: "#0f172a", border: "1px solid #1e293b", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: colorFor(selected.kind) }} />
            <span style={{ fontSize: 13, fontWeight: 650, flex: 1 }}>{selected.title}</span>
            <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
            {selected.kind} · {selected.source}{selected.date ? ` · ${selected.date}` : ""}
          </div>
          {selected.text && (
            <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 8, maxHeight: 140, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {selected.text.length > 900 ? selected.text.slice(0, 900) + "…" : selected.text}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={() => void focusNode(selected.id)}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #164e63", background: "#164e63", color: "#cffafe", cursor: "pointer" }}
            >
              Focus in graph
            </button>
            <a href="/sigma-explorer" style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #334155", color: "#94a3b8", textDecoration: "none" }}>
              Open in Explorer
            </a>
          </div>
        </div>
      )}

      {evidence.length > 0 && (
        <div style={{ margin: "10px 12px 0" }}>
          <div style={{ fontSize: 12, fontWeight: 650, color: "#94a3b8", marginBottom: 6 }}>{evidenceTitle}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {evidence.slice(0, 20).map((item) => (
              <div key={item.id} style={{ borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b", padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: colorFor(item.kind) }} />
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{item.title}</span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {item.kind} · {item.source}{item.date ? ` · ${item.date}` : ""}
                </div>
                {item.excerpt && (
                  <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6 }}>{item.excerpt}</div>
                )}
                {!item.id.startsWith("sup-") && (
                  <button
                    onClick={() => void focusNode(item.id)}
                    style={{ marginTop: 8, fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: "pointer" }}
                  >
                    Focus in graph
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ position: "sticky", bottom: 0, marginTop: 12, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "#020617", borderTop: "1px solid #1e293b" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
            placeholder='Ask — e.g. "what did I think about journaling?" or "show superseded notes"'
            style={{ flex: 1, fontSize: 13, padding: "10px 12px", borderRadius: 10, border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", outline: "none" }}
          />
          <button
            onClick={() => void ask()}
            disabled={asking}
            style={{ fontSize: 13, fontWeight: 650, padding: "10px 16px", borderRadius: 10, border: "none", background: asking ? "#334155" : "#0e7490", color: "#fff", cursor: asking ? "default" : "pointer" }}
          >
            {asking ? "…" : "Ask"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
          Searches your notes, jumps to note kinds, or traces supersession chains.
        </div>
      </div>
    </div>
  );
}
