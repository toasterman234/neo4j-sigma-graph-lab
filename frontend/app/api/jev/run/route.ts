import { NextResponse } from "next/server";
import { DEFAULT_QUESTION_ID, getQuestionDefinition, validateQuestionCatalog } from "@/lib/questions/catalog";
import { runCatalogQuestion } from "@/lib/questions/runner";
import { searchGraph, selectedItemContext, type SearchMode, type SearchScope } from "@/lib/sigmaNeo4j";

export const runtime = "nodejs";

const scopes = new Set<SearchScope>(["selected", "neighborhood", "whole"]);
const modes = new Set<SearchMode>(["keyword", "property", "document", "relationship"]);

export async function POST(request: Request) {
  try {
    const catalogErrors = validateQuestionCatalog();
    if (catalogErrors.length) throw new Error(`Question catalog is invalid: ${catalogErrors.join("; ")}`);

    const body = await request.json() as {
      query?: string;
      scope?: string;
      mode?: string;
      selectedNodeIds?: string[];
      question?: string;
      questionId?: string;
      questionType?: string;
    };

    const query = typeof body.query === "string" ? body.query.trim() : "";
    const scope = scopes.has(body.scope as SearchScope) ? body.scope as SearchScope : "whole";
    const mode = modes.has(body.mode as SearchMode) ? body.mode as SearchMode : "keyword";
    const selectedNodeIds = Array.isArray(body.selectedNodeIds) ? body.selectedNodeIds.slice(0, 20) : [];
    const questionId = typeof body.questionId === "string" && body.questionId
      ? body.questionId
      : typeof body.questionType === "string" && body.questionType
        ? body.questionType
        : DEFAULT_QUESTION_ID;
    const definition = getQuestionDefinition(questionId);

    if (!definition) return NextResponse.json({ error: `Unknown question id: ${questionId}` }, { status: 400 });

    let search;
    if (definition.mode === "item") {
      if (!selectedNodeIds.length) {
        return NextResponse.json({ error: `${definition.title} requires a selected document/source or graph object` }, { status: 400 });
      }
      search = await selectedItemContext(selectedNodeIds, query || definition.title, 24);
    } else if (definition.mode === "graph") {
      if (!query) return NextResponse.json({ error: `${definition.title} requires a graph search query` }, { status: 400 });
      search = await searchGraph(query, scope, mode, selectedNodeIds, 80);
    } else {
      return NextResponse.json({ error: `Question mode '${definition.mode}' is cataloged but not implemented yet` }, { status: 400 });
    }

    return NextResponse.json(await runCatalogQuestion({
      questionId: definition.id,
      userNote: typeof body.question === "string" ? body.question : undefined,
      search,
      selectedNodeIds,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run Jev" }, { status: 400 });
  }
}
