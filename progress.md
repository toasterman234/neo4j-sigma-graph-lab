# Progress

## 2026-09-23
- Inspected the existing scaffold, routes, frontend dependencies, current live services, and Neo4j configuration.
- Confirmed existing backend is healthy and connected to the configured Bolt graph.
- Confirmed Sigma.js/Graphology are not currently installed.
- Created this task plan and findings log.

## 2026-09-23 — Sigma explorer implementation
- Added Sigma.js, Graphology, graphology-neo4j, graphology-types, and dotenv dependencies.
- Added server-side `frontend/lib/sigmaNeo4j.ts` adapter using the existing `.env`, neo4j-driver read sessions, read-only Cypher validation, bounded results, and `cypherToGraph`.
- Added Next.js API routes for bounded graph load, node search, and selected-node neighbor expansion.
- Added `/sigma-explorer` with Sigma.js visualization, Graphology model, search, selection inspector, focus, expansion, label/type visibility filters, directed relationship arrows/type labels, and custom read-only Cypher.
- Documented setup, adapter behavior, limits, and the graphology-neo4j peer dependency limitation.
- Verified live default query: 93 nodes / 100 relationships.
- Verified live search: 5 real results for `Process`.
- Verified live expansion: 10 nodes / 9 relationships for a real node.
- Verified live custom query: 10 Project nodes.
- Verified mutation query rejection: HTTP 400, `Only read-only Cypher is allowed`.
- Backend tests: 4 passed. Frontend build and TypeScript checks passed.
- Added the Modeling tab, shared Explorer/Modeling navigation, repository architecture docs, agent guide, continuation guide, and hardened `.gitignore`.
- Initialized nested Git repository and created commit `e5a1f45` (`Initial Neo4j Sigma Graph Lab`).
- GitHub remote creation and push remain pending.

## 2026-09-23 — Issue #1 Document/Source view
- Added `frontend/lib/documentSource.ts` to group Chunk nodes by source URI/path, derive human-readable filename/path/type/provenance, reconstruct ordered text, and track semantic relationships.
- Updated `SigmaNeo4jExplorer.tsx` to render logical Document/Source nodes by default, with readable provenance/content/extracted objects and an explicit raw chunk evidence toggle.
- Added styling for provenance fields, source content, semantic relationship buttons, and evidence controls.
- Preserved read-only API and underlying Neo4j payload behavior; grouping occurs only in the browser presentation layer.
- Frontend `npx tsc --noEmit` passed and `npm run build` passed.
- Backend test command is blocked during collection by `ModuleNotFoundError: neo4j` under pytest, although `uv run python` imports `neo4j` and `app.context_graph_client` successfully; this is unresolved and not claimed passing.
- Live graph and search endpoints were probed successfully; live payloads contain sourceUrl metadata on Chunk nodes. Browser-level interaction checks and expansion/custom-query/mutation probes were not re-run in this implementation pass.

## 2026-09-23 — Whole-graph retrieval and Jev reasoning
- Added bounded search scopes (`whole`, `selected`, `neighborhood`) and modes (`keyword`, `property`, `document`, `relationship`) with parameterized read-only Neo4j queries.
- Updated `/api/explorer/search` to return grouped node/source/relationship results plus bounded graph context.
- Added server-side `/api/jev/run`; it retrieves context server-side, caps Jev input at 24 nodes and 40 relationships, truncates excerpts, and never sends the full graph to Jev.
- Added typed Jev judgments for missing relationships, supersession, temporal status, evidence alignment, and provisional candidate relationships.
- Added graph-wide search controls, result grouping, focus actions, and Reason with Jev output/evidence/provisional suggestion panels to the Sigma explorer.
- Direct Jev verification over bounded live Process search context succeeded; it returned typed answers and no graph write.
- Final frontend type check and production build passed after integration.
- Live whole-graph keyword, relationship, document, selected, and neighborhood searches passed with bounded responses.
- Live Jev route passed against actual Process graph retrieval; Jev returned typed probabilities/choices over 24 nodes and 20 relationships, with no provisional write performed.
- Mutation rejection still passed with HTTP 400 (`Only read-only Cypher is allowed`).
- Backend tests passed via `uv run python -m pytest tests/ -q`: 4 passed.
- `npm run lint` remains blocked because the repository has no ESLint 9 flat config.

