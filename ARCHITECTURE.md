# Architecture

## System boundary

Neo4j is the source of truth. Neo4j Sigma Graph Lab is an observation and exploration surface only:

```text
Existing Neo4j (ZimaOS)
        │ Bolt, read-only
        ▼
Next.js server routes
        │ bounded JSON
        ▼
Browser: Graphology graph + Sigma.js renderer
```

The original generated Context Graph backend remains in `backend/`. The Sigma explorer is implemented in the Next.js server because this keeps Neo4j credentials out of the browser and avoids coupling the new viewer to generated/demo-memory behavior.

## Request flow

1. The browser opens `/sigma-explorer`.
2. `SigmaNeo4jExplorer` calls `/api/explorer/graph`, `/api/explorer/search`, or `/api/explorer/expand`.
3. Search requests use bounded scope/mode retrieval in `frontend/lib/sigmaNeo4j.ts`; they never send the full graph to the browser or Jev.
4. The route imports `frontend/lib/sigmaNeo4j.ts`, which is server-only in practice because it imports `node:path`, `dotenv`, and `neo4j-driver`.
5. The adapter loads `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optional `NEO4J_DATABASE` from the existing environment.
6. Graph queries run through a Neo4j read session. Custom Cypher is checked for mutation clauses.
7. `graphology-neo4j` `cypherToGraph` converts result records containing Neo4j nodes and relationships into a Graphology graph.
8. The adapter serializes nodes (`id`, labels, properties) and relationships (`id`, source, target, type`).
9. The browser groups Chunk nodes into logical Document/Source nodes in a presentation-only semantic adapter, then builds a directed multi-graph and Sigma renders arrows, labels, filters, selection, and focus.
10. Whole-graph reasoning posts only the bounded search result context to `/api/jev/run`; `frontend/lib/jev.ts` further caps the Jev state to 24 nodes and 40 relationships before invoking the server-side Jev evaluator.

## Routes

| Route | Purpose |
|---|---|
| `/sigma-explorer` | Bounded Sigma.js visual explorer |
| `/modeling` | Modeling/architecture/schema tab |
| `GET /api/explorer/graph` | Default bounded graph or custom read-only Cypher via `query` |
| `GET /api/explorer/search` | Bounded whole/selected/neighborhood search across keyword, property, document, and relationship modes |
| `POST /api/jev/run` | Retrieves a bounded search context server-side, then asks Jev typed questions; returns judgments, probabilities/confidence, evidence, and provisional relationship suggestions |
| `GET /api/results` | Lists saved Jev result summaries from local SQLite |
| `POST /api/results` | Saves one explicit Jev result and its bounded evidence to local SQLite |
| `GET /api/explorer/expand` | Immediate neighbors for one Neo4j internal node id |

## Document/Source presentation layer

The API continues to return the underlying bounded node/relationship payload. Before rendering, `frontend/lib/documentSource.ts` groups Chunk nodes sharing a source URI/path into one logical `Document`/`Source` node. It derives a filename, relative path, source type, and explicit provenance dates, reconstructs readable content from ordered chunk text, and associates connected semantic nodes such as projects, decisions, systems, processes, services, and tasks.

The inspector presents that semantic source view by default. Individual chunk properties remain available through the raw evidence toggle and expansion flow. Missing original creation metadata is shown as `Unknown`; S3 `LastModified` or ingestion values are not relabeled as document creation dates. This is browser-side presentation logic only and does not mutate Neo4j.

## Graph contract

The visual API uses:

```ts
type NodePayload = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};

type EdgePayload = {
  id: string;
  source: string;
  target: string;
  type: string;
};
```

The default view is intentionally limited. The database has thousands of nodes, so the UI should remain focused and expand on demand rather than load the whole graph.

## Whole-graph retrieval and Jev reasoning

Search scopes are `whole`, `selected`, and `neighborhood`; modes are `keyword`, `property`, `document`, and `relationship`. Retrieval is capped at 80 results and 120 graph nodes. Search results are grouped into source/document, semantic node, and relationship results in the UI.

The explorer presents Jev output as typed answer cards rather than raw JSON: `noul`/boolean probabilities use meters, `choice` answers show candidate distributions, and `score` answers show the numeric score. Results are labeled `Provider response` / `Unverified decision` or `Saved`, and the UI preserves unknown/error states through the request status. Scope, mode, and Jev focus use explicit button groups with tooltips; saved result cards reopen the full judgment and evidence context.

`POST /api/jev/run` repeats the bounded retrieval server-side, selects only result-linked nodes, limits Jev input to 24 nodes and 40 relationships, truncates evidence excerpts, and includes an explicit untrusted-evidence policy. Jev returns typed judgments rather than prose. The application displays result excerpts and any candidate relationship as provisional. No endpoint in this feature mutates Neo4j.

Explicitly saved Jev results are stored by `frontend/lib/resultStore.ts` in `.data/graph-lab.sqlite` using SQLite. The database is local, ignored by Git, capped at 100 saved runs, and stores the query, search scope/mode, typed judgment, confidence, bounded evidence, and provisional suggestions. It does not store Neo4j credentials or write back to Neo4j.

## Read-only controls

- Neo4j sessions use `defaultAccessMode: neo4j.session.READ` for search/expansion.
- All adapter queries pass through `assertReadOnly`.
- Mutation keywords including `CREATE`, `MERGE`, `DELETE`, `SET`, `REMOVE`, `DROP`, `LOAD CSV`, and privilege operations are rejected.
- Result limits are clamped server-side.
- No seed/reset/migration code belongs in the explorer path.

This is defense in depth, not a database permission substitute. The configured Neo4j user should also have read-only permissions when this is deployed beyond local development.

## Live data shape

The connected graph includes labels such as `Chunk`, `DocumentId`, `Entity`, `SemanticEntity`, `Project`, `Task`, `Decision`, `Process`, `System`, `Service`, and `Platform`. Relationship types observed include `CONTAINS`, `EVIDENCED_BY`, `FOLLOWED_BY`, `FROM`, `HAS_DECISION`, `HAS_OPTION`, `HOSTED_ON`, `INTEGRATES`, `IN_STATE`, `RELATED_TO`, `SUPPORTED_ON`, and `USES`.

Vault lineage is primarily visible on `Chunk` nodes through properties such as `metadata_x-amz-bedrock-kb-source-uri`, `metadata`, and `text`.

## Known dependency limitation

`graphology-neo4j@1.2.0` declares a peer range for Neo4j driver 4.x, while this project already uses `neo4j-driver` 6.x. npm installation currently uses `--legacy-peer-deps`. The adapter has been verified against the live driver for this read-only workload. Do not silently upgrade/downgrade the existing driver; test any dependency change separately.
