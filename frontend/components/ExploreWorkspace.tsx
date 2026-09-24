"use client";

import { useEffect, useRef, useState } from "react";
import { LabNav } from "@/components/LabNav";
import { FocusGraph } from "@/components/FocusGraph";
import type { TrailItem } from "@/components/FocusGraph";
import { ExplorePanel } from "@/components/ExplorePanel";
import type { PanelTab } from "@/components/ExplorePanel";

type MobileView = "graph" | PanelTab;

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * Explore = focus graph (one note at a time, neighbors around it) with a
 * side panel for browsing: Feed (searchable recents) and Kinds (grouped by
 * kind). On phones the panel becomes a full-width view behind a switcher.
 */
export function ExploreWorkspace() {
  const desktop = useDesktop();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [panelTab, setPanelTab] = useState<PanelTab>("feed");
  const [mobileView, setMobileView] = useState<MobileView>("graph");
  const [bootError, setBootError] = useState<string | null>(null);
  const titleRef = useRef("");

  useEffect(() => {
    (async () => {
      try {
        const k = await (await fetch("/api/explore/kinds")).json();
        if (k.error) throw new Error(k.error);
        if (k.suggestedFocus) {
          setFocusId(k.suggestedFocus);
          return;
        }
        const s = await (await fetch("/api/explore/search?limit=1")).json();
        if (s.error) throw new Error(s.error);
        if (s.nodes && s.nodes[0]) setFocusId(s.nodes[0].id);
        else setBootError("No notes in the projection yet.");
      } catch (e) {
        setBootError(e instanceof Error ? e.message : "Unable to load notes");
      }
    })();
  }, []);

  const select = (id: string) => {
    if (id === focusId) return;
    if (focusId) setTrail((t) => [...t, { id: focusId, title: titleRef.current || "Note" }]);
    setFocusId(id);
    setMobileView("graph");
  };

  const trailSelect = (index: number) => {
    const item = trail[index];
    if (!item) return;
    setTrail(trail.slice(0, index));
    setFocusId(item.id);
    setMobileView("graph");
  };

  const showGraph = desktop || mobileView === "graph";
  const showPanel = desktop || mobileView !== "graph";
  const panelHeight = "calc(100dvh - 118px)";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "#020617" }}>
      <LabNav active="explore" />

      {!desktop && (
        <div style={{ display: "flex", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 3, margin: "8px 12px 0" }}>
          {(["graph", "feed", "kinds"] as MobileView[]).map((v) => (
            <button
              key={v}
              onClick={() => setMobileView(v)}
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 650,
                padding: "8px 0",
                borderRadius: 7,
                border: "none",
                background: mobileView === v ? "#1d5c5c" : "transparent",
                color: mobileView === v ? "#fff" : "#8b94ad",
                cursor: "pointer",
              }}
            >
              {v === "graph" ? "Graph" : v === "feed" ? "Feed" : "Kinds"}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {showGraph && (
          <main
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 12px 40px",
              ...(desktop ? { overflowY: "auto", maxHeight: panelHeight } : {}),
            }}
          >
            {focusId ? (
              <FocusGraph
                focusId={focusId}
                trail={trail}
                onSelect={select}
                onTrailSelect={trailSelect}
                onCenter={(_id, title) => {
                  titleRef.current = title;
                }}
              />
            ) : bootError ? (
              <div style={{ fontSize: 12, color: "#fca5a5", background: "#450a0a", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
                {bootError}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b", padding: "24px 0" }}>Loading your notes…</div>
            )}
          </main>
        )}

        {showPanel && (
          <aside
            style={
              desktop
                ? {
                    width: 370,
                    flex: "0 0 auto",
                    borderLeft: "1px solid #1e293b",
                    overflowY: "auto",
                    maxHeight: panelHeight,
                    background: "#020617",
                  }
                : { flex: 1, minWidth: 0 }
            }
          >
            <ExplorePanel
              tab={desktop ? panelTab : (mobileView as PanelTab)}
              onTabChange={(t) => {
                setPanelTab(t);
                setMobileView(t);
              }}
              onSelect={select}
              selectedId={focusId}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
