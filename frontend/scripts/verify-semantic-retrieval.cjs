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

const { mergeHybridResults } = loadTs("lib/semanticHybrid.ts");

const semantic = [
  { id: "2", kind: "node", title: "Semantic second", score: 0.91 },
  { id: "1", kind: "node", title: "Semantic first", score: 0.88 },
];
const lexical = [
  { id: "1", kind: "node", title: "Lexical duplicate" },
  { id: "3", kind: "source", title: "Lexical source" },
];

const merged = mergeHybridResults(semantic, lexical, 10);
assert.deepEqual(Array.from(merged, (item) => `${item.kind}:${item.id}`), ["node:2", "node:1", "source:3"]);
assert.equal(merged[1].title, "Semantic first", "semantic duplicate should win over lexical duplicate");
assert.equal(merged[1].retrieval, "semantic");
assert.equal(merged[2].retrieval, "lexical");
assert.equal(mergeHybridResults(semantic, lexical, 2).length, 2, "limit should be enforced");

const sigmaSource = fs.readFileSync(path.join(__dirname, "..", "lib", "sigmaNeo4j.ts"), "utf8");
assert.match(sigmaSource, /SHOW INDEXES/, "semantic retrieval must capability-detect vector indexes");
assert.match(sigmaSource, /db\.index\.vector\.queryNodes/, "semantic retrieval must use Neo4j vector query");
assert.match(sigmaSource, /DEFAULT_VECTOR_INDEX = "entity_embeddings"/, "existing entity_embeddings index should remain the default");
assert.doesNotMatch(sigmaSource, /CREATE\s+VECTOR\s+INDEX/i, "Explorer semantic retrieval must never create a vector index");
assert.match(sigmaSource, /lexical_fallback/, "semantic failures must record lexical fallback");

const runRoute = fs.readFileSync(path.join(__dirname, "..", "app", "api", "jev", "run", "route.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(__dirname, "..", "lib", "questions", "router.ts"), "utf8");
assert.match(runRoute, /hybridSearchGraph/, "manual selected GRAPH questions should use hybrid retrieval");
assert.match(routerSource, /hybridSearchGraph/, "routed GRAPH follow-ups should use hybrid retrieval");

console.log("Semantic retrieval verified: semantic-first merge, dedupe, bounded fallback, and read-only vector guardrails.");
