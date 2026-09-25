export type ExtractedEntityKind = "person" | "organization" | "software" | "place" | "project" | "other";

export type ExtractedEntity = {
  id: string;
  name: string;
  kind: ExtractedEntityKind;
  labels: string[];
  relationshipTypes: string[];
};

const PERSON_LABELS = new Set(["person", "contact", "people"]);
const ORG_LABELS = new Set(["organization", "organisation", "company", "org", "institution", "team"]);
const SOFTWARE_LABELS = new Set(["software", "service", "system", "platform", "tool", "library", "framework", "application", "app", "repository", "repo", "technology"]);
const PLACE_LABELS = new Set(["location", "place", "city", "state", "country", "region"]);
const PROJECT_LABELS = new Set(["project"]);

function normalizedTokens(labels: readonly string[], properties: Record<string, unknown>): Set<string> {
  const values = [
    ...labels,
    typeof properties.type === "string" ? properties.type : "",
    typeof properties.kind === "string" ? properties.kind : "",
    typeof properties.category === "string" ? properties.category : "",
    typeof properties.entityType === "string" ? properties.entityType : "",
  ];
  return new Set(values.flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
}

export function classifyEntityKind(labels: readonly string[], properties: Record<string, unknown>): ExtractedEntityKind {
  const tokens = normalizedTokens(labels, properties);
  if ([...tokens].some((token) => PERSON_LABELS.has(token))) return "person";
  if ([...tokens].some((token) => ORG_LABELS.has(token))) return "organization";
  if ([...tokens].some((token) => SOFTWARE_LABELS.has(token))) return "software";
  if ([...tokens].some((token) => PLACE_LABELS.has(token))) return "place";
  if ([...tokens].some((token) => PROJECT_LABELS.has(token))) return "project";
  return "other";
}

export function extractEntityName(properties: Record<string, unknown>): string | undefined {
  for (const key of ["name", "title", "label", "displayName", "term", "value"]) {
    const value = properties[key];
    if (typeof value === "string") {
      const clean = value.replace(/\s+/g, " ").trim();
      if (clean && clean.length <= 240) return clean;
    }
  }
  return undefined;
}

export function extractUrls(text: string, max = 20): string[] {
  const matches = text.match(/https?:\/\/[^\s<>{}\[\]"']+/gi) || [];
  return Array.from(new Set(matches.map((value) => value.replace(/[),.;!?]+$/g, "")))).slice(0, max);
}

export function extractQuotedSpans(text: string, max = 12): string[] {
  const output: string[] = [];
  const patterns = [
    /"([^"\n]{8,280})"/g,
    /“([^”\n]{8,280})”/g,
    /‘([^’\n]{8,280})’/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const clean = match[1].replace(/\s+/g, " ").trim();
      if (clean && !output.includes(clean)) output.push(clean);
      if (output.length >= max) return output;
    }
  }
  return output;
}

export function extractDateFields(properties: Record<string, unknown>, max = 20): Array<{ field: string; value: string }> {
  const output: Array<{ field: string; value: string }> = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!/(created|modified|updated|date|time|timestamp|ingest)/i.test(key)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const clean = String(value).trim();
    if (!clean || clean.length > 180) continue;
    output.push({ field: key, value: clean });
    if (output.length >= max) break;
  }
  return output;
}

export function sourceText(properties: Record<string, unknown>, maxChars = 24000): string {
  const parts: string[] = [];
  for (const key of ["text", "summary", "description", "content", "parentText"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) parts.push(value);
  }
  if (typeof properties.metadata === "string") {
    try {
      const metadata = JSON.parse(properties.metadata) as Record<string, unknown>;
      const parentText = metadata.parentText;
      if (typeof parentText === "string" && parentText.trim()) parts.push(parentText);
    } catch {
      // Unstructured metadata is not treated as content.
    }
  }
  return parts.join("\n").slice(0, maxChars);
}
