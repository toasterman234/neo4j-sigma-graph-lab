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
10. Jev reasoning posts a catalog question id plus bounded context to `/api/jev/run`. ITEM questions read only the selected node/chunks through `selectedItemContext`; GRAPH questions use the existing bounded search pipeline. `frontend/lib/questions/runner.ts` caps Jev state to 24 nodes and 40 relationships before invoking the generic server-side adapter in `frontend/lib/jev.ts`.

## Routes

| Route | Purpose |
|---|---|
| `/sigma-explorer` | Bounded Sigma.js visual explorer |
| `/modeling` | Modeling/architecture/schema tab |
| `GET /api/explorer/graph` | Default bounded graph or custom read-only Cypher via `query` |
| `GET /api/explorer/search` | Bounded whole/selected/neighborhood search across keyword, property, document, and relationship modes |
| `POST /api/jev/run` | Resolves one versioned Question Catalog entry, obtains ITEM or GRAPH context server-side, then returns typed Jev judgments, confidence, evidence, source context, and provisional relationship suggestions |
| `POST /api/jev/route` | Runs one six-signal ITEM router pass for the selected object, deterministically plans up to four follow-ups, reuses at most one bounded graph retrieval, and returns routed judgments with trigger reasons |
| `GET /api/results` | Lists saved Jev result summaries from local SQLite |
| `POST /api/results` | Saves one explicit Jev result and its bounded evidence to local SQLite |
| `GET /api/explorer/expand` | Immediate neighbors for one Neo4j internal node id |
| `GET/POST/PATCH /api/modeling/proposals` | Lists, drafts, and records local schema proposal decisions |

## Document/Source presentation layer

The API continues to return the underlying bounded node/relationship payload. Before rendering, `frontend/lib/documentSource.ts` groups Chunk nodes sharing a source URI/path into one logical `Document`/`Source` node. It derives a filename, relative path, source type, and explicit provenance dates, reconstructs readable content from ordered chunk text, and associates connected semantic nodes such as projects, decisions, systems, processes, services, and tasks.

The inspector presents that semantic source view by default. Individual chunk properties remain available through the raw evidence toggle and expansion flow. Missing original creation metadata is shown as `Unknown`; S3 `LastModified` or ingestion values are not relabeled as document creation dates. Source content prefers readable `parentText` when it is available, with chunk text as a fallback. Vault paths are shortened to the human workspace path rather than showing the storage URI.

Semantic nodes are also adapted for display: values such as `x-amz-bedrock-kb-process run` become `Process Run` with the display category `Concept`; technical `Chunk`, `DocumentId`, and opaque `Entity` nodes are hidden or represented as `Document`/`Concept` only when a human name can be derived. Relationship labels are shown as readable phrases. Numeric Neo4j IDs, Neptune IDs, ingestion keys, and raw metadata remain behind the explicit technical-evidence control. This is browser/server presentation logic only and does not mutate Neo4j.

## Human-readable display contract

The primary explorer view is source-centric. A source card shows its filename, shortened workspace path, readable contents, source type, explicit created/modified/ingested dates, and connected named concepts. Dates remain `Unknown` when the source does not provide them. Search results use the same display adapter, so technical labels are not reintroduced by graph-wide search.

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

Explicitly saved Jev results are stored by `frontend/lib/resultStore.ts` in `.data/graph-lab.sqlite` using SQLite. The database is local, ignored by Git, capped at 100 saved runs, and stores the query, search scope/mode, versioned question metadata, selected/source context, typed judgment, confidence, bounded evidence, and provisional suggestions. The schema upgrade is additive and preserves legacy saved rows. It does not store Neo4j credentials or write back to Neo4j.

## Question Catalog and routed Jev reasoning

Question definitions live in `frontend/lib/questions/catalog.ts` and are versioned data rather than a fixed union inside the Jev adapter. Each definition declares an id, title, group, execution mode, output contract, evidence requirement, and optional proposal policy. The initial implemented modes are:

- **ITEM** — classify or judge only the currently selected document/source/node. The route resolves the selected logical document to its underlying Neo4j chunk ids and fetches only those nodes; it does not perform whole-graph retrieval.
- **GRAPH** — retrieve bounded candidates using the existing whole/selected/neighborhood scopes and keyword/property/document/relationship modes before asking Jev to compare or judge them.

`extraction`, `enrichment`, and `reflection` are reserved catalog modes but are intentionally rejected by the route until their own execution policies are implemented.

The initial catalog includes the existing missing-relationship, supersession, temporal-status, and evidence-alignment judgments plus object type, topic classification, actionability, related prior knowledge, automation candidate, eval candidate, and research candidate. Multi-label topic classification is compiled into independent typed boolean judgments; choice and boolean questions keep their native Jev output types.

