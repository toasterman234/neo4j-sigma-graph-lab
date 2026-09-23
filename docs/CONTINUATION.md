# Continuation Guide

## What exists

Neo4j Sigma Graph Lab has two surfaces:

- **Explorer** (`/sigma-explorer`) loads a bounded real subgraph, searches node properties, focuses a selected node, inspects labels/properties, expands neighbors, filters labels and relationship types, and runs custom read-only Cypher.
- **Modeling** (`/modeling`) explains the source graph, adapter boundary, observed schema, safe query patterns, and continuation contract.

The existing generated Context Graph app remains available at `/` and is not replaced by the lab.

## Safe next changes

Good candidates:

- Add a read-only schema statistics endpoint and charts.
- Add a query history panel stored only in browser local state.
- Add a server-side allowlist of approved query templates.
- Add a read-only document/source preview for Vault chunks.
- Add Playwright coverage for the explorer controls.
- Replace the peer-dependency workaround only after testing the chosen versions.

Avoid:

- loading the entire graph by default;
- putting Neo4j credentials in `NEXT_PUBLIC_*` variables;
- making the browser connect directly to Bolt;
- adding write Cypher to the explorer routes;
- calling generated seed/reset paths for demo data;
- treating internal Neo4j ids as durable business identifiers.

## Development commands

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000/sigma-explorer` or `http://localhost:3000/modeling`.

For a production-like run:

```bash
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

Backend checks:

```bash
cd backend
uv run pytest tests/ -q
```

## Handoff checklist

- [ ] Read `AGENTS.md`, `ARCHITECTURE.md`, and `README.md`.
- [ ] Check `git status` before editing.
- [ ] Confirm the existing `.env` is present but ignored.
- [ ] Confirm `/health` reports Neo4j connected.
- [ ] Run a bounded graph request and inspect counts.
- [ ] Test search and expansion against real data.
- [ ] Test a mutation query is rejected.
- [ ] Run TypeScript, frontend build, and backend tests.
- [ ] Report limitations and anything not validated.
