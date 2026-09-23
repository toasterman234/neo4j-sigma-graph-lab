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

## 2026-09-23 — GitHub update
- Prepared the pending implementation changes for `origin/main` at `toasterman234/neo4j-sigma-graph-lab`.
- Final verification before publish: frontend typecheck/build passed, backend tests passed, SQLite restart/size-limit checks passed, and `git diff --check` passed.
- Commit and push are the remaining publication actions.
