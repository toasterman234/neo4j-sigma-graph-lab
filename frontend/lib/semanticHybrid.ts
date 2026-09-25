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
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const result of [
    ...semantic.map((item) => ({ ...item, retrieval: "semantic" as const })),
    ...lexical.map((item) => ({ ...item, retrieval: item.retrieval || "lexical" as const })),
  ]) {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result as T);
    if (merged.length >= bounded) break;
  }

  return merged;
}
