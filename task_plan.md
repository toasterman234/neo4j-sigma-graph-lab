# Neo4j Sigma Graph Lab Plan

## Goal
Package a read-only Sigma.js/Graphology explorer for the existing ZimaOS Neo4j database as a self-contained GitHub repository, add a Modeling tab, and leave a clear continuation contract for future agents.

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
- [ ] Create GitHub repository `neo4j-sigma-graph-lab` and push.

### Phase 5: Verification
- [x] Run frontend type check and production build.
- [x] Run backend tests.
- [x] Verify Modeling and Explorer routes.
- [x] Verify live graph/search/expansion/custom-query behavior and mutation rejection.
- [ ] Verify repository status and pushed remote.

## Decisions
- Display name: **Neo4j Sigma Graph Lab**.
- GitHub slug: **neo4j-sigma-graph-lab**.
- Keep the original generated Context Graph app and backend intact.
- Use a separate Next.js server-side adapter for the explorer.
- Neo4j remains read-only and credentials remain server-side.

## Errors
| Attempt | Error | Resolution |
|---|---|---|
