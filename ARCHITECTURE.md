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
3. The route imports `frontend/lib/sigmaNeo4j.ts`, which is server-only in practice because it imports `node:path`, `dotenv`, and `neo4j-driver`.
4. The adapter loads `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optional `NEO4J_DATABASE` from the existing environment.
5. Graph queries run through a Neo4j read session. Custom Cypher is checked for mutation clauses.
6. `graphology-neo4j` `cypherToGraph` converts result records containing Neo4j nodes and relationships into a Graphology graph.
7. The adapter serializes nodes (`id`, labels, properties) and relationships (`id`, source, target, type).
8. The browser builds a directed multi-graph and Sigma renders arrows, labels, filters, selection, and focus.

## Routes

| Route | Purpose |
|---|---|
| `/sigma-explorer` | Bounded Sigma.js visual explorer |
| `/modeling` | Modeling/architecture/schema tab |
| `GET /api/explorer/graph` | Default bounded graph or custom read-only Cypher via `query` |
| `GET /api/explorer/search` | Case-sensitive property substring search, bounded |
| `GET /api/explorer/expand` | Immediate neighbors for one Neo4j internal node id |

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