## 2026-09-23 — SQLite result persistence
- Confirmed search/Jev results were not persisted beyond the current page/session.
- Added `better-sqlite3` and `frontend/lib/resultStore.ts` with a local `.data/graph-lab.sqlite` store, 100-result retention cap, JSON size limits, and WAL mode.
- Added `GET/POST /api/results` for listing and explicitly saving Jev results.
- Added Save result control and saved-result summaries to the Sigma explorer.
- Documented the local persistence boundary; Neo4j remains read-only.
- Verified frontend typecheck and production build passed.
- Verified save/list persistence across a server restart using a temporary SQLite database.
- Backend tests remain passing from the previous phase: 4 passed.

## 2026-09-23 — Jev result presentation
- Replaced raw Jev JSON presentation with typed answer cards for boolean/noul probabilities, choice distributions, scores, provider confidence, and unverified-decision labeling.
- Replaced native scope/mode/question selectors with explicit button groups and tooltips for the supported search and Jev options.
- Made saved result cards reopen the full judgment/evidence view and distinguish saved results from live provider responses.
- Preserved evidence focus actions and provisional relationship warnings.
- Verified typecheck and production build passed.
- Verified a saved result reopened with its typed judgment and mutation rejection remained HTTP 400.

## 2026-09-23 — GitHub update
- Prepared the pending implementation changes for `origin/main` at `toasterman234/neo4j-sigma-graph-lab`.
- Final verification before publish: frontend typecheck/build passed, backend tests passed, SQLite restart/size-limit checks passed, and `git diff --check` passed.
- Committed as `744ea4d` (`Add graph-wide Jev search and SQLite result persistence`) and pushed to `origin/main`.

## 2026-09-23 — Proposed schema modeling
- Added a separate Proposed Schema graph view to the Modeling tab with bounded lookup and a proposal queue.
- Added `GET/POST/PATCH /api/modeling/proposals`; draft generation retrieves bounded graph context, asks Jev for typed relationship evaluation, and creates local node-type, observed-pattern, and provisional-relationship proposals.
- Added SQLite `model_proposals` and append-only `proposal_decisions` tables. Yes/No/Defer decisions update only the local proposed schema projection; Neo4j remains untouched.
- Added pending/accepted/deferred/rejected graph styling, evidence cards, confidence, rationale, and explicit read-only/local-model safety labels.
- Verified frontend typecheck and production build passed.
- Verified live Process lookup drafted 4 proposals, accepted one through PATCH, persisted the decision through GET, and rejected a Neo4j mutation with HTTP 400.
- `npm run lint` remains blocked because the repository has no ESLint 9 flat config; browser E2E has not been run.

## 2026-09-23 — Human-readable graph presentation
- Added a shared display adapter for semantic nodes and relationships. Values such as `x-amz-bedrock-kb-process run` now display as `Process Run` / `Concept` instead of exposing `Entity 2432` or Neptune IDs.
- Kept the graph source-centric: Chunk nodes collapse into documents, opaque DocumentId/Entity records are omitted when no human name exists, and technical evidence remains opt-in.
- Search results now show document filenames, named concepts, readable relationship labels, and content excerpts without raw Neptune/ingestion keys.
- Source paths now shorten to the vault workspace path; source content prefers readable `parentText` with chunk text fallback.
- Verified live Process search returned `Process.md`, `Process Run`, `Event`, `Work Item`, `Project`, `Step`, and `Plan` with no `Entity`, `DocumentId`, or `neptune_` display values.
- Verified live proposal drafting now produces only human titles such as `Document -[contains]-> Concept` and `Concept -[evidenced by]-> Document`; technical Document reference proposals are filtered out.
- Verified frontend typecheck and production build passed; mutation rejection remained HTTP 400.
- `npm run lint` remains blocked because the repository has no ESLint 9 flat config; browser E2E has not been run.

