"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LabNav } from "@/components/LabNav";

const CommunityGraph = dynamic(
  () => import("@/components/CommunityGraph").then((mod) => mod.CommunityGraph),
  { ssr: false },
);

type CommunityListItem = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  members: number;
  excerpt: string;
  hasSummary: boolean;
};

type CommunityFinding = { summary: string; explanation: string };
type CommunityDetail = {
  id: string;
  level: number;
  title: string;
  rating: number | null;
  ratingExplanation: string;
  summary: string;
  findings: CommunityFinding[];
  parent: { id: string; title: string } | null;
  children: { id: string; title: string; level: number }[];
  members: { name: string; type: string; description: string }[];
  memberCount: number;
};

const PAGE_SIZE = 20;

const css = `
.comm-wrap { min-height: 100vh; background: #0f172a; color: #e2e8f0; }
.comm-main { display: grid; grid-template-columns: 400px 1fr; gap: 0; }
.comm-list-pane { border-right: 1px solid #1e293b; padding: 16px; max-height: calc(100vh - 41px); overflow-y: auto; }
.comm-detail-pane { padding: 20px; max-height: calc(100vh - 41px); overflow-y: auto; }
.comm-search { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid #334155; background: #020617; color: #e2e8f0; font-size: 14px; }
.comm-chips { display: flex; gap: 6px; margin: 10px 0; flex-wrap: wrap; }
.comm-chip { padding: 5px 11px; border-radius: 999px; border: 1px solid #334155; background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer; }
.comm-chip.on { background: #164e63; border-color: #164e63; color: #cffafe; }
.comm-card { width: 100%; text-align: left; padding: 12px; margin-bottom: 8px; border-radius: 10px; border: 1px solid #1e293b; background: #020617; cursor: pointer; }
.comm-card:hover { border-color: #334155; }
.comm-card.sel { border-color: #0ea5e9; }
.comm-title { font-size: 14px; font-weight: 600; color: #e2e8f0; line-height: 1.35; }
.comm-meta { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; font-size: 11px; }
.comm-badge { padding: 2px 8px; border-radius: 999px; background: #1e293b; color: #94a3b8; }
.comm-badge.lvl { background: #3b1d6e; color: #d8b4fe; }
.comm-badge.rate { background: #3f2d06; color: #fcd34d; }
.comm-excerpt { font-size: 12px; color: #64748b; margin-top: 7px; line-height: 1.5; }
.comm-pager { display: flex; gap: 8px; align-items: center; justify-content: center; margin: 12px 0 4px; font-size: 12px; color: #64748b; }
.comm-pager button { padding: 6px 14px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; }
.comm-pager button:disabled { opacity: 0.4; cursor: default; }
.comm-back { display: none; margin-bottom: 12px; padding: 7px 14px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #94a3b8; cursor: pointer; font-size: 13px; }
.comm-h1 { font-size: 20px; font-weight: 700; line-height: 1.3; }
.comm-summary { font-size: 14px; line-height: 1.65; color: #cbd5e1; margin-top: 12px; }
.comm-finding { padding: 10px 12px; border: 1px solid #1e293b; border-radius: 8px; margin-top: 8px; background: #020617; }
.comm-finding b { font-size: 13px; color: #e2e8f0; }
.comm-finding p { font-size: 12px; color: #94a3b8; margin: 5px 0 0; line-height: 1.55; }
.comm-sec { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 20px 0 8px; }
.comm-member { display: flex; gap: 8px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #1e293b; font-size: 13px; }
.comm-member .t { color: #7dd3fc; font-size: 11px; white-space: nowrap; }
.comm-member .d { color: #64748b; font-size: 12px; }
.comm-kid { display: inline-block; margin: 0 6px 6px 0; padding: 5px 10px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer; text-align: left; }
.comm-kid:hover { border-color: #0ea5e9; color: #e2e8f0; }
@media (max-width: 900px) {
  .comm-main { grid-template-columns: 1fr; }
  .comm-list-pane, .comm-detail-pane { max-height: none; border-right: none; }
  .comm-main.has-sel .comm-list-pane { display: none; }
  .comm-back { display: inline-block; }
}
`;

function ratingBadge(r: number | null) {
  if (r === null) return null;
  return <span className="comm-badge rate">★ {r.toFixed(1)}</span>;
}

