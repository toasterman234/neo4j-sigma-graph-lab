# Findings

- Existing scaffold already connects to ZimaOS Neo4j via backend `neo4j-driver`/async driver and `.env`.
- Existing `/api/cypher` is intentionally generic and is not sufficient as the explorer contract because it returns arbitrary records and accepts writes at the route boundary.
- Existing graph has approximately 9,732 nodes, with labels including Entity, Chunk, DocumentId, Project, Task, Decision, System, Process, Service, Platform, and others.
- Existing frontend uses Neo4j NVL, not Sigma.js/Graphology.
- Explorer should be a separate route and component to avoid replacing current work.
- Neo4j data must remain untouched; no seed/reset/write operations are allowed.
- The explorer had no persistence for search or Jev results; only unrelated chat history uses sessionStorage.
- Local `better-sqlite3` works with the current Node 26 runtime and Next.js Node route handlers.
- Persistence verification succeeded across a server restart using `RESULTS_DB_PATH=/tmp/graph-lab-save-test.sqlite`; one saved Jev-shaped result was recovered after restart.
- SQLite stores explicit saved Jev results only: query, scope/mode, bounded counts, judgment, confidence, evidence, and provisional suggestions. The local database is ignored by Git.
