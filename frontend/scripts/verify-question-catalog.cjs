const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "lib", "questions", "catalog.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
}).outputText;

const moduleShim = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleShim,
  exports: moduleShim.exports,
  require,
  console,
}, { filename: sourcePath });

const { QUESTION_CATALOG, validateQuestionCatalog, getQuestionDefinition } = moduleShim.exports;

assert.ok(Array.isArray(QUESTION_CATALOG), "catalog should be an array");
assert.equal(validateQuestionCatalog().length, 0, "catalog should validate cleanly");
assert.equal(new Set(QUESTION_CATALOG.map((question) => question.id)).size, QUESTION_CATALOG.length, "question ids must be unique");
assert.ok(QUESTION_CATALOG.every((question) => Number.isInteger(question.version) && question.version >= 1), "all questions need positive integer versions");

const itemIds = ["object_type", "topic_classification", "actionability", "automation_candidate", "eval_candidate", "research_candidate"];
const graphIds = ["missing_relationship", "supersession", "temporal_status", "evidence_alignment", "related_prior_knowledge"];

for (const id of itemIds) {
  const question = getQuestionDefinition(id);
  assert.ok(question, `missing item question: ${id}`);
  assert.equal(question.mode, "item", `${id} should use selected-item evidence only`);
}

for (const id of graphIds) {
  const question = getQuestionDefinition(id);
  assert.ok(question, `missing graph question: ${id}`);
  assert.equal(question.mode, "graph", `${id} should require bounded graph retrieval`);
}

assert.equal(getQuestionDefinition("missing_relationship").proposalPolicy, "relationship", "missing relationship should remain proposal-only");
assert.equal(getQuestionDefinition("object_type").proposalPolicy, undefined, "classification should not create graph relationship proposals");

console.log(`Question catalog verified: ${QUESTION_CATALOG.length} definitions, ${itemIds.length} ITEM, ${graphIds.length} GRAPH.`);
