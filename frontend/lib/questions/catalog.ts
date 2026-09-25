export type QuestionMode = "item" | "graph" | "extraction" | "enrichment" | "reflection";
export type QuestionGroup = "relationships" | "classification" | "actionability" | "opportunities" | "provenance" | "reflection";

export type BooleanOutput = {
  kind: "boolean";
  trueLabel?: string;
  falseLabel?: string;
};

export type ChoiceOutput = {
  kind: "choice";
  criteria: Record<string, string>;
};

export type MultiBooleanOutput = {
  kind: "multi_boolean";
  criteria: Record<string, string>;
};

export type QuestionOutput = BooleanOutput | ChoiceOutput | MultiBooleanOutput;

export type QuestionDefinition = {
  id: string;
  version: number;
  title: string;
  text: string;
  description: string;
  group: QuestionGroup;
  mode: QuestionMode;
  output: QuestionOutput;
  requiresEvidence: boolean;
  proposalPolicy?: "none" | "relationship";
};

export const DEFAULT_QUESTION_ID = "missing_relationship";

export const QUESTION_CATALOG: readonly QuestionDefinition[] = [
  {
    id: "missing_relationship",
    version: 1,
    title: "Missing relationship",
    text: "Is there evidence that an important relationship may be missing between the retrieved graph items?",
    description: "Look for an evidence-supported relationship that is not currently represented. Absence of an edge is uncertainty, not proof.",
    group: "relationships",
    mode: "graph",
    output: { kind: "boolean", trueLabel: "Possible missing relationship", falseLabel: "No supported missing relationship" },
    requiresEvidence: true,
    proposalPolicy: "relationship",
  },
  {
    id: "supersession",
    version: 2,
    title: "Supersession",
    text: "Does the retrieved evidence show that one item supersedes or replaces another?",
    description: "Require explicit replacement, retirement, current/old, or supersession evidence. Do not infer replacement from similarity alone.",
    group: "relationships",
    mode: "graph",
    output: {
      kind: "choice",
      criteria: {
        supersedes: "The evidence supports that one retrieved item replaced or superseded another.",
        does_not_supersede: "The retrieved items may be related, but the evidence does not support supersession.",
        uncertain: "The evidence is insufficient or ambiguous.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "temporal_status",
    version: 1,
    title: "Current or historical",
    text: "What temporal status best fits the retrieved evidence?",
    description: "Distinguish active/current material from old, retired, or superseded material.",
    group: "relationships",
    mode: "graph",
    output: {
      kind: "choice",
      criteria: {
        current: "Evidence indicates a current or active state.",
        historical: "Evidence indicates an old, retired, or superseded state.",
        mixed: "Evidence contains both current and historical signals.",
        unknown: "The evidence does not establish temporal status.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "evidence_alignment",
    version: 1,
    title: "Evidence alignment",
    text: "How do the retrieved sources align with one another?",
    description: "Identify whether sources support, conflict with, or fail to establish a coherent interpretation.",
    group: "relationships",
    mode: "graph",
    output: {
      kind: "choice",
      criteria: {
        supporting: "Sources support a coherent interpretation.",
        conflicting: "Sources materially contradict one another.",
        mixed: "Sources include both support and conflict.",
        insufficient: "There is not enough evidence.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "object_type",
    version: 1,
    title: "Object type",
    text: "What kind of knowledge object does this selected item most strongly represent?",
    description: "Classify the selected item by its primary role without inventing commitments that are not stated.",
    group: "classification",
    mode: "item",
    output: {
      kind: "choice",
      criteria: {
        idea: "A possibility, concept, or suggestion that is not yet a commitment.",
        goal: "A desired outcome or state to work toward.",
        task: "A concrete action that can be performed.",
        decision: "A choice, commitment, or selected option.",
        question: "An unresolved question or inquiry.",
        belief: "A proposition presented as something Ben believes or accepts.",
        principle: "A durable rule, value, heuristic, or guiding principle.",
        preference: "A stated preference, taste, or recurring choice.",
        other: "None of the listed types clearly fits.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "topic_classification",
    version: 1,
    title: "Topics",
    text: "Which topic groups materially apply to this selected item?",
    description: "This is multi-label. Mark only topics that are actually supported by the selected content.",
    group: "classification",
    mode: "item",
    output: {
      kind: "multi_boolean",
      criteria: {
        agents_technology: "Agents, AI, software, hardware, computing, automation, or technology.",
        money_finance: "Money, personal finance, investing, markets, stocks, inflation, or business finance.",
        health_fitness: "Physical health, mental health, fitness, gym, weight loss, muscle gain, prescriptions, drugs, vitamins, or supplements.",
        career_business: "Career, work, business ideas, professional development, or entrepreneurship.",
        politics_law: "Politics, government, laws, regulation, justice, rights, or freedom.",
        people_relationships: "People, family, social relationships, identity of named people, or interpersonal situations.",
        media_entertainment: "Social media, news/media, entertainment, movies, television, or digital content.",
        philosophy_purpose: "Philosophy, beliefs, principles, purpose, meaning, direction, passions, or life advice.",
        animals: "Animals or a specific animal species.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "actionability",
    version: 1,
    title: "Actionability",
    text: "What is the best next disposition for this selected item?",
    description: "Judge whether it is ready to act on, should be explored/researched, is too vague, or needs no action.",
    group: "actionability",
    mode: "item",
    output: {
      kind: "choice",
      criteria: {
        actionable: "A concrete next action is clear and can reasonably be started now.",
        explore: "The idea is worth exploring or trialing before committing.",
        research: "More information or competing viewpoints are needed before acting.",
        vague: "The item is too underspecified to act on without clarification.",
        no_action: "It is primarily reference, reflection, or information and does not imply an action.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "related_prior_knowledge",
    version: 1,
    title: "Related prior knowledge",
    text: "How does the retrieved material relate to prior knowledge in the graph?",
    description: "Use graph evidence to distinguish novelty, similarity, refinement, continuation, contradiction, and duplication.",
    group: "relationships",
    mode: "graph",
    output: {
      kind: "choice",
      criteria: {
        new: "No sufficiently close prior item is supported by the retrieved evidence.",
        related: "A prior item is materially related but no stronger relationship is established.",
        duplicates: "The item substantially repeats the same knowledge as a prior item.",
        refines: "The item makes prior knowledge more specific, precise, or developed.",
        continues: "The item continues an existing line of work, thought, or activity.",
        contradicts: "The item materially conflicts with prior knowledge.",
        uncertain: "The retrieved evidence is insufficient to classify the relationship.",
      },
    },
    requiresEvidence: true,
  },
  {
    id: "automation_candidate",
    version: 1,
    title: "Automation candidate",
    text: "Could the behavior, task, workflow, or process in this selected item reasonably be automated or partially automated with software, agents, or LLMs?",
    description: "Judge practical automability, not whether automation has already been implemented.",
    group: "opportunities",
    mode: "item",
    output: { kind: "boolean", trueLabel: "Automation candidate", falseLabel: "Not an obvious automation candidate" },
    requiresEvidence: true,
  },
  {
    id: "eval_candidate",
    version: 1,
    title: "Eval / regression candidate",
    text: "Could this selected item be turned into a useful evaluation or regression case for an agent or model?",
    description: "Look for a repeatable input, expected judgment/behavior, failure mode, or acceptance criterion.",
    group: "opportunities",
    mode: "item",
    output: { kind: "boolean", trueLabel: "Eval candidate", falseLabel: "Not an obvious eval candidate" },
    requiresEvidence: true,
  },
  {
    id: "research_candidate",
    version: 1,
    title: "Research candidate",
    text: "Is this selected item worth researching further before treating it as settled knowledge or acting on it?",
    description: "Consider uncertainty, potential value, missing evidence, and the need for multiple sources or viewpoints.",
    group: "opportunities",
    mode: "item",
    output: { kind: "boolean", trueLabel: "Research candidate", falseLabel: "No additional research clearly needed" },
    requiresEvidence: true,
  },
] as const;

const byId = new Map(QUESTION_CATALOG.map((question) => [question.id, question]));

export function getQuestionDefinition(id: string | undefined | null): QuestionDefinition | undefined {
  return id ? byId.get(id) : undefined;
}

export function questionGroups(): QuestionGroup[] {
  return Array.from(new Set(QUESTION_CATALOG.map((question) => question.group)));
}

export function validateQuestionCatalog(catalog: readonly QuestionDefinition[] = QUESTION_CATALOG): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const question of catalog) {
    if (!question.id.trim()) errors.push("Question id is required");
    if (ids.has(question.id)) errors.push(`Duplicate question id: ${question.id}`);
    ids.add(question.id);
    if (!Number.isInteger(question.version) || question.version < 1) errors.push(`Question ${question.id} has an invalid version`);
    if (!question.title.trim() || !question.text.trim()) errors.push(`Question ${question.id} is missing title/text`);
    if (question.output.kind === "choice" || question.output.kind === "multi_boolean") {
      if (Object.keys(question.output.criteria).length < 2) errors.push(`Question ${question.id} needs at least two criteria`);
    }
  }
  return errors;
}
