"use client";

export function LabNav({ active }: { active: "explorer" | "modeling" | "explore" }) {
  return <nav className="lab-nav" aria-label="Graph Lab tabs">
    <a className={active === "explorer" ? "active" : ""} href="/sigma-explorer">Explorer</a>
    <a className={active === "explore" ? "active" : ""} href="/explore">Explore</a>
    <a className={active === "modeling" ? "active" : ""} href="/modeling">Modeling</a>
  </nav>;
}
