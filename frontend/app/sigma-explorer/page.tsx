"use client";

import dynamic from "next/dynamic";
import { Box, Flex, Spinner } from "@chakra-ui/react";

const SigmaNeo4jExplorer = dynamic(() => import("@/components/SigmaNeo4jExplorer").then((mod) => mod.SigmaNeo4jExplorer), {
  ssr: false,
  loading: () => <Flex align="center" justify="center" h="100vh"><Spinner /></Flex>,
});

export default function SigmaExplorerPage() {
  return <Box minH="100vh" bg="#0f172a"><SigmaNeo4jExplorer /></Box>;
}
