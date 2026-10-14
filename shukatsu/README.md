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
npm run dev                                   # shukatsud with hot reload, http://localhost:3000
npm test                                      # engine tests (fixture data root, never yours)
npm run build && npm start                    # production
```

On a fresh install the first start prints a one-time link that creates the candidate's
account (`node people.mjs init --name "Your Name"` makes one too). Once the account exists the
daemon writes the owner's terminal token to `{DATA_ROOT}/.shukatsu/owner.token`, which is how
the CLIs reach it.

`shukatsud.mjs` is the whole system on one port: the app, `/api/v1` (every operation as
JSON), `/mcp` (agents), `/oauth` and `/.well-known` (remote MCP clients), `/cal` (private
calendar feeds), and `/connectors` (mail and calendar sign-in), plus connector sync once a
minute. Every one of them, and every server action in the app, goes through the operations
registry in `core/ops`. The design is `docs/specs/v1-headless.md`.

The app finds the data root the same way every career-ops tool does: `CAREER_OPS_DATA_DIR`,
else the `.career-ops-data` marker in the repo root. The engine is loaded at runtime from the
checkout (never bundled), so the app runs exactly the code the CLIs run. Restart the daemon
after changing anything under `core/`, `connectors/`, or `platforms/`.

### Agents

Name an agent on the Agents page (under your name, top right) and make it a key. Then:

```sh
claude mcp add --transport http shukatsu http://localhost:3000/mcp --header "Authorization: Bearer shk_agent_..."
SHUKATSU_TOKEN=shk_agent_... npm run mcp      # or as a stdio server that forwards to the daemon
```

claude.ai and phones add `https://your-host/mcp` as a custom connector and sign in with
OAuth; you pick which agent they get on the consent screen. Agents can do the work (the
tracker, evaluations, packets, the calendar, campaigns, the inbox) and can never stamp.

### Browser extension

`extension/` reads the NUworks, Handshake, LinkedIn, and CareerForum.Net pages you open, as
they load, and sends them to your shukatsu: postings wait in the inbox to be saved, and your
applications and threads are kept for the board readers. It never clicks or fetches anything
on those sites. Load it unpacked from `chrome://extensions`, make a capture key on the Agents
page, put it and the daemon's address in the extension's options, and turn it on under
Settings, Connections. The toolbar button saves any page as a posting. Which hosts and pages
it reads comes from `platforms/index.mjs`.

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
| `/campaigns` | Career fairs and hiring cycles: their applications, deadlines in the zone they were posted in and yours, fair days and interview slots with tight gaps marked |
| `/calendar` | Everything coming up, adding events, and the private calendar link to subscribe to |
| `/inbox` | What connected mail and calendars turned up, each with the action it proposes |
| `/capture` | The window the "Send to shukatsu" bookmarklet opens |
| `/digest` | The week, with copy-ready text in Japanese or English |
| `/people`, `/settings`, `/activity` | Access, account and passkeys, the full log |
| `/settings/agents`, `/settings/connectors` | Agents and their keys, client setup, the bookmarklet; mail and calendar accounts |

Data handling: `DATAFLOW.md`. Running it at home: `deploy/README.md`.