## 2026-09-23 — Proposed schema interaction fixes
- Normalized legacy SQLite proposal records at read time, including stored `Chunk`/`Entity` labels, IDs, titles, and evidence labels.
- Added Proposed Schema Sigma node and edge click handlers; clicking a graph item now selects its proposal detail card and decision controls.
- Verified current proposal API returns human labels only, with no `Entity`, `Chunk`, or `DocumentId` titles/labels and no duplicated concept-type prefix.
- Verified frontend typecheck and production build passed; `/modeling` returned HTTP 200.
- Browser-level click verification remains outstanding; `npm run lint` remains blocked because the repository has no ESLint 9 flat config.


## 2026-09-25 — Issue #4 Question Catalog first slice
- Started from authoritative Issue #4 and current `main` at `a207e2c`; implementation remained on `work/question-catalog-jev` and draft PR #5.
- Replaced the fixed question definitions in `frontend/lib/jev.ts` with a generic server-only Jev evaluator and added the versioned catalog in `frontend/lib/questions/catalog.ts`.
- Added `frontend/lib/questions/runner.ts` with explicit ITEM versus GRAPH execution. ITEM questions retrieve only the selected node/chunks; GRAPH questions keep the existing bounded Neo4j retrieval path. Jev state remains capped at 24 nodes / 40 relationships.
- Added the initial usable catalog: object type, topic classification, actionability, related prior knowledge, supersession, automation candidate, eval candidate, research candidate, plus the pre-existing missing-relationship, temporal-status, and evidence-alignment judgments.
- Preserved the existing Modeling proposal path through a compatibility wrapper; relationship suggestions remain provisional and no canonical Neo4j write path was added.
- Extended saved-result SQLite rows with additive `question_meta_json` and `source_context_json` fields, including legacy fallbacks for existing records.
- Updated the Sigma explorer with a Question Catalog selector. ITEM questions can run from a selected source/node without a graph search query; GRAPH questions still require bounded retrieval.
- Added `frontend/scripts/verify-question-catalog.cjs` and `npm run test:catalog` to validate catalog ids/versions, required initial questions, ITEM/GRAPH routing, and proposal-policy boundaries.
- Verification run `36102119311` passed: question catalog contract ✓, strict TypeScript ✓, Next.js production build ✓, backend tests ✓ using the declared `dev` extra.
- The first CI attempt exposed only a verifier setup mistake: `pytest` is an optional backend `dev` dependency. The verifier was corrected to use `uv run --extra dev python -m pytest tests/ -q`; no backend dependency change was made.
- Governed Mac bridge execution itself reported healthy on run `36101510486`, but its result-artifact upload failed because GitHub Actions artifact storage quota is exhausted. This control-plane defect is tracked as `github-workflows-control-plane#36`.
- No existing `neo4j-sigma-graph-lab` clone was found in the governed Mac home/codex-scratch workspaces, so branch-specific live ZimaOS Neo4j/browser verification was not performed. The live mutation-rejection/read-only behavior for this branch therefore remains **unverified**, rather than being inferred from earlier main-branch checks.
- Deferred exactly as scoped in Issue #4: router/batch execution, generalized proposal kinds, semantic/vector candidate retrieval, extraction/enrichment execution modes, GitGraph-style longitudinal UI, and any canonical promotion/write gate.


