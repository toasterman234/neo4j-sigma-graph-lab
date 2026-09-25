import "server-only";

import { confidenceFromJev, evaluateJevState, type JevProviderResponse } from "@/lib/jev";
import { getQuestionDefinition, type QuestionDefinition } from "@/lib/questions/catalog";
import { buildQuestionState, compileQuestionDefinitions, runCatalogQuestion, type JevRunResponse, type RoutingTrace } from "@/lib/questions/runner";
import { extractRouterSignals, planRouterFollowUps, ROUTER_QUESTION_IDS, ROUTER_VERSION, type RouterPlan, type RouterSignals, type RouterTrigger } from "@/lib/questions/routerPlan";
import { searchGraph, type SearchMode, type SearchResponse, type SearchScope } from "@/lib/sigmaNeo4j";

export type RouterFollowUp = {
  trigger: RouterTrigger;
  question: { id: string; title: string; mode: string };
  result?: JevRunResponse;
  error?: string;
};

export type RouterRunResponse = {
  router: {
    version: number;
    questionIds: string[];
    signals: RouterSignals;
    judgment: { answers?: JevProviderResponse["answers"]; warnings?: unknown };
    confidence: Record<string, number>;
    evidence: JevRunResponse["evidence"];
    boundedContext: { nodeCount: number; relationshipCount: number; resultCount: number };
  };
  plan: RouterPlan;
  graphRetrieval?: {
    query: string;
    scope: SearchScope;
    mode: SearchMode;
    counts: SearchResponse["counts"];
  };
  followUps: RouterFollowUp[];
};

export type RunQuestionRouterRequest = {
  itemSearch: SearchResponse;
  selectedNodeIds: string[];
  graphQuery?: string;
  graphScope?: SearchScope;
  graphMode?: SearchMode;
  userNote?: string;
};

function routerDefinitions(): QuestionDefinition[] {
  return ROUTER_QUESTION_IDS.map((id) => {
    const definition = getQuestionDefinition(id);
    if (!definition) throw new Error(`Router question is missing from catalog: ${id}`);
    if (definition.mode !== "item") throw new Error(`Router question must use ITEM mode: ${id}`);
    return definition;
  });
}

function answersForSignals(raw: JevProviderResponse): Record<string, { choice?: string; probability?: number }> {
  return Object.fromEntries(Object.entries(raw.answers || {}).map(([key, answer]) => [
    key,
    {
      choice: typeof answer.choice === "string" ? answer.choice : undefined,
      probability: typeof answer.probability === "number" ? answer.probability : undefined,
    },
  ]));
}

function fallbackGraphQuery(itemSearch: SearchResponse): string {
  const firstTitle = itemSearch.results.find((result) => result.title.trim())?.title.trim();
  if (firstTitle && firstTitle.toLowerCase() !== "selected item") return firstTitle;
  return itemSearch.query.trim() || "selected item";
}

export async function runQuestionRouter(request: RunQuestionRouterRequest): Promise<RouterRunResponse> {
  if (!request.selectedNodeIds.length) throw new Error("Question router requires a selected document/source or graph object");

  const definitions = routerDefinitions();
  const routerRequest = {
    search: request.itemSearch,
    selectedNodeIds: request.selectedNodeIds,
    userNote: request.userNote,
  };
  const { state, evidence, nodeCount, relationshipCount } = buildQuestionState(routerRequest, definitions);
  if (!nodeCount) throw new Error("No selected-item evidence was retrieved for the router");

  const raw = await evaluateJevState(state, compileQuestionDefinitions(definitions));
  const signals = extractRouterSignals(answersForSignals(raw));
  const plan = planRouterFollowUps(signals);

  const graphTriggers = plan.triggers.filter((trigger) => getQuestionDefinition(trigger.questionId)?.mode === "graph");
  let graphSearch: SearchResponse | undefined;
  let graphQuery = "";
  if (graphTriggers.length) {
    graphQuery = request.graphQuery?.trim() || fallbackGraphQuery(request.itemSearch);
    graphSearch = await searchGraph(
      graphQuery,
      request.graphScope || "whole",
      request.graphMode || "keyword",
      request.selectedNodeIds,
      80,
    );
  }

  const followUps = await Promise.all(plan.triggers.map(async (trigger): Promise<RouterFollowUp> => {
    const definition = getQuestionDefinition(trigger.questionId);
    if (!definition) {
      return {
        trigger,
        question: { id: trigger.questionId, title: trigger.questionId, mode: "unknown" },
        error: "Triggered question is missing from the catalog",
      };
    }

    const search = definition.mode === "graph" ? graphSearch : request.itemSearch;
    if (!search || !search.context.nodes.length) {
      return {
        trigger,
        question: { id: definition.id, title: definition.title, mode: definition.mode },
        error: definition.mode === "graph"
          ? `No bounded graph candidates were retrieved for query "${graphQuery}".`
          : "No selected-item evidence was available.",
      };
    }

    const routing: RoutingTrace = {
      kind: "router",
      routerVersion: ROUTER_VERSION,
      routerQuestionIds: [...ROUTER_QUESTION_IDS],
      reasons: trigger.reasons,
      signals: { ...signals },
    };

    try {
      const result = await runCatalogQuestion({
        questionId: definition.id,
        userNote: request.userNote,
        search,
        selectedNodeIds: request.selectedNodeIds,
        routing,
      });
      return {
        trigger,
        question: { id: definition.id, title: definition.title, mode: definition.mode },
        result,
      };
    } catch (error) {
      return {
        trigger,
        question: { id: definition.id, title: definition.title, mode: definition.mode },
        error: error instanceof Error ? error.message : "Follow-up judgment failed",
      };
    }
  }));

  return {
    router: {
      version: ROUTER_VERSION,
      questionIds: [...ROUTER_QUESTION_IDS],
      signals,
      judgment: { answers: raw.answers, warnings: raw.warnings },
      confidence: confidenceFromJev(raw),
      evidence,
      boundedContext: {
        nodeCount,
        relationshipCount,
        resultCount: request.itemSearch.results.length,
      },
    },
    plan,
    graphRetrieval: graphSearch ? {
      query: graphQuery,
      scope: graphSearch.scope,
      mode: graphSearch.mode,
      counts: graphSearch.counts,
    } : undefined,
    followUps,
  };
}
