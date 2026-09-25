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

const extraction = loadTs("lib/deterministicExtraction.ts");

assert.equal(extraction.classifyEntityKind(["Person"], {}), "person");
assert.equal(extraction.classifyEntityKind(["Entity"], { type: "organization" }), "organization");
assert.equal(extraction.classifyEntityKind(["Platform"], {}), "software");
assert.equal(extraction.classifyEntityKind(["Location"], {}), "place");
assert.equal(extraction.classifyEntityKind(["Project"], {}), "project");
assert.equal(extraction.classifyEntityKind(["Entity"], {}), "other");

assert.equal(extraction.extractEntityName({ name: "  Neo4j   Labs " }), "Neo4j Labs");
assert.equal(extraction.extractEntityName({ title: "Graph project" }), "Graph project");
assert.equal(extraction.extractEntityName({}), undefined);

assert.deepEqual(
  Array.from(extraction.extractUrls("See https://example.com/a, then https://example.com/a and https://neo4j.com/docs.")),
  ["https://example.com/a", "https://neo4j.com/docs"],
);

assert.deepEqual(
  Array.from(extraction.extractQuotedSpans('He said "build the evidence path first" and “keep graph writes gated”.')),
  ["build the evidence path first", "keep graph writes gated"],
);

const dates = extraction.extractDateFields({
  name: "Example",
  createdAt: "2026-09-25T01:00:00Z",
  modified: "2026-09-25",
  count: 3,
});
assert.deepEqual(Array.from(dates, (item) => item.field), ["createdAt", "modified"]);

const text = extraction.sourceText({
  text: "Primary text",
  metadata: JSON.stringify({ parentText: "Parent context" }),
});
assert.ok(text.includes("Primary text"));
assert.ok(text.includes("Parent context"));

const sigmaSource = fs.readFileSync(path.join(__dirname, "..", "lib", "sigmaNeo4j.ts"), "utf8");
assert.match(sigmaSource, /export async function extractSelectedKnowledge/);
assert.match(sigmaSource, /OPTIONAL MATCH \(selected\)-\[r\]-\(neighbor\)/);
assert.doesNotMatch(
  sigmaSource.slice(sigmaSource.indexOf("export async function extractSelectedKnowledge"), sigmaSource.indexOf("export async function selectedItemContext")),
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP)\b/,
  "selected knowledge extraction must remain read-only",
);

const routerSource = fs.readFileSync(path.join(__dirname, "..", "lib", "questions", "router.ts"), "utf8");
assert.match(routerSource, /extractSelectedKnowledge/);
assert.match(routerSource, /namedEntityProbability:\s*extraction\?\.entities\.length/);
assert.match(routerSource, /External enrichment was not attempted/);

const routeSource = fs.readFileSync(path.join(__dirname, "..", "app", "api", "explorer", "extract", "route.ts"), "utf8");
assert.match(routeSource, /extractSelectedKnowledge/);

console.log("Deterministic extraction verified: entity typing, URLs, quotes, dates, source text, router reconciliation, and read-only guardrails.");
