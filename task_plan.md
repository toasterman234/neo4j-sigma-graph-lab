# Neo4j Sigma Graph Lab Plan

## Goal
Package a read-only Sigma.js/Graphology explorer for the existing ZimaOS Neo4j database, with human-readable source inspection and bounded whole-graph retrieval followed by server-side Jev reasoning.

## Current Phase
- Phase 8: Jev result presentation

## Phases

### Phase 1: Inspect existing project and connection
- [x] Confirm existing project structure and routes.
- [x] Confirm existing Neo4j connection/config and live health.
- [x] Avoid duplicating or overwriting the existing Context Graph functionality.

### Phase 2: Explorer implementation
- [x] Add Sigma.js, Graphology, graphology-neo4j, and existing neo4j-driver integration.
- [x] Add bounded graph, search, expansion, and read-only custom Cypher APIs.
- [x] Add read-only safety checks and server-side credentials.

### Phase 3: Modeling tab
- [x] Add Explorer/Modeling navigation.
- [x] Add Modeling workspace with architecture, live schema, query patterns, source lineage, and handoff guidance.

### Phase 4: Repository handoff
- [x] Add repository-level README, AGENTS.md, ARCHITECTURE.md, and continuation guide.
- [x] Harden `.gitignore` against secrets and generated artifacts.
- [x] Initialize nested Git repository and create initial commit.
- [x] Create GitHub repository `neo4j-sigma-graph-lab` and push.

### Phase 5: Verification
- [x] Run frontend type check and production build.
- [x] Run backend tests via `uv run python -m pytest tests/ -q`.
- [x] Verify Document/Source presentation code compiles and raw evidence behavior is wired.
- [x] Verify live graph/search behavior and underlying source metadata shape; expansion/custom-query/mutation rejection remain covered by existing implementation but were not re-run here.
- [x] Verify repository status and pushed remote.

### Phase 6: Whole-graph retrieval and Jev reasoning
- [x] Add bounded search scopes and modes for nodes, sources, relationships, and local paths.
- [x] Add server-side Jev adapter and `/api/jev/run` route that retrieves context server-side.
- [x] Add grouped search UI, graph focus, and Reason with Jev output panel.
- [x] Keep proposed relationships provisional and preserve read-only Neo4j boundary.
- [x] Verify search, Jev call, caps, and mutation protections.
- **Status:** complete

### Phase 7: Persisted Jev results
- [x] Add local SQLite store for saved Jev judgments and bounded evidence.
- [x] Add save/list API routes and saved-results UI.
- [x] Keep SQLite local/ignored and Neo4j read-only.
- [x] Verify persistence across server restart, size limits, typecheck, build, and tests.
- **Status:** complete

### Phase 8: Jev result presentation
- [x] Replace raw Jev JSON with typed answer cards, distributions, meters, and provenance.
- [x] Improve search scope/mode/question controls with explicit button groups.
- [x] Make saved results reopenable and distinguish saved/provider states.
- [x] Add evidence and provisional relationship presentation improvements.
- [x] Verify typecheck, build, saved-result reopening, and read-only protections.
- **Status:** complete

## Decisions
- Issue #1 uses a read-only presentation-layer adapter: Chunk nodes sharing source identity are grouped into logical Document/Source nodes without changing Neo4j data.
- Source creation dates are shown only when explicit metadata exists; storage/ingestion values are not relabeled as original creation dates.
- Display name: **Neo4j Sigma Graph Lab**.
- GitHub slug: **neo4j-sigma-graph-lab**.
- Keep the original generated Context Graph app and backend intact.
- Use a separate Next.js server-side adapter for the explorer.
- Neo4j remains read-only and credentials remain server-side.
- Whole-graph retrieval is bounded before Jev; the full graph is never sent to Jev.
- Jev receives typed decision questions over a compact evidence package, while evidence excerpts and provisional relationship suggestions are assembled by the application.
- Saved results use local SQLite and are explicit user saves; no graph data or Jev result is written to Neo4j.

## Errors
| Attempt | Error | Resolution |
|---|---|---|
| 1 | `npx tsc --noEmit` used an unavailable global placeholder because dependencies were not installed. | Installed frontend dependencies with `npm install --legacy-peer-deps --ignore-scripts`; type check then passed. |
| 2 | `uv run pytest tests/ -q` collected with `ModuleNotFoundError: neo4j` despite the package being present in `.venv`. | Confirmed `uv run python` imports `neo4j` and `app.context_graph_client` directly; test collection remains unresolved and is not claimed passing. |
| 3 | `npm run lint` failed because the repository has no ESLint 9 flat config. | TypeScript and production build remain the applicable passing frontend checks; lint is not claimed passing. |
| 4 | `uv run pytest tests/ -q` used an incompatible pytest executable/interpreter and reported `neo4j` missing; `uv run python -m pytest` initially lacked pytest. | Installed the dev test packages in the temporary worktree environment and ran `uv run python -m pytest tests/ -q`: 4 passed. |
