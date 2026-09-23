"use client";

import dynamic from "next/dynamic";

const ExploreWorkspace = dynamic(
  () => import("@/components/ExploreWorkspace").then((mod) => mod.ExploreWorkspace),
  { ssr: false }
);

export default function ExplorePage() {
  return <ExploreWorkspace />;
}
