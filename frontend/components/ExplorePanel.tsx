"use client";

import { useEffect, useState } from "react";
import { NOTE_KINDS, TELEMETRY_KIND, colorFor, kindOf } from "@/lib/explore";

export type PanelTab = "feed" | "kinds";

type PayloadNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};

function titleOf(props: Record<string, any>): string {
  return String(props.title || props.name || "untitled");
}
function textOf(props: Record<string, any>): string {
  return String(props.text || props.notes || props.content || "");
}
function kindLabel(kind: string): string {
  if (kind === "MuseNote") return "Muse note";
  if (kind === TELEMETRY_KIND) return "Telemetry";
  return kind;
}
function sectionLabel(kind: string): string {
  if (kind === "MuseNote") return "Muse notes";
  if (kind === TELEMETRY_KIND) return "Telemetry";
  return `${kind}s`;
}

function NoteRow({
  node,
  selected,
  onSelect,
}: {
  node: PayloadNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const kind = kindOf(node.labels, node.properties.kind);
  const text = textOf(node.properties);
  return (
    <button
      onClick={() => onSelect(node.id)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        borderRadius: 12,
        background: selected ? "#1a2742" : "#141b2e",
        border: `1px solid ${selected ? "#2dd4bf" : "#222b48"}`,
        padding: "11px 13px",
        cursor: "pointer",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#ffffff", marginBottom: 4 }}>
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: colorFor(kind) }} />
        {kindLabel(kind)}
        {node.properties.date && <span style={{ marginLeft: "auto" }}>{String(node.properties.date)}</span>}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 4, color: "#ffffff" }}>
        {titleOf(node.properties)}
      </div>
      {text && (
        <div
          style={{
            fontSize: 12.5,
            color: "#ffffff",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </div>
      )}
    </button>
  );
}

function Feed({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PayloadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);

  const run = async (query: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/explore/search?q=${encodeURIComponent(query)}&limit=40`);
      const data = await res.json();
      if (!data.error) setResults(data.nodes || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearched(true);
          void run(q);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 10 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your notes…"
          style={{
            flex: 1,
            fontSize: 13.5,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#e2e8f0",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{ fontSize: 13, fontWeight: 650, padding: "10px 14px", borderRadius: 10, border: "none", background: "#0e7490", color: "#fff", cursor: "pointer" }}
        >
          Go
        </button>
      </form>
      <div style={{ fontSize: 11.5, fontWeight: 650, color: "#ffffff", marginBottom: 8, letterSpacing: 0.4 }}>
        {loading ? "LOADING…" : searched && q ? `${results.length} MATCHING` : "RECENTLY CAPTURED"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((n) => (
          <NoteRow key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} />
        ))}
        {!loading && results.length === 0 && (
          <div style={{ fontSize: 13, color: "#ffffff" }}>No notes found.</div>
        )}
      </div>
    </div>
  );
}

function Kinds({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const [kinds, setKinds] = useState<{ kind: string; count: number }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, PayloadNode[]>>({});
  const [loadingKind, setLoadingKind] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/explore/kinds")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setKinds(data.kinds || []);
      })
      .catch(() => {});
  }, []);

  const toggle = async (kind: string) => {
    if (expanded === kind) {
      setExpanded(null);
      return;
    }
    setExpanded(kind);
    if (!items[kind]) {
      setLoadingKind(kind);
      try {
        const res = await fetch(`/api/explore/search?kind=${encodeURIComponent(kind)}&limit=60`);
        const data = await res.json();
        if (!data.error) setItems((prev) => ({ ...prev, [kind]: data.nodes || [] }));
      } finally {
        setLoadingKind(null);
      }
    }
  };

  const order = [...NOTE_KINDS, TELEMETRY_KIND];
  const sorted = [...kinds].sort((a, b) => {
    const ai = order.indexOf(a.kind);
    const bi = order.indexOf(b.kind);
    if (ai === -1 && bi === -1) return a.kind.localeCompare(b.kind);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.map(({ kind, count }) => {
        const open = expanded === kind;
        return (
          <div key={kind} style={{ borderRadius: 12, background: "#141b2e", border: "1px solid #222b48", overflow: "hidden" }}>
            <button
              onClick={() => void toggle(kind)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "12px 14px",
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: 14.5,
                fontWeight: 650,
              }}
            >
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: colorFor(kind) }} />
              {sectionLabel(kind)}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#ffffff", fontWeight: 500 }}>{count}</span>
              <span style={{ color: "#ffffff", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div style={{ borderTop: "1px solid #1d2540", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {loadingKind === kind && <div style={{ fontSize: 12.5, color: "#ffffff", padding: 4 }}>Loading…</div>}
                {(items[kind] || []).map((n) => (
                  <NoteRow key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ExplorePanel({
  tab,
  onTabChange,
  onSelect,
  selectedId,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <div style={{ padding: "10px 12px 40px" }}>
      <div style={{ display: "flex", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 3, marginBottom: 12 }}>
        {(["feed", "kinds"] as PanelTab[]).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: 650,
              padding: "8px 0",
              borderRadius: 7,
              border: "none",
              background: tab === t ? "#1d5c5c" : "transparent",
              color: tab === t ? "#fff" : "#ffffff",
              cursor: "pointer",
            }}
          >
            {t === "feed" ? "Feed" : "Kinds"}
          </button>
        ))}
      </div>
      {tab === "feed" ? (
        <Feed onSelect={onSelect} selectedId={selectedId} />
      ) : (
        <Kinds onSelect={onSelect} selectedId={selectedId} />
      )}
    </div>
  );
}
