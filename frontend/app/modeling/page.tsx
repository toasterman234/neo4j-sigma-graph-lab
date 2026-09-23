"use client";

import dynamic from "next/dynamic";
import { Flex, Spinner } from "@chakra-ui/react";

const ModelingWorkspace = dynamic(() => import("@/components/ModelingWorkspace").then((mod) => mod.ModelingWorkspace), {
  ssr: false,
  loading: () => <Flex align="center" justify="center" h="100vh"><Spinner /></Flex>,
});

export default function ModelingPage() {
  return <ModelingWorkspace onOpenExplorer={() => { window.location.href = "/sigma-explorer"; }} />;
}
