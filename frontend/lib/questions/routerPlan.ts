export const ROUTER_VERSION = 1;
export const MAX_ROUTED_FOLLOWUPS = 4;
export const ROUTER_QUESTION_IDS = [
  "object_type",
  "topic_classification",
  "intent_signal",
  "named_entity_signal",
  "actionability",
  "prior_knowledge_signal",
] as const;

export type RouterAnswer = {
  choice?: string;
  probability?: number;
};

export type RouterSignals = {
  objectType?: string;
  topics: string[];
  intent?: string;
  namedEntityProbability: number;
  actionability?: string;
  priorKnowledgeProbability: number;
};

export type RouterTrigger = {
  questionId: string;
  priority: number;
  reasons: string[];
};

export type RouterPlan = {
  triggers: RouterTrigger[];
  deferred: string[];
};

function probability(answers: Record<string, RouterAnswer>, id: string): number {
  const value = answers[id]?.probability;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function extractRouterSignals(answers: Record<string, RouterAnswer>): RouterSignals {
  const topics = Object.entries(answers)
    .filter(([id, answer]) => id.startsWith("topic_classification__") && typeof answer.probability === "number" && answer.probability >= 0.6)
    .map(([id]) => id.replace("topic_classification__", ""));

  return {
    objectType: answers.object_type?.choice,
    topics,
    intent: answers.intent_signal?.choice,
    namedEntityProbability: probability(answers, "named_entity_signal"),
    actionability: answers.actionability?.choice,
    priorKnowledgeProbability: probability(answers, "prior_knowledge_signal"),
  };
}

export function planRouterFollowUps(signals: RouterSignals): RouterPlan {
  const byId = new Map<string, RouterTrigger>();
  const add = (questionId: string, priority: number, reason: string) => {
    const current = byId.get(questionId);
    if (current) {
      if (!current.reasons.includes(reason)) current.reasons.push(reason);
      current.priority = Math.min(current.priority, priority);
      return;
    }
    byId.set(questionId, { questionId, priority, reasons: [reason] });
  };

  if (signals.priorKnowledgeProbability >= 0.6) {
    add("related_prior_knowledge", 10, `Prior-knowledge dependency scored ${signals.priorKnowledgeProbability.toFixed(2)}.`);
  }

  if (signals.objectType === "decision") {
    add("supersession", 5, "The item was classified as a decision, so possible replacement/supersession should be checked.");
    add("temporal_status", 15, "The item was classified as a decision, so current-vs-historical status is relevant.");
    add("related_prior_knowledge", 10, "The item was classified as a decision and should be compared with prior graph knowledge.");
  }

  if (signals.intent === "research" || signals.actionability === "research") {
    add("research_candidate", 20, `Routing signals indicate research intent/actionability (${signals.intent || "unknown"} / ${signals.actionability || "unknown"}).`);
  }

  const technology = signals.topics.includes("agents_technology");
  const executionIntent = signals.intent === "act" || signals.intent === "explore";
  const actionable = signals.actionability === "actionable" || signals.actionability === "explore";
  if (technology && (executionIntent || actionable || signals.objectType === "task")) {
    add("automation_candidate", 25, "The item is technology/agent-related and signals execution, exploration, or a task.");
  }

  if (technology && ["idea", "task", "decision", "question"].includes(signals.objectType || "") && (executionIntent || actionable)) {
    add("eval_candidate", 30, "The item is technology/agent-related, actionable, and shaped like something that may become a repeatable eval/regression case.");
  }

  return {
    triggers: Array.from(byId.values())
      .sort((left, right) => left.priority - right.priority || left.questionId.localeCompare(right.questionId))
      .slice(0, MAX_ROUTED_FOLLOWUPS),
    deferred: [],
  };
}
