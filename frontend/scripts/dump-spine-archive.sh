#!/bin/bash
# dump-spine-archive.sh — READ-ONLY extracts of spine_archive's work_items,
# decisions, artifacts, documents into /tmp/spine-dump/*.json
# (spine_ro role; long text capped at 60k like the other projection ingests).
set -euo pipefail
PSQL=/opt/homebrew/opt/postgresql@18/bin/psql
OUT=/tmp/spine-dump
mkdir -p "$OUT"
q() { "$PSQL" -d spine_archive -U spine_ro -X -q -t -A -c "$1"; }
TABLE="${1:-all}"
if [ "$TABLE" = "all" ] || [ "$TABLE" = "work_items" ]; then
q "SELECT COALESCE(json_agg(t),'[]'::json) FROM (
     SELECT id, title,
            LEFT(COALESCE(description,''),60000) AS text,
            (LENGTH(COALESCE(description,''))>60000) AS truncated,
            status, priority, project_id, phase_id, parent_work_item_id,
            claimed_by, created_at, updated_at, started_at, completed_at,
            dispatched_at, metadata
     FROM work_items ORDER BY created_at) t" > "$OUT/work_items.json"
fi
if [ "$TABLE" = "all" ] || [ "$TABLE" = "decisions" ]; then
q "SELECT COALESCE(json_agg(t),'[]'::json) FROM (
     SELECT id, title,
            LEFT(COALESCE(decision,''),60000) AS text,
            LEFT(COALESCE(rationale,''),60000) AS rationale,
            LEFT(COALESCE(consequence,''),60000) AS consequence,
            status, ref, project_id, phase_id, supersedes_id, source_ref,
            created_by, decided_at, created_at, metadata
     FROM decisions ORDER BY created_at) t" > "$OUT/decisions.json"
fi
if [ "$TABLE" = "all" ] || [ "$TABLE" = "artifacts" ]; then
q "SELECT COALESCE(json_agg(t),'[]'::json) FROM (
     SELECT id, title,
            LEFT(COALESCE(summary,''),60000) AS text,
            kind, ref, work_item_id, project_id, created_by, created_at, metadata
     FROM artifacts ORDER BY created_at) t" > "$OUT/artifacts.json"
fi
if [ "$TABLE" = "all" ] || [ "$TABLE" = "documents" ]; then
q "SELECT COALESCE(json_agg(t),'[]'::json) FROM (
     SELECT repo, path, area, format,
            LEFT(COALESCE(body,''),60000) AS text,
            (LENGTH(COALESCE(body,''))>60000) AS truncated,
            frontmatter, sha256, bytes, first_seen_at, last_changed_at
     FROM documents ORDER BY repo, path) t" > "$OUT/documents.json"
fi
echo "dump done:"; wc -c "$OUT"/*.json
