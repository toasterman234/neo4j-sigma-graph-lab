const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadTs(relativePath) {
  const sourcePath = path.join(__dirname, "..", relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText;
  const moduleShim = { exports: {} };
  vm.runInNewContext(compiled, { module: moduleShim, exports: moduleShim.exports, require, console }, { filename: sourcePath });
  return moduleShim.exports;
}

const catalog = loadTs("lib/questions/catalog.ts");
const router = loadTs("lib/questions/routerPlan.ts");

for (const id of router.ROUTER_QUESTION_IDS) {
  const question = catalog.getQuestionDefinition(id);
  assert.ok(question, `router question missing from catalog: ${id}`);
  assert.equal(question.mode, "item", `router question must be ITEM mode: ${id}`);
}
assert.equal(router.ROUTER_QUESTION_IDS.length, 6, "router should keep the six-signal contract");

const decisionSignals = {
  objectType: "decision",
  topics: [],
  intent: "act",
  namedEntityProbability: 0.2,
  actionability: "actionable",
  priorKnowledgeProbability: 0.82,
};
const decisionPlan = router.planRouterFollowUps(decisionSignals);
assert.deepEqual(Array.from(decisionPlan.triggers, (x) => x.questionId), ["supersession", "related_prior_knowledge", "temporal_status"]);
assert.ok(decisionPlan.triggers.every((x) => x.reasons.length > 0), "every trigger must explain why it ran");

const techPlan = router.planRouterFollowUps({
  objectType: "idea",
  topics: ["agents_technology"],
  intent: "explore",
  namedEntityProbability: 0.1,
  actionability: "explore",
  priorKnowledgeProbability: 0.2,
});
assert.ok(techPlan.triggers.some((x) => x.questionId === "automation_candidate"), "tech exploration should route to automation");
assert.ok(techPlan.triggers.some((x) => x.questionId === "eval_candidate"), "actionable tech idea should route to eval");

const researchPlan = router.planRouterFollowUps({
  objectType: "question",
  topics: [],
  intent: "research",
  namedEntityProbability: 0.7,
  actionability: "research",
  priorKnowledgeProbability: 0.1,
});
assert.ok(researchPlan.triggers.some((x) => x.questionId === "research_candidate"), "research intent should route to research candidate");
assert.equal(researchPlan.deferred.length, 0, "named-entity reconciliation now occurs after deterministic extraction, not in the pure routing plan");

const extracted = router.extractRouterSignals({
  object_type: { choice: "task" },
  "topic_classification__agents_technology": { probability: 0.81 },
  "topic_classification__health_fitness": { probability: 0.44 },
  intent_signal: { choice: "act" },
  named_entity_signal: { probability: 0.66 },
  actionability: { choice: "actionable" },
  prior_knowledge_signal: { probability: 0.72 },
});
assert.equal(extracted.objectType, "task");
assert.deepEqual(Array.from(extracted.topics), ["agents_technology"]);
assert.equal(extracted.namedEntityProbability, 0.66);
assert.equal(extracted.priorKnowledgeProbability, 0.72);

const crowdedPlan = router.planRouterFollowUps({
  objectType: "decision",
  topics: ["agents_technology"],
  intent: "research",
  namedEntityProbability: 0.9,
  actionability: "research",
  priorKnowledgeProbability: 0.9,
});
assert.ok(crowdedPlan.triggers.length <= router.MAX_ROUTED_FOLLOWUPS, "router must enforce follow-up cap");

console.log(`Question router verified: ${router.ROUTER_QUESTION_IDS.length} base signals, max ${router.MAX_ROUTED_FOLLOWUPS} follow-ups.`);
