export type HybridResult = {
  id: string;
  kind: string;
  retrieval?: "lexical" | "semantic";
  score?: number;
  [key: string]: unknown;
};

export function mergeHybridResults<T extends HybridResult>(
  semantic: readonly T[],
  lexical: readonly T[],
  limit: number,
): T[] {
  const bounded = Math.max(1, Math.floor(limit));
  const combined = [
    ...semantic.map((result) => ({ ...result, retrieval: "semantic" as const })),
    ...lexical.map((result) => ({ ...result, retrieval: result.retrieval || "lexical" as const })),
  ];
  return Array.from(
    new Map(combined.map((result) => [`${result.kind}:${result.id}`, result])).values(),
  ).slice(0, bounded) as T[];
}
