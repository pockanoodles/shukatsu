# shukatsu

The fork's own layer on top of career-ops: one master record of everything the candidate
has done, every resume a traced selection from it, and a review process that lets family
and mentors help without ever writing a claim the candidate didn't confirm.

Everything here is fork-owned (declared in `config/local-paths.txt`), so career-ops
updates never touch it.

```
shukatsu/
  core/          the engine: plain ESM, used by the CLIs and the app alike
  *.mjs          CLIs: master, review, people, digest, bullet-lint, audit-materials, char-count
  src/           the web app (Next.js 16, React 19, Tailwind 4)
  brand/         the palette and the shared Ledger parts, used by the app and the product page
  deploy/        running it on a home machine: services, tunnel, backups
  tests/         node:test suites (*.spec.mjs, run by `npm test` here, not upstream test-all)
```

The public product page, kaitosoeno.com/shukatsu, is built from `../site` (its own README).

## The model

- **One record.** `{DATA_ROOT}/data/career-profile.yml` holds every achievement as one
  fact with an ID, tags, provenance, and evidence. A fact counts only while it is active and
  verified. `cv.md` is generated from it.
- **Every resume is a selection.** `select` picks facts for an archetype and a posting
  inside the one-page budget and writes a draft whose every bullet declares its fact
  (`<!-- fact:id -->`). Rewording is free; `finalize` checks each bullet against the fact it
  declares (live, same figures, still the same claim), writes the clean `*.final.md`
  deliverable, and runs the bullet, fact, and materials gates on it.
- **Review.** Drafts in the record and changes proposed by people share one queue. Only the
  candidate decides, with four outcomes for anything carrying a figure: confirm, correct the
  figure (the candidate becomes its source, cited in `sources/review-log.md`), keep without
  figures, or "I don't know" (durable, never used). Every decision is a splice into the YAML
  (comments and formatting untouched), validated against both the fork's and upstream's
  schema, then committed to the data root's git history with who decided and who proposed.
- **Japanese applications.** A Japanese packet renders a 職務経歴書 from each fact's confirmed Japanese
  (tagged `<!-- fact:id/ja -->`, so a reworded line is held to that wording, counters included), the
  candidate's Japanese header (`candidate.ja`), and Japanese dates. The English bullet rules are
  replaced by a Japanese style gate (voice rules, one politeness register, no "co-op"), because
  upstream's fact gate can't count Japanese figures. Facts without confirmed Japanese are listed with
  a link to their review item, which is where a native-speaker parent helps most.
- **Written answers.** ES and form questions live on the packet, counted by grapheme the way forms
  count, held to their limit (and the 80% fill norm in Japanese), and figure-checked like bullets.
- **People.** The candidate is the owner. Editors prepare whole application packets and
  propose changes; reviewers comment and suggest postings; viewers follow along. There is no
  public sign-up: the owner is created from the command line, everyone else by invite link,
  with passwords (scrypt) and passkeys.

## Run it

```sh
cd shukatsu && npm install
npm run dev                                   # http://localhost:3000
node people.mjs init --name "Your Name"       # first run: prints the owner's setup link
npm test                                      # engine tests (fixture data root, never yours)
npm run build && npm start                    # production
```

The app finds the data root the same way every career-ops tool does: `CAREER_OPS_DATA_DIR`,
else the `.career-ops-data` marker in the repo root. The engine is loaded at runtime from the
checkout (never bundled), so the app runs exactly the code the CLIs run. Restart the server
after changing anything under `core/`.

## CLIs

| Command | Does |
|---|---|
| `node shukatsu/master.mjs validate \| pending \| render \| select \| finalize \| trace \| sent \| used` | The master record (see its header) |
| `node shukatsu/review.mjs [show\|accept\|narrative\|unsure\|reject\|reopen\|decided] <key>` | The review queue from the terminal |
| `node shukatsu/people.mjs init \| invite \| reset \| list \| disable` | Who can use this install |
| `node shukatsu/digest.mjs [--lang ja] [--days 14]` | The weekly digest as text for LINE or email |
| `node shukatsu/bullet-lint.mjs`, `audit-materials.mjs`, `char-count.mjs` | The writing gates |

## Pages

| Page | For |
|---|---|
| `/` | The landing page (public; shows an example record, never the real one) |
| `/today` | What's waiting: the stamp count for the candidate, ways to help for everyone else |
| `/review` | The queue. J/K to move, A confirm, E edit, U unsure, R reject |
| `/record` | The master record as a ledger; reword, add, retire (proposed, or direct for the owner) |
| `/applications` | The tracker, its status history, the pipeline inbox, and suggesting a posting |
| `/packets` | Application packets in English or Japanese: JD, traced CV (or 職務経歴書), written answers counted to their limits, check, cover letter, review, sent |
| `/digest` | The week, with copy-ready text in Japanese or English |
| `/people`, `/settings`, `/activity` | Access, account and passkeys, the full log |

Data handling: `DATAFLOW.md`. Running it at home: `deploy/README.md`.
