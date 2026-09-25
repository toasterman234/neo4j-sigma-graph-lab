#!/usr/bin/env python3
"""Mac-side Jev client via the direct TypeSafe key (added 2026-09-25).

Same stdin/stdout contract as ~/.codex-internal/skills/jev/bin/jev-evaluate.py:
reads {"model"?, "state", "questions"} from stdin, prints the Jev result JSON
{"answers": {...}, "providerMetadata": {"typesafe": {"confidence": {...}}}}.

Instead of the reverse tunnel to Astro's VM (Vercel AI Gateway, budget
exhausted), it POSTs to the local jev-mermaid evaluator's /evaluate-set
endpoint (127.0.0.1:4174), which already holds the direct TypeSafe key.
The key never leaves the Mac and this script never sees it. Stdlib only.

Wired into the sigma graph lab via JEV_EVALUATE_SCRIPT in the launchd plist.
"""
import json
import os
import sys
import urllib.error
import urllib.request

EVALUATOR_URL = os.environ.get(
    "JEV_DIRECT_EVALUATOR_URL", "http://127.0.0.1:4174/evaluate-set"
)
TIMEOUT_S = 150


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write("jev-direct: invalid JSON on stdin: %s\n" % e)
        return 2
    state = payload.get("state")
    questions = payload.get("questions") or {}
    if not isinstance(state, str) or not state.strip():
        sys.stderr.write("jev-direct: state is required\n")
        return 2
    if not isinstance(questions, dict) or not questions:
        sys.stderr.write("jev-direct: at least one question is required\n")
        return 2
    body = json.dumps({"state": state, "questions": questions}).encode("utf-8")
    req = urllib.request.Request(
        EVALUATOR_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        sys.stderr.write("jev-direct: evaluator HTTP %s: %s\n" % (e.code, detail))
        return 1
    except Exception as e:
        sys.stderr.write(
            "jev-direct: could not reach evaluator at %s: %s\n" % (EVALUATOR_URL, e)
        )
        return 1
    answers = data.get("answers")
    if not isinstance(answers, dict):
        sys.stderr.write("jev-direct: evaluator returned no answers\n")
        return 1
    confidence = {}
    for qid, ans in answers.items():
        if (
            isinstance(ans, dict)
            and ans.get("type") == "choice"
            and isinstance(ans.get("confidence"), (int, float))
        ):
            confidence[qid] = ans["confidence"]
    out = {"answers": answers}
    if confidence:
        out["providerMetadata"] = {"typesafe": {"confidence": confidence}}
    sys.stdout.write(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
