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
- A fix to upstream's code is made here, then checked against `upstream/main` and upstream's issues, since the fork runs releases behind and the fix may already be there (2026-10-29: the test-data-root leak was fixed upstream in #5137, already in 1.37). If it isn't, draft it for upstream: a bug fix goes straight to a PR off `upstream/main` (their CONTRIBUTING allows it), and a feature or architecture change goes to an issue first. Opening either is outward-facing, so ask Kaito first. The review marks the edit `adopted` once a release carries it, and then the fork's version can go.
- When `shukatsu/` starts importing or running another engine file, declare it in `shukatsu/core/seam.mjs` and give it a behaviour test in `shukatsu/tests/seam.spec.mjs`. The first test there fails until you do.

## Keeping it public-safe

- This repo is public. Nothing from the data root goes in it: no names, emails, phones, or LinkedIn of the candidate or anyone else, no employer or company they track or target, and no real posting, mail, board page, or recruiter. Fixtures and examples use made-up ones (Acme, Globex, Initech, Sam Candidate), and real pages kept for the board readers stay in the data root.
- `node shukatsu/leak-check.mjs` checks the fork's files against the data root's own words, `--staged` is the pre-commit hook (install it once per clone; the line is in the script's header), and `--history` checks every commit the fork made. When it fires, change the text. Phrases it may let through live in the data root's `config/leak-check.yml`, never here.
