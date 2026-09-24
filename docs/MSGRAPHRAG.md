# MsGraphRAG Communities in the Graph Lab

The `/communities` tab browses the full-corpus MsGraphRAG run (2026-09-24):
2,078 clean communities, 2,031 with Nova Lite summaries, 4,213 canonical
entities, 7,556 relationships. Production Neo4j was never touched; this reads
from the isolated `msgraphrag-full` container on the ZimaOS box.

## Connection

Second Neo4j connection, server-side only. Credentials live in the repo-root
`.env` (gitignored, never committed) and are only read by server code:

- `MSGRAPHRAG_NEO4J_URI` (bolt://192.168.1.121:17690 from the Mac mini)
- `MSGRAPHRAG_NEO4J_USERNAME`
- `MSGRAPHRAG_NEO4J_PASSWORD`

The browser never sees credentials; API routes return bounded, serialized
payloads only.

## Schema (isolated container)

- `__Community__` nodes: `id`, `level` (0-3), `title`, `summary` (prose),
  `findings` (JSON string: `[{summary, explanation}]`), `rating`,
  `rating_explanation`
- `__Entity__` + canonical type label (`Project`, `System`, `Person`, …):
  `name`, `description`
- `(:__Entity__)-[:IN_COMMUNITY]->(:__Community__)` membership
- `(:__Community__)-[:IN_COMMUNITY]->(:__Community__)` parent links
- `(:__Entity__)-[:RELATIONSHIP|SUMMARIZED_RELATIONSHIP]->(:__Entity__)`

## Code

- `frontend/lib/msgraphrag.ts` — second driver + read-only query helpers.
  All Cypher passes a read-only assertion; sessions are READ; 15s timeout.
- `frontend/app/api/msgraphrag/communities/route.ts` — `GET ?q&level&limit&offset&summarized=1`
- `frontend/app/api/msgraphrag/communities/[id]/route.ts` — full detail
  (summary, parsed findings, parent/children, member entities)
- `frontend/app/api/msgraphrag/communities/[id]/graph/route.ts` — Sigma
  payload: community node + member entities + intra-community edges
  (bounded: 160 nodes)
- `frontend/app/communities/page.tsx` — search, level chips, summarized
  toggle, paginated list, detail pane
- `frontend/components/CommunityGraph.tsx` — Sigma subgraph (dynamic import,
  client-only)

## Limits

- List: max 100 rows per request (UI pages 20)
- Community graph: max 160 entity nodes, 2,000 edges
- Detail: member entities capped at 60 in the payload
