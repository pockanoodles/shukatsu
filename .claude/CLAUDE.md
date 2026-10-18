# Shukatsu fork rules

This repo is Shukatsu, a fork of career-ops. The root `AGENTS.md` and `CLAUDE.md` are upstream's and arrive with every release; these rules are the fork's own and win where they differ.

## Taking career-ops releases

- **Never run `node update-system.mjs apply`.** It copies files instead of merging, so a file the fork edits stops receiving upstream changes and git loses track of what was merged. This overrides AGENTS.md's Update Check: `node update-system.mjs check` still runs and `dismiss` still works, but when it reports `update-available`, offer a review instead of apply:
  > "career-ops v{remote} is out. Want me to review it for Shukatsu?"
- **Review, then merge, one release at a time.** `node shukatsu/upstream.mjs review` reports the seam (engine code the app depends on), added egress, agent-instruction changes, and the fork's carried edits. Summarize those four for Kaito. On his yes, `node shukatsu/upstream.mjs merge` merges the tag on `update/<version>` without committing. Take every release as it comes, since a small merge is cheaper than a large one.
- **Gate before `main`:** hand-resolve what merge lists, `npm ci`, then `npm test` in `shukatsu/` must pass and `CAREER_OPS_DATA_DIR=$PWD node test-all.mjs` must show no failure that `main` doesn't already have. (Pin the data root: without it, upstream's tests follow `.career-ops-data` into the real data root.) `main` carried 17 upstream-suite failures on 2026-10-17, from the fork's README, two fork files breaking upstream conventions, and the 1.36 file copy; getting it to zero is part of the first merge. Add a DATAFLOW.md row for any egress the review flagged that the doc doesn't already cover, then commit and fast-forward `main`.
- **An urgent upstream fix between releases:** `node shukatsu/upstream.mjs pick <sha>`.

## Keeping the fork small

- New fork work goes in `shukatsu/`, `site/`, `modes/shukatsu/` or `modes/shinsotsu/`, never in upstream's files. A new fork-owned path outside those goes in `config/local-paths.txt`.
- A fix to upstream's code is made here and drafted as an upstream issue (career-ops wants an issue before a PR). Opening it is outward-facing, so ask Kaito first. The review marks the edit `adopted` once a release carries it, and then the fork's version can go.
- When `shukatsu/` starts importing or running another engine file, declare it in `shukatsu/core/seam.mjs` and give it a behaviour test in `shukatsu/tests/seam.spec.mjs`. The first test there fails until you do.