## 2026-09-25 — Issue #4 automatic question router
- Continued Issue #4 from merged Question Catalog baseline `897147f` on `work/question-router-followups` / PR #6.
- Added three router-only catalog signals for intent, named-entity presence, and prior-knowledge dependency. Together with object type, topic classification, and actionability, the router now evaluates the six-signal contract from Issue #4 in one combined Jev call.
- Added `frontend/lib/questions/routerPlan.ts` with deterministic, explainable routing rules and a hard cap of four follow-ups. Trigger reasons are preserved and deduplicated.
- Added `frontend/lib/questions/router.ts` and `POST /api/jev/route`. ITEM follow-ups reuse selected-item evidence; GRAPH follow-ups reuse at most one bounded graph retrieval. Individual follow-up failures do not discard successful siblings.
- Current automatic follow-ups can include related-prior-knowledge, supersession, temporal-status, research-candidate, automation-candidate, and eval-candidate judgments.
- Named-entity presence is intentionally surfaced as deferred until deterministic extraction/enrichment is implemented; the router does not invent external person/org facts.
- Added routing trace metadata to `JevRunResponse` and additive SQLite `routing_json` persistence. Saved routed follow-ups retain router version, base question ids, signal snapshot, and exact trigger reasons.
- Updated the Sigma explorer with **Auto-route selected**, a router signal summary, one bounded graph-retrieval summary, automatic follow-up cards, deferred-signal display, and routed-result inspection/saving.
- Added `frontend/scripts/verify-question-router.cjs` and `npm run test:router` covering the six-signal contract, decision routing, technology automation/eval routing, research routing, named-entity deferral, signal extraction, trigger reasons, and the four-follow-up cap.
- Verification run `36104781462` passed: catalog contract ✓, router contract ✓, strict TypeScript ✓, Next.js production build ✓, backend tests ✓.
- Neo4j remains read-only. No semantic/vector retrieval, external enrichment, generalized proposal kinds, batch routing across many sources, or canonical promotion/write path was added.


## 2026-09-25 — Issue #4 semantic / hybrid retrieval
- Continued Issue #4 from merged router baseline `ad54871` on `work/semantic-hybrid-retrieval` / PR #7.
- Reused the repository's existing Neo4j vector infrastructure instead of adding a new embedding provider. The backend already defines `entity_embeddings` over `Entity.embedding`; the Explorer now capability-detects that configured online index with read-only `SHOW INDEXES`.
- Added selected-item semantic seeds: up to three indexed entities reachable within two hops of the selected source/node can supply their existing embeddings directly to `db.index.vector.queryNodes`.
- Nearest entities are expanded back to bounded graph/source evidence and merged ahead of the existing lexical results. Hybrid merge is semantic-first, de-duplicates by result identity, and remains bounded.
- Manual selected GRAPH questions and routed GRAPH follow-ups now use `hybridSearchGraph`; router graph follow-ups continue to share one bounded retrieval.
- Added explicit retrieval provenance: `hybrid`, `lexical`, or `lexical_fallback`, plus vector index/label/property, seed count, semantic candidate count, and fallback reason. Jev source context and the Explorer expose this provenance.
- No vector/index mutation was added to the frontend path. If the configured vector index is missing/offline, no reachable embedded entity exists, or the vector query fails, current lexical retrieval is preserved rather than failing the judgment.
- Added `frontend/lib/semanticHybrid.ts` plus `frontend/scripts/verify-semantic-retrieval.cjs` and `npm run test:semantic`.
- CI caught and fixed two issues before merge: the first hybrid merge implementation allowed a later lexical duplicate to overwrite a semantic result; the semantic contract exposed this and the merge was changed to semantic-first first-win. Strict TypeScript then exposed an invalid type predicate in the semantic result pipeline; it was replaced with an explicit typed `flatMap`.
- Verification run `36106415028` passed: catalog contract ✓, router contract ✓, semantic retrieval contract ✓, strict TypeScript ✓, Next.js production build ✓, backend tests ✓.
- Live ZimaOS `entity_embeddings` availability/population was not verified in this pass and is not claimed. Runtime fallback metadata makes that limitation visible instead of silent.
- Still deferred under Issue #4: deterministic extraction/enrichment, routing across multiple sources, generalized proposal kinds, longitudinal/GitGraph UI, and the separately governed canonical promotion/write path.
