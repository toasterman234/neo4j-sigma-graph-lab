# Neo4j Sigma Graph Lab - Agent Guide

## Mission
This repository is a read-only visual lab for exploring the existing ZimaOS Neo4j database. It is deliberately separate from the database's ownership and does not seed, migrate, reset, delete, or write Neo4j data.

## Start here
1. Read `README.md` for setup and operator behavior.
2. Read `ARCHITECTURE.md` for the server/client boundary and data flow.
3. Read `docs/CONTINUATION.md` before making non-trivial changes.
4. Inspect `git status` and preserve unrelated work.
5. Use the existing `backend/.env` or project `.env` connection configuration. Never create a replacement database.

## Hard safety rules
- Neo4j is read-only for this project.
- Never run `make seed`, reset scripts, migration scripts, or write Cypher.
- Never log or commit `.env`, passwords, tokens, `node_modules`, `.next`, or virtual environments.
- Keep Neo4j credentials server-side. Browser code may only receive bounded, serialized graph data.
- Preserve query limits: initial graph max 500 nodes, search max 100 results, expansion max 250 results.
- Custom Cypher must remain mutation-rejected and use a read session.

## Architecture
- `frontend/app/sigma-explorer/page.tsx`: Explorer route.
- `frontend/app/modeling/page.tsx`: Modeling route/tab.
- `frontend/components/SigmaNeo4jExplorer.tsx`: Sigma.js UI and Graphology graph lifecycle.
- `frontend/components/ModelingWorkspace.tsx`: schema/architecture modeling surface.
- `frontend/lib/sigmaNeo4j.ts`: server-only adapter. Reads `.env`, creates `neo4j-driver`, validates Cypher, calls `graphology-neo4j` `cypherToGraph`, and serializes results.
- `frontend/app/api/explorer/*`: server API routes for graph load, search, and expansion.
- Existing `backend/`: original generated Context Graph backend. Keep it working; do not replace it with the explorer API.

## Verification before claiming completion
Run:

```bash
cd frontend
npx tsc --noEmit
npm run build
cd ../backend
uv run pytest tests/ -q
```

Then verify the live services:

```bash
curl -fsS http://localhost:8000/health
curl -fsS 'http://localhost:3000/api/explorer/graph?limit=200'
curl -fsS 'http://localhost:3000/api/explorer/search?q=Process&limit=5'
```

Report what was checked and what was not checked.