`frontend/lib/questions/runner.ts` compiles a catalog definition into Jev questions, builds the bounded evidence state, applies the untrusted-evidence policy, invokes the generic `frontend/lib/jev.ts` adapter, and returns `questionMeta` and `sourceContext` with every result. Relationship proposals remain provisional and are only produced for catalog entries whose proposal policy explicitly allows them.

Saved Jev results retain question id/version/group/mode, source context, and an optional router trace in additive SQLite columns. Existing rows remain readable through legacy fallbacks. A catalog contract check in `frontend/scripts/verify-question-catalog.cjs` validates unique ids/versions, the required initial question set, ITEM/GRAPH routing expectations, and proposal-policy boundaries.

### Automatic router

`frontend/lib/questions/router.ts` runs one combined Jev pass over six router-only ITEM questions: object type, topics, intent, named-entity presence, actionability, and prior-knowledge dependency. Router-only definitions remain in the catalog for versioning/testability but are hidden from the manual question selector.

`frontend/lib/questions/routerPlan.ts` is deterministic and provider-independent. It converts the six signals into an explainable follow-up plan, deduplicates triggers, assigns priorities, and enforces a hard cap of four follow-ups. Current rules can trigger `related_prior_knowledge`, `supersession`, `temporal_status`, `research_candidate`, `automation_candidate`, and `eval_candidate`. Every routed result receives a `routing` trace containing router version, base question ids, trigger reasons, and the router signal snapshot.

The route reuses the selected-item context for ITEM follow-ups. If any triggered question needs GRAPH mode, it performs at most one bounded graph retrieval and reuses that context for all graph follow-ups. A user-entered graph query is used when present; otherwise the selected source/object title is the retrieval fallback. Individual follow-up failures are returned as errors without discarding successful siblings.

Named-entity presence is currently surfaced as a deferred signal rather than triggering unsupported extraction/enrichment. This phase also does **not** add semantic/vector candidate retrieval, routing across many selected sources, generalized proposal kinds, external enrichment, or a canonical Neo4j publish path. Those remain separate phases under Issue #4.

## Proposed schema modeling

The Modeling tab has a separate Proposed Schema view backed by `ModelingProposalWorkspace`. A lookup runs bounded server-side retrieval, sends only the bounded context to Jev, and stores reviewable node-type, observed relationship-pattern, and provisional relationship proposals in SQLite. The graph renders pending proposals in amber, accepted proposals in green, and deferred proposals in gray; rejected proposals are removed from the schema view. Each proposal retains evidence, rationale, confidence, and its current decision.

Accepting a proposal means "add to the local proposed schema graph" only. Decisions are recorded in `proposal_decisions` as an append-only decision history while `model_proposals` provides the current projection. There is intentionally no publish/write action in this feature, so the live Neo4j graph remains read-only.

## Read-only controls

- Neo4j sessions use `defaultAccessMode: neo4j.session.READ` for search/expansion.
- All adapter queries pass through `assertReadOnly`.
- Mutation keywords including `CREATE`, `MERGE`, `DELETE`, `SET`, `REMOVE`, `DROP`, `LOAD CSV`, and privilege operations are rejected.
- Result limits are clamped server-side.
- No seed/reset/migration code belongs in the explorer path.
- Proposal acceptance updates only local SQLite state and the browser's proposed schema graph.

This is defense in depth, not a database permission substitute. The configured Neo4j user should also have read-only permissions when this is deployed beyond local development.

## Live data shape

The connected graph includes labels such as `Chunk`, `DocumentId`, `Entity`, `SemanticEntity`, `Project`, `Task`, `Decision`, `Process`, `System`, `Service`, and `Platform`. Relationship types observed include `CONTAINS`, `EVIDENCED_BY`, `FOLLOWED_BY`, `FROM`, `HAS_DECISION`, `HAS_OPTION`, `HOSTED_ON`, `INTEGRATES`, `IN_STATE`, `RELATED_TO`, `SUPPORTED_ON`, and `USES`.

Vault lineage is primarily visible on `Chunk` nodes through properties such as `metadata_x-amz-bedrock-kb-source-uri`, `metadata`, and `text`.

## Known dependency limitation

`graphology-neo4j@1.2.0` declares a peer range for Neo4j driver 4.x, while this project already uses `neo4j-driver` 6.x. npm installation currently uses `--legacy-peer-deps`. The adapter has been verified against the live driver for this read-only workload. Do not silently upgrade/downgrade the existing driver; test any dependency change separately.
