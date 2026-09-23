# Neo4j Sigma Graph Lab

A focused, read-only Sigma.js visual explorer and modeling surface for an existing Neo4j graph.

## Why this repo exists

This project provides a safe visual lens over the existing ZimaOS Neo4j instance. Neo4j remains the source of truth and is never seeded, migrated, reset, deleted from, or written to by the explorer.

The repository also contains the original generated Context Graph app under `backend/` and the existing main UI at `/`. The new lab surfaces are separate:

- **Explorer:** `http://localhost:3000/sigma-explorer`
- **Modeling:** `http://localhost:3000/modeling`
- **Original app:** `http://localhost:3000/`

## Architecture at a glance

```text
Neo4j (existing ZimaOS instance, read-only)
        │
        ▼
Next.js server API → neo4j-driver → graphology-neo4j
        │
        ▼
Browser Graphology model → Sigma.js renderer
```

Read `AGENTS.md` before making changes, then `ARCHITECTURE.md` for the detailed boundary and `docs/CONTINUATION.md` for the handoff contract.

## Features

- bounded initial graph load, default 300 nodes and hard maximum 500;
- Sigma.js rendering with directed relationship arrows and relationship type labels;
- Graphology in-memory graph model;
- `graphology-neo4j` conversion from Neo4j query results;
- search over real node properties;
- click-to-inspect labels and properties;
- focus a selected node;
- expand selected-node neighbors on demand;
- hide/show node labels and relationship types;
- custom read-only Cypher visualization;
- Modeling tab with live schema notes, query patterns, source lineage, and continuation guidance.

## Existing Neo4j configuration

The server uses the existing project environment configuration. Keep credentials in the ignored `.env` file:

```dotenv
NEO4J_URI=bolt://zimaos:17687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=...
NEO4J_DATABASE=neo4j
```

Do not commit `.env` or expose these values through `NEXT_PUBLIC_*` variables. Do not create another Neo4j database for this project.

## Quick start

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Then open `http://localhost:3000/sigma-explorer`.

The original generated backend can be checked independently:

```bash
cd backend
uv run pytest tests/ -q
```

## API surface

| Endpoint | Behavior |
|---|---|
| `GET /api/explorer/graph?limit=300` | Bounded real graph using `MATCH (n)-[r]-(m)` |
| `GET /api/explorer/graph?query=...&limit=300` | Custom read-only Cypher; return Neo4j nodes/relationships for visualization |
| `GET /api/explorer/search?q=...&limit=40` | Bounded property substring search |
| `GET /api/explorer/expand?nodeId=...&limit=120` | Bounded immediate neighbor expansion |

Custom queries are checked for mutation clauses and all numeric limits are clamped server-side. This is application-level defense in depth; use a Neo4j account with read-only permissions as well.

## Verification

The live integration has been verified with:

- backend health reporting `neo4j: true`;
- real bounded graph response: 93 nodes and 100 relationships;
- real search results for `Process`;
- real node expansion: 10 nodes and 9 relationships;
- real custom `Project` query;
- mutation query rejection with HTTP 400;
- frontend TypeScript check and production build;
- backend test suite: 4 passed.

Run the current checks yourself before claiming a change is complete:

```bash
cd frontend
npx tsc --noEmit
npm run build
cd ../backend
uv run pytest tests/ -q
```

## Dependency note

`graphology-neo4j@1.2.0` declares a Neo4j driver 4.x peer range while this existing project uses driver 6.x. The install therefore uses npm's `--legacy-peer-deps`. The adapter works with the live driver for this read-only path. See `ARCHITECTURE.md` for details.

## Repository layout

```text
AGENTS.md                         Agent operating guide
ARCHITECTURE.md                   System and data-flow design
docs/CONTINUATION.md              Future-agent handoff guide
frontend/app/sigma-explorer       Sigma explorer route
frontend/app/modeling              Modeling route
frontend/components/               UI components
frontend/lib/sigmaNeo4j.ts         Server-side Neo4j/Graphology adapter
frontend/app/api/explorer/         Read-only API routes
backend/                           Existing generated Context Graph backend
cypher/                            Existing generated Cypher assets
data/                              Existing generated fixtures and ontology
```