export default function CommunitiesPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [level, setLevel] = useState<number | null>(null);
  const [summarizedOnly, setSummarizedOnly] = useState(true);
  const [items, setItems] = useState<CommunityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({
        q: debouncedQ,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (level !== null) params.set("level", String(level));
      if (summarizedOnly) params.set("summarized", "1");
      const res = await fetch(`/api/msgraphrag/communities?${params.toString()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setItems(data.communities || []);
      setTotal(data.total || 0);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Unable to load communities");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, level, offset, summarizedOnly]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQ, level, summarizedOnly]);

  const selectCommunity = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/msgraphrag/communities/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDetail(data);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Unable to load community");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="comm-wrap">
      <style>{css}</style>
      <LabNav active="communities" />
      <div className={`comm-main${selectedId ? " has-sel" : ""}`}>
        <div className="comm-list-pane">
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Communities</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
            MsGraphRAG full-corpus run · isolated Neo4j · {total.toLocaleString()} match
          </div>
          <input
            className="comm-search"
            placeholder="Search community titles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="comm-chips">
            <button className={`comm-chip${level === null ? " on" : ""}`} onClick={() => setLevel(null)}>
              All levels
            </button>
            {[0, 1, 2, 3].map((l) => (
              <button key={l} className={`comm-chip${level === l ? " on" : ""}`} onClick={() => setLevel(l)}>
                L{l}
              </button>
            ))}
            <button
              className={`comm-chip${summarizedOnly ? " on" : ""}`}
              onClick={() => setSummarizedOnly((v) => !v)}
              title="Only communities with an LLM summary"
            >
              Summarized
            </button>
          </div>
          {listError && <div style={{ color: "#fca5a5", fontSize: 13, padding: "8px 0" }}>{listError}</div>}
          {loading && <div style={{ color: "#64748b", fontSize: 13, padding: "8px 0" }}>Loading…</div>}
          {!loading &&
            items.map((c) => (
              <button
                key={c.id}
                className={`comm-card${selectedId === c.id ? " sel" : ""}`}
                onClick={() => selectCommunity(c.id)}
              >
                <div className="comm-title">{c.title}</div>
                <div className="comm-meta">
                  <span className="comm-badge lvl">L{c.level}</span>
                  {ratingBadge(c.rating)}
                  <span className="comm-badge">{c.members} entities</span>
                  {!c.hasSummary && <span className="comm-badge">no summary</span>}
                </div>
                {c.excerpt && <div className="comm-excerpt">{c.excerpt}…</div>}
              </button>
            ))}
          {!loading && items.length === 0 && !listError && (
            <div style={{ color: "#64748b", fontSize: 13, padding: "12px 0" }}>No communities match.</div>
          )}
          <div className="comm-pager">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              ← Prev
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next →
            </button>
          </div>
        </div>
        <div className="comm-detail-pane">
          {selectedId && (
            <button className="comm-back" onClick={() => setSelectedId(null)}>
              ← All communities
            </button>
          )}
          {!selectedId && (
            <div style={{ color: "#64748b", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
              Select a community to read its summary, findings, and entity graph.
            </div>
          )}
          {detailLoading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading community…</div>}
          {detailError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{detailError}</div>}
          {detail && (
            <div>
              <div className="comm-meta" style={{ marginTop: 0, marginBottom: 8 }}>
                <span className="comm-badge lvl">Level {detail.level}</span>
                {ratingBadge(detail.rating)}
                <span className="comm-badge">{detail.memberCount} entities</span>
              </div>
              <div className="comm-h1">{detail.title}</div>
              {detail.ratingExplanation && (
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>
                  {detail.ratingExplanation}
                </div>
              )}
              {detail.summary ? (
                <p className="comm-summary">{detail.summary}</p>
              ) : (
                <p className="comm-summary" style={{ color: "#64748b", fontStyle: "italic" }}>
                  No summary for this community.
                </p>
              )}
              {detail.findings.length > 0 && (
                <div>
                  <div className="comm-sec">Key findings</div>
                  {detail.findings.map((f, i) => (
                    <div key={i} className="comm-finding">
                      <b>
                        {i + 1}. {f.summary}
                      </b>
                      {f.explanation && <p>{f.explanation}</p>}
                    </div>
                  ))}
                </div>
              )}
              {(detail.parent || detail.children.length > 0) && (
                <div>
                  <div className="comm-sec">Hierarchy</div>
                  {detail.parent && (
                    <div style={{ marginBottom: 6 }}>
                      <button className="comm-kid" onClick={() => selectCommunity(detail.parent!.id)}>
                        ↑ {detail.parent.title}
                      </button>
                    </div>
                  )}
                  {detail.children.map((ch) => (
                    <button key={ch.id} className="comm-kid" onClick={() => selectCommunity(ch.id)}>
                      ↓ L{ch.level} · {ch.title}
                    </button>
                  ))}
                </div>
              )}
              <div className="comm-sec">Entity graph</div>
              <CommunityGraph communityId={detail.id} title={detail.title} />
              <div className="comm-sec">Member entities ({detail.memberCount})</div>
              {detail.members.map((m) => (
                <div key={m.name} className="comm-member">
                  <span className="t">{m.type}</span>
                  <div>
                    <div style={{ color: "#e2e8f0" }}>{m.name}</div>
                    {m.description && <div className="d">{m.description}</div>}
                  </div>
                </div>
              ))}
              {detail.members.length < detail.memberCount && (
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                  Showing {detail.members.length} of {detail.memberCount}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
