"use client";

import { useEffect, useMemo, useState } from "react";

export type HierarchyNode = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  members: number;
  hasSummary: boolean;
  children: HierarchyNode[];
};

function prune(nodes: HierarchyNode[], q: string): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  for (const n of nodes) {
    const kids = prune(n.children, q);
    if (n.title.toLowerCase().includes(q) || kids.length > 0) out.push({ ...n, children: kids });
  }
  return out;
}

function countNodes(nodes: HierarchyNode[]): number {
  let n = 0;
  for (const x of nodes) n += 1 + countNodes(x.children);
  return n;
}

function collectIds(nodes: HierarchyNode[], into: Set<string>) {
  for (const n of nodes) {
    if (n.children.length > 0) into.add(n.id);
    collectIds(n.children, into);
  }
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedId,
  forceOpen,
}: {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  forceOpen: boolean;
}) {
  const hasKids = node.children.length > 0;
  const open = forceOpen || expanded.has(node.id);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 4px",
          borderRadius: 6,
          background: selectedId === node.id ? "#164e63" : "transparent",
        }}
      >
        {hasKids ? (
          <button
            onClick={() => onToggle(node.id)}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
              width: 20,
              flexShrink: 0,
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span style={{ width: 20, flexShrink: 0, color: "#334155", fontSize: 12 }}>·</span>
        )}
        <span
          style={{
            fontSize: 10,
            padding: "1px 7px",
            borderRadius: 999,
            background: "#3b1d6e",
            color: "#d8b4fe",
            flexShrink: 0,
          }}
        >
          L{node.level}
        </span>
        <button
          onClick={() => onSelect(node.id)}
          style={{
            background: "transparent",
            border: "none",
            color: "#e2e8f0",
            cursor: "pointer",
            fontSize: 13,
            textAlign: "left",
            padding: 0,
            lineHeight: 1.35,
          }}
        >
          {node.title}
        </button>
        {node.rating !== null && (
          <span style={{ fontSize: 11, color: "#fcd34d", flexShrink: 0 }}>★ {node.rating.toFixed(1)}</span>
        )}
        <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>{node.members}</span>
        {!node.hasSummary && <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>no summary</span>}
      </div>
      {hasKids && open && (
        <div style={{ marginLeft: 14, borderLeft: "1px solid #1e293b", paddingLeft: 6 }}>
          {node.children.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              forceOpen={forceOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommunityTree({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [roots, setRoots] = useState<HierarchyNode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/msgraphrag/hierarchy")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setRoots(d.roots || []);
        setTotal(d.total || 0);
        // Expand the first level so the forest shape is visible immediately.
        const ids = new Set<string>();
        for (const r of d.roots || []) if (r.children.length > 0) ids.add(r.id);
        setExpanded(ids);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load hierarchy");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const visible = useMemo(() => (q ? prune(roots, q) : roots), [roots, q]);
  const visibleCount = useMemo(() => countNodes(visible), [visible]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => {
    const ids = new Set<string>();
    collectIds(roots, ids);
    setExpanded(ids);
  };

  if (loading) return <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>Loading hierarchy…</div>;
  if (error) return <div style={{ padding: 16, color: "#fca5a5", fontSize: 13 }}>Hierarchy failed to load: {error}</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Filter communities…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: "1 1 200px",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#020617",
            color: "#e2e8f0",
            fontSize: 13,
          }}
        />
        <button
          onClick={expandAll}
          style={{
            padding: "7px 12px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Expand all
        </button>
        <button
          onClick={() => setExpanded(new Set())}
          style={{
            padding: "7px 12px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Collapse all
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
        {q ? (
          <>
            {visibleCount.toLocaleString()} match{q.length > 0 ? "ing" : ""} ·{" "}
          </>
        ) : null}
        {roots.length} root communities · {total.toLocaleString()} total · tap a title to open it
      </div>
      {visible.length === 0 && (
        <div style={{ color: "#64748b", fontSize: 13, padding: "12px 0" }}>No communities match.</div>
      )}
      {visible.map((r) => (
        <TreeRow
          key={r.id}
          node={r}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
          selectedId={selectedId}
          forceOpen={q.length > 0}
        />
      ))}
    </div>
  );
}
