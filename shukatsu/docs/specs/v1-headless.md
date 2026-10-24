# shukatsu v1: the headless system

shukatsu today is a web app sitting on an engine that only the web app can reach, because
every change goes through a Next.js server action and the only HTTP route is `/api/health`.
Agents work around that by running the upstream scripts, and the rules that keep the record
honest (archived job descriptions, legitimacy tiers, provenance, who may confirm what) are
written as instructions for whichever model happens to be reading them. This spec turns
shukatsu into a system with one boundary, so the web app, an agent over MCP, and the command
line all reach the same operations and every rule is checked in code at that boundary. It
also adds the integrations a student search actually runs through, which are email,
calendars, the school's course calendar, login-walled job boards, and recurring career fairs.

## Principles

1. **One door.** Every read and every change is an operation in one registry, and the web
   app, MCP, and the CLI are clients of that registry, so no client can do something the
   others can't be checked for.
2. **Rules live at the door.** An operation validates its input and its output against the
   same gates the CLIs run today, so a malformed evaluation from an agent is refused the same
   way a malformed form post is.
3. **Stamps are human.** The actions that make something true or final need a person signed
   in with a password or passkey, which means no token, agent, or connector can perform one
   whatever role it holds.
4. **Integrations propose.** Mail and calendar data arrive as evidence attached to a proposal
   in the review queue or as input an agent acts on with its own logged permissions, and
   they never write the record directly.
5. **Truth stays in files.** The split in `core/store.mjs` holds, because the facts, the
   tracker, and resumes stay in the data root under git, while `app.db` keeps who did what
   and a new `sync.db` keeps copies of outside data that can always be fetched again.

## Process model

One long-running process, `shukatsud`, is the system. It owns the operations registry, the
HTTP API, the MCP endpoint, the sync scheduler, and the calendar feeds, and it is the only
process that writes to the data root while it runs.

```
                 ┌──────────────────────── shukatsud ────────────────────────┐
 browser ──────► │ Next.js handler (pages, server actions)                   │
 agent (HTTP) ─► │ /mcp   Streamable HTTP, OAuth or token                    │
 CLI / scripts ► │ /api   JSON over HTTP, token                              │──► data root (files + git)
 calendars ◄──── │ /cal   private .ics feeds                                 │──► .shukatsu/app.db
                 │ scheduler  connector sync, scans, digest, follow-up dates │──► .shukatsu/sync.db
                 │         all of the above call  ops.run(principal, op, in) │
                 └───────────────────────────────────────────────────────────┘
```

The Next.js app is mounted inside the daemon through Next's request handler, which keeps a
single process and a single port, and its server actions call `ops.run` in process instead of
reaching into `e.*` modules. That keeps the app fast without giving it a private path, since
the registry is the only code that holds write access.

The writing CLIs (`review.mjs`, `people.mjs`) run their operations through `core/client.mjs`,
which sends them to the daemon's API when it is running, authenticated by the owner's terminal
token in `.shukatsu/owner.token` (`0600`, written by the daemon). When the daemon is down the
same operations run in the CLI's own process, so every write goes through the registry either
way. `master.mjs` builds files (renders, drafts, finalized resumes) under the lock in
`core/lock.mjs` and stays a direct tool. Upstream scripts such as `set-status.mjs` and
`merge-tracker.mjs` keep their own locks and may still write files, which needs no watcher,
because the engine reads the data root fresh on every call and keeps no cache of it.

On the laptop it runs under launchd (`deploy/com.shukatsu.app.plist` grows into the daemon's
plist), and a sleeping laptop simply misses sync runs, which the cursors in `sync.db` catch up
on wake. The same build moves unchanged to the home machine described in `deploy/README.md`,
which is where remote MCP stays reachable around the clock.

## The operations registry

`core/ops/` holds one file per area, and each operation is a plain object.

```js
export const setStatus = {
  name: 'tracker.setStatus',
  kind: 'command',                 // or 'query'
  permission: 'tracker.write',     // checked by people.can()
  stamp: false,                    // true -> human session required, whatever the role
  input: { /* JSON Schema */ },
  output: { /* JSON Schema */ },
  activity: 'e.tracker.status',    // written to the activity log on success
  run: (root, actor, input) => { ... },
};
```

`ops.run(principal, name, input)` resolves the principal, checks the permission and the stamp
rule, validates the input, runs the handler under the lock, validates the output, writes the
activity entry, and returns either the result or one structured error. JSON Schema is the
schema language because MCP tools are described in it, so a tool's definition is generated
from the operation and can't drift from it.

### First operations

| Area | Queries | Commands |
|---|---|---|
| Record | `record.get`, `record.search`, `record.trace` | `profile.propose` |
| Review | `review.list`, `review.get`, `proposal.mine` | `review.decide` (stamp), `review.reopen` (stamp), `proposal.update`, `comment.add` |
| Postings | `pipeline.list`, `posting.get` | `posting.add`, `posting.capture`, `evaluation.submit` |
| Tracker | `tracker.list`, `company.history` | `tracker.setStatus`, `tracker.add` (each a stamp when the row goes to Applied or Hired) |
| Packets | `packet.list`, `packet.get` | `packet.create`, `packet.select`, `packet.edit`, `packet.check`, `packet.submit`, `packet.close`, `packet.ready` (stamp), `packet.markSent` (stamp), `candidate.setJa` (stamp) |
| Campaigns | `campaign.list`, `campaign.get` | `campaign.create`, `campaign.update`, `campaign.link`, `campaign.schedule` |
| Schedule | `calendar.upcoming`, `calendar.conflicts` | `event.create`, `event.update` |
| Inbox | `inbox.list`, `inbox.get`, `connector.list` | `signal.update`, `connector.sync`, and the stamps `connector.add`, `connector.update`, `connector.remove`, `connector.purge` |
| People | `digest.week`, `activity.list` | `people.*`, `invite.revoke`, `agent.*`, `token.*` (all stamps), plus app-only account, passkey, and session operations |

The agent surface stays near 45 operations on purpose, because an agent chooses tools worse
as the list grows. Related changes are one operation with fields (`packet.edit` takes
bullets, the cover letter, and answers, and `event.update` also marks done and cancels), and
operations only a person needs (account settings, passkeys, sessions, people) are marked
app-only and never reach MCP. The 150 upstream scripts stay reachable as the implementation
behind these operations instead of being exposed one by one.

The app's pages render from the engine's read functions in process, behind the same
permission checks, and every change they make is a server action that calls `ops.run` as the
signed-in person. A guard test fails the build if a page, an action, a CLI, or an HTTP route
calls an engine writer or writes SQL directly.

### What moves from instructions into code

`evaluation.submit` is the clearest case. It takes the report body plus its machine summary,
then reserves the report number itself through `reserve-report-num.mjs`, checks for the
`**URL:**` and `**Legitimacy:**` headers and the archived job description that
`check-jd-archive.mjs` requires, writes the tracker addition, and runs `merge-tracker.mjs`.
An agent that skips a block gets an error naming the missing block, which is a stronger
guarantee than a paragraph in `AGENTS.md` asking it to remember.

The same pattern covers the rest. `packet.check` runs the bullet, fact, materials, and
Japanese style gates that `finalize` runs today, `tracker.setStatus` goes through
`set-status.mjs` with its canonical-state check, and any figure that reaches a packet is
traced to a verified fact or the operation refuses it.

## Principals, roles, and stamps

A principal is either a **person** signed in through a session cookie or an **agent**
identified by a token. The `users` table gains a `kind` column (`person` or `agent`), and
`ROLES` in `core/people.mjs` gains `agent`, which the owner creates on a new Agents page under
settings. Each agent has a name ("Claude Code on the laptop", "claude.ai"), so the activity log
says which one did what.

| Permission | owner | agent | editor | reviewer | viewer |
|---|---|---|---|---|---|
| read record, tracker, packets, review queue | yes | yes | yes | most | some |
| comment, suggest postings, propose profile changes | yes | yes | yes | some | no |
| create and edit packets, run checks | yes | yes | yes | no | no |
| `tracker.write`, `pipeline.write`, `evaluation.submit` | yes | yes | no | no | no |
| `calendar.write`, `campaign.write`, `inbox.write` | yes | yes | no | no | no |
| `review.decide`, `packet.markSent`, `tracker.decide` (a row to Applied or Hired), `profile.write` | **stamp** | no | no | no | no |
| `people.manage`, `settings.system`, `agent.*`, `token.*` | **stamp** | no | no | no | no |
| contacts, compensation | yes | per-agent grant | per-person grant | per-person grant | no |

The stamp operations are exactly the ones that make a claim true or final, which are
confirming, correcting, or marking a fact unknown, accepting a proposal, marking a packet
sent or a row Applied or Hired, and changing who has access. They check the principal's kind as well as its role, so
an agent token is refused even if someone later edits the matrix. A stamp needs a person
signed in by session, or the owner at their own terminal, and granting a remote client access
through OAuth also needs a sign-in within the last ten minutes.

That boundary is enforced for everything that reaches shukatsu through its doors (the app,
MCP, the API). An agent that also has shell access to the machine as the owner's user could
read the owner's terminal token or open the database itself, so a local agent's shell is
bounded by its own harness permissions, which should deny running `review.mjs` and reading
`.shukatsu/`.

An agent's tracker writes go through `set-status.mjs` with the source `set-status`, which
keeps `data/status-log.tsv` inside upstream's closed source set, while the activity log in
`app.db` records which agent made the change and why.

## Access for agents

### MCP

The daemon serves MCP over Streamable HTTP at `/mcp`. A local `shukatsu mcp` command runs as a
stdio server for clients that prefer it, and it forwards every call to the daemon, because a
stdio server that opened the files itself would be a second writer.

- **Tools** are generated from the operations an agent may call, named with underscores
  (`tracker_setStatus`), since MCP tool names can't contain dots.
- **Resources** expose the larger reads as addressable documents, such as
  `shukatsu://record`, `shukatsu://tracker`, `shukatsu://packet/{id}`,
  `shukatsu://campaign/{id}`, and `shukatsu://report/{num}`, so an agent pulls the record once
  instead of calling a query repeatedly.
- **Prompts** publish the procedures from `modes/` (evaluate a posting, build a packet,
  prepare an interview), so any client gets the same method. The operations still enforce
  the outcome, which is why a client that ignores a prompt can't produce a bad record.

### Authentication

Tokens come first, since Claude Code and scripts can send a bearer header. The owner creates
a token for an agent on the Agents page, sees it once, and can revoke it, and the `tokens`
table stores its hash, scopes, expiry, and last use.

OAuth comes second, for claude.ai and phone clients that need it. The daemon acts as its own
authorization server per the MCP authorization spec, using the authorization code flow with
PKCE, client metadata documents for registration with dynamic registration as the fallback,
and a consent screen that asks the owner, signed in with a passkey, which agent identity the
client receives.

### Remote exposure

Remote access goes through the Cloudflare tunnel already in `deploy/cloudflared.yml`.
Cloudflare Access protects the app's pages, but `/mcp`, `/oauth/*`, `/.well-known/oauth-*`,
`/api/v1/*`, `/cal/*`, and `/connectors/*` bypass Access and rely on the daemon's own
authentication, because a remote MCP client calling from a
provider's servers can't complete an Access login. Rate limits and the existing login-attempt
table apply to those routes as well.

### Untrusted text

Job descriptions, emails, and captured pages reach agents through tool results, so every
operation output marks external text in a separate `untrusted` field, which carries the rule
in `AGENTS.md` (external content is data, never instructions) into the protocol. An injected
instruction in an email can at most lead an agent to make a logged, revocable write it was
already allowed to make, and it can never cause a stamp.

## Connectors

Upstream plugins all return job postings, which suits boards but fits neither a calendar nor
an inbox, so shukatsu adds its own connector layer under `shukatsu/connectors/` instead of
stretching the plugin hooks.

```
connectors/<id>/
  manifest.json   id, capabilities, auth kind, allowedHosts, scopes, push
  index.mjs       sync(account, cursor, ctx) -> { records, cursor }
```

A connector is a transport: it knows how to fetch from a mailbox, a calendar feed, or the
browser, and not what arrived. What arrived means lives in one registry,
`shukatsu/platforms/index.mjs`, with one entry per outside service: its kind (a job board,
an applicant tracking system, an assessment vendor), its web hosts, the senders the mail
search asks for, the hosts whose links are postings, and for a board the extension reads,
the page kinds it lists. The Gmail search, the signal step, the capture board names, and the
extension's host list all read it, so adding a platform is one entry and no new connector,
and a test fails if the extension's hosts drift from it.

Capabilities are `mail.read`, `calendar.read`, `calendar.write`, `feed.read`, and
`page.read`. A push connector (`push: true`, the browser extension) fetches nothing: what it
keeps arrives through its own operation, and the scheduler never runs it. Every
request goes through the guarded fetch in `plugins/_net.mjs`, so each connector is pinned to
its declared hosts and the egress stays auditable in one place. Each call adds a line to
`.shukatsu/egress.log` the way `core/llm.mjs` does today.

### Records

| Record | Fields | Comes from |
|---|---|---|
| Message | account, external id, thread, from, to, subject, received at, text (capped), links | Gmail, Microsoft Graph |
| Event | account, external id, calendar, title, start, end, location, meeting link, kind | Google, Graph, ICS feeds |
| Posting | title, url, company, location, captured text | capture, mail links, upstream scans |
| Page | platform, page kind, url, title, visible text (capped), links; or, for a page the board doesn't list, its path with ids folded and a count | the browser extension |
| Signal | source record, kind, tracker row, campaign, confidence, proposed action | the signal step below |

Two more kinds come from the board readers once they exist (see the readers below): a
**person** (someone who wrote to the candidate, a recruiter on a thread) and an
**application observation** ("Handshake shows an application to Globex, status Reviewed,
on 10/2"). An observation is evidence about a tracker row, never the row itself: it becomes
a signal proposing a status change or a new row, the same way a message does.

### Storage and secrets

`sync.db` sits beside `app.db` in `.shukatsu/` and holds accounts, encrypted tokens, cursors,
records, and signals. Deleting it loses nothing that can't be fetched again, which keeps it
easy to purge. OAuth refresh tokens are encrypted with a key from the macOS Keychain, or from
a `0600` key file outside the data root on Linux, so the data root's git history never
contains a credential.

### Fetching less

Mail connectors search instead of reading the inbox, so only messages that match are stored.
The query is built from the sender domains of the applicant tracking systems upstream already
recognizes, the domains of companies in the tracker, the domains of active campaigns, the
school's job platforms, and a short list of subject terms such as interview, assessment,
application, and 面接. Everything else stays in the mailbox and never reaches the machine.

### From records to proposals

A scheduled step runs each new message and event through the upstream matchers
(`reply-matcher.mjs` and `invite-match.mjs`), which classify it as an interview invitation,
rejection, assessment, confirmation, offer, or noise, and link it to a tracker row or
campaign when one fits. Each signal waits in the Inbox with the actions it proposes (a status
change, an event to add, a posting to file), each an ordinary operation call. The review
queue stays reserved for claims about the candidate, which a status change or a calendar
entry isn't, so a signal needs no stamp. The candidate presses the action in the Inbox, or an
agent reading the inbox does it within its own permissions, for example by moving a row to
`Interview` and adding the event, which shows up in the activity log under that agent's name.
The proposed actions are built from tracker data and a date checked to be a date, never from
the message's words, so an instruction hidden in an email can't become an action.

### First connectors

| Connector | Capability | Notes |
|---|---|---|
| `ics-out` | calendar.write | A private `/cal/{token}.ics` feed of interviews, deadlines, follow-ups, and campaign days. Apple Calendar, Google Calendar, and Outlook subscribe to it without OAuth, and a viewer-level feed can go to family. |
| `ics-in` | feed.read | Any calendar feed URL, starting with the Canvas calendar feed, so exams and due dates show up as conflicts when an interview is scheduled. |
| `browser` | page.read | The extension's side, push-only. See the next section. |
| `gmail` | mail.read | `gmail.readonly`. A personal Google Cloud app left in Testing mode loses its refresh token every 7 days, so it is published as an unverified production app for the owner's own account. This supersedes the upstream `gmail` plugin for messages, which keeps filing leads from a label. |
| `msgraph` | mail.read, calendar.read | One connector for Outlook, Hotmail, and school Microsoft 365 accounts through the `common` endpoint. School tenants often require administrator consent for third-party apps, and when that blocks sign-in the fallback is a forwarding rule into the Gmail account. |
| `gcal` | calendar.read | Google Calendar busy times and events for conflict checks. |
| `eventkit` | calendar.read | Later, and macOS only. A small helper reads every account set up in Calendar.app without OAuth. |
| `line` | notify | The weekly digest to each person who links their own LINE account, through the install's own Official Account and the Messaging API. A nudge (counts and a link, no names) by default, or the digest in full; at a weekday and hour the owner sets. People link with a six-digit code from their own Settings, sent to the account and read by a signed webhook (`/connectors/line/webhook`); the links live in `app.db` (`notify_links`), since they belong to people and can't be fetched again. Its daily sync only checks the token. |

Slack, Teams, and Notion stay out of v1 because none of them carries the search itself.

## Login-walled boards

NUworks, Handshake, LinkedIn, and careerforum.net have no API a student can use (LinkedIn's
are partner-only, Handshake's are for employers, NUworks runs on Symplicity with nothing for
students) and sit behind the candidate's own sign-in. Their web apps fetch the candidate's
own data from private endpoints, so software holding that session could reach it, but every
one of their terms forbids automated access, and LinkedIn restricts accounts for it. So
shukatsu reads them three ways, none of which makes a request to the board, and LinkedIn
only the first (see Held, and refused).

1. **Mail, with every notification on.** Each board can email messages, application
   updates, and confirmations, and the employer's applicant tracking system sends the real
   status of an application whichever board it came through. With the boards' email
   notifications all switched on, the `gmail` connector carries most of what happens.
2. **The passive extension.** Reads the pages the candidate opens anyway, as they load, on
   NUworks, Handshake, and careerforum.net.
3. **Capture.** The extension's toolbar button (and the bookmarklet, and an iOS Shortcut)
   saves whatever page the candidate is reading, on any site but LinkedIn, where it saves the
   address alone as a blocked inbox item that asks for the employer's posting.

### The extension

`shukatsu/extension/` is a Manifest V3 extension, loaded unpacked. Its reader runs only on
the boards' hosts, in the extension's isolated world, so it shares nothing with the page's
own scripts and only reads the DOM the page already rendered. It never clicks, scrolls,
types, or fetches from the board, so to the board the candidate is simply browsing. It
asks for no host access beyond its content script and calls nothing but the candidate's own
shukatsu, at the address and with the capture key set in its options.

```
reader.js      on every address change: page.observe { url }
               shukatsu decides the platform and page kind from the URL (platforms/)
                 listed kind  -> { wants_text: true }; the reader waits for the page to stop
                                 changing and sends title, visible text, links
                 other page   -> kept by path alone (/in/:id, a count); no text is sent
background.js  the only egress: page.observe and, for the toolbar button, posting.capture
options        address, capture key, reading on or off per board
```

`page.observe` is owner-only, so it arrives through the owner's capture key (scoped to
`posting.capture` and `page.observe`) and never from an agent, which has no browser to have
read a page in. The owner turns the `browser` connector on in Connections first, and can
pause or purge it there like any other.

- **A posting** the tracker and pipeline don't already hold becomes a `posting` signal whose
  one action is `posting.capture { record }`. The action names the record, never its text,
  so nothing on the page reaches an operation's input. Saving archives the text as the job
  description, which makes it the record of a posting a login wall would otherwise hide.
- **The applications list and message threads** are kept as pages, one per URL, replaced
  when seen again. They make no signal yet: they are the samples the readers are written
  from.
- **Every other page** on those hosts is kept by its shape and a count, which shows which
  page patterns miss without keeping any of the page.

Page patterns in `platforms/` are a first reading of each board's URLs and are corrected
from the shapes the extension logs.

### Readers (next)

A reader turns one board's kept page into records: an applications list into application
observations, a thread into a message and a person. Each is written from real kept pages,
which stay in the private data root: their text is the board's and other people's, and the
boards' terms bar republishing it. The tests in this public repo run on synthetic pages built
to the same shape, so they stay offline and nothing real is ever committed here. A reader
lives beside its platform entry.
The observations go through the signal step, which matches them to tracker rows the way it
matches mail, so drift between a board and the tracker (applied on Handshake with no row, a
row still Applied that NUworks shows as Not selected) becomes an inbox item with the
canonical fix.

### Held, and refused

- **Session sync is held.** The daemon could drive a browser with the candidate's session on
  a schedule, at human speed, and walk the applications and message pages unattended. It
  breaks the boards' terms and their next redesign breaks it, and NUworks is a Northeastern
  system under the university's acceptable-use policy. It waits until mail and the passive
  extension have shown what they actually miss, and if it comes it is per board and off by
  default.
- **LinkedIn is never automated, and never read** (`automation: 'never'` in its entry).
  Decided 2026-10-14 for automation, because losing the account costs more than any data
  from it, and widened 2026-10-23: section 8.2 of its User Agreement bans browser plugins
  that copy the service, profiles and other data included, so the extension runs nothing
  there either. Its notification mail and the occasional data export are the only ways in,
  and a LinkedIn posting is captured by its address and confirmed at the employer, whose
  posting is the canonical one anyway.

### Filling application forms

Decided 2026-10-14. The candidate presses Fill (Alt+Shift+F, or the toolbar button's
menu) on an application form. shukatsu fills it, lists what went where, and outlines the
site's Submit button. Pressing that button is always the candidate's, and so is the
stamp that records it: `packet.markSent` (permission `packet.send`), or moving the row to
Applied by itself (`tracker.decide`), both stamps. No agent,
token, or schedule can do either. It never runs on LinkedIn (`automation: 'never'`): the
extension stops before it touches the page, and `application.plan` refuses the form too.
Employer ATS forms come first: Greenhouse, Lever, Ashby.

**The model reads, code acts.** A filler that takes a screenshot, asks a model where to
click, and clicks spends a model round trip per field, which is minutes for a 30-field
form, and positional clicks pick the wrong option where the order varies (Workday's
Yes/No). Here no model is in the loop. The page is read once, the whole form is planned
in one call, and the plan is written in one pass:

```
extension/filler.js  read()     every field as a person sees it: kind, accessible name,
                                required, options, visible. In every frame the extension
                                may reach (a Greenhouse form is often framed on the
                                company's site).
application.plan     apply/     each field to a value, by the strongest signal it has:
                                the ATS's own field name (platforms/ fill.fields), the
                                autocomplete token, the label, the input's name. Values
                                from the answer bank (apply/bank.mjs) and the posting's
                                packet. Milliseconds, no model.
extension/filler.js  act(plan)  1. the resume first; wait until the page stops changing
                                2. every value written over whatever the site put there
                                3. read back; a value a framework threw away is typed
                                4. watch(): for 12 s, a value the site changes is put back
extension/panel.js              the list: yours, then check, then sure
application.filled              counts and timing, in the activity log
```

A second round runs when an answer reveals a follow-up question, or fills a list that was
empty (`again()` in the filler).

The three ways filling goes wrong, and what answers each:

- **Slow.** No model in the loop, as above. The target is a known form filled in under 5
  seconds from the press, most of it the wait for the site's resume parser.
- **The wrong value in a box.** The ATS's own field names are exact and come first. A
  label is matched only to an answer key whose kind fits (a resume never goes into a text
  box). Every value is read back after it is written, and each row says how sure it is
  (`sure`, `check`, `yours`). Profile values are cut to what a box asks for: the school
  without the city its heading carries, the degree without "Candidate for", the
  graduation date as "May 2028", one location where the profile lists two.

**Dropdowns** are where a wrong pick happens most, so a pick is made by one matcher,
`extension/match.js`, which the server plans with and the page picks with (a searchable
list, or one too long to send), so the two never disagree. It returns a pick, a tie, or
nothing, and a tie or nothing is left to the candidate with the options named:

- the same words after aliases: "USA" is "United States of America", "MA" is
  "Massachusetts" (a code only in capitals, so "in" is not Indiana);
- a side taken is never matched to the opposite: "No" never picks "I will require
  sponsorship" over "I will not", and a yes to statement options ("I am authorized…",
  "I am not authorized…") picks the one statement that says yes;
- whole words at the start, not letters: "No" is not the start of "North Carolina",
  "Data" picks "Data analysis" over "Database administration", and "Boston, MA" picks
  "Boston, Massachusetts, United States" over "Boston, England";
- a degree by its level, a date by its year or month when the list is years or months;
- the one option sharing most words by a clear margin. "Other" and "Prefer not to say"
  are never a fuzzy pick.

A searchable dropdown is opened first and matched as it stands, since most show every
option and a search only hides the right one. Only then is it searched (the whole answer,
then its first part, "Boston"), and each list is read once it stops changing, so a list
still loading or still showing the last search is never picked from. A list counts only
if the dropdown names it, or it is the one list that opened when the dropdown was
touched, never another widget's open list. A list that fills in after another answer (a
state list once the country is chosen) is planned again in the second round.
- **The site's own autofill.** The real culprit is usually the ATS reading the uploaded
  resume back into the form. It overwrites names and fills fields with what it parsed.
  So the resume goes in first and the filler waits for the page to go quiet (longer
  where the registry says `parser: 'on-upload'`). Then every planned value is written
  over what the site put there, and the guard puts back a late overwrite. A field the
  site filled that the plan left alone is marked for a look. Chrome's own autofill is
  told apart from the candidate's typing by `:autofill`, and only a change the candidate
  made by hand is left alone.

Values are written the way a framework notices: the element prototype's own value setter
(past any wrapper React puts on the element), then input, change, and focusout events.

**What is never filled.** A field no person can see (off-screen, zero-sized, styled
away) is reported hidden and left alone, because filling a bot trap marks the
application as a bot's. File inputs are the exception, since most forms style them away
behind a button. A box or radio on a site whose captcha trips on scripted clicks
(Lever, `clicks: false`) is left to the candidate, with the answer to tick shown.

**Sensitive answers are stated, never derived.** Work authorization, sponsorship, salary,
demographics, and consent are filled only from `data/form-answers.yml`, the candidate's
own words. They are never worked out from the profile. A student on CPT is authorized
for a co-op without being listed as authorized in the country, so deriving either answer
would put a false statement in front of an employer. The same file holds answers to
recurring questions in their exact wording. Work authorization and sponsorship are stated per country, and are
used only for the country the question names; a question naming no country takes a plain
answer, or the one country listed, marked for a look. A Yes for the United States never
answers a question about Canada.

**Which posting.** A form is matched to a packet or tracker row by link first: the row's
URL column, or any link in its notes (where "apply on Avature: …" sits). Otherwise by
company: an ATS address names its tenant (`bloomberg.avature.net`,
`acme.wd1.myworkdayjobs.com`, `job-boards.greenhouse.io/acme`), and one open packet or one
Evaluated row for that company is taken. The panel says it was matched by company. Two or
more are matched to none, never guessed between.

**The resume.** The one the tracker row's PDF column names, since that is the file made
for this posting. Otherwise the newest `data/pdf-index.tsv` CV whose file name carries the
company; two from the same newest day (a variant beside the main one) are left to the
candidate. The panel always names it, so a wrong one is seen before Submit.

**Preview.** Alt+Shift+P (or the toolbar button's menu) runs the same read and plan and
writes nothing: the panel shows what would go where, with a "Fill it" button. It is the
safe way to try Fill on a form that matters, or on a site it has never seen.

**Form answers and learning from fills.** The Form answers page (`/answers`) is where the
candidate states what forms ask: work authorization and sponsorship per country, salary
and demographics, every other key (beside what the profile would fill), and questions in
their exact wording. Stating one is `answers.set`, a stamp, written to
`data/form-answers.yml` and committed. After a fill, "Remember my answers" on the panel
sends what the candidate typed or picked by hand (trusted edits only, never what the site
or the browser's autofill wrote) as `answers.suggest`, through the capture key. Those wait
as suggestions, shown with the site they came from, until the candidate accepts (with an
edit, if they like) or dismisses each one. A consent, a file, or an essay over 300
characters is never suggested.

**Access.** The capture key gained `application.plan`, `application.filled`, and `answers.suggest`. A plan
returns the answer bank, so that key now reads contact details and stated answers, and
it lives only in the extension. The top frame is reached through `activeTab` when the
candidate presses Fill. A form framed from an ATS needs that ATS's host, which the options
page asks for once as an optional permission.

Next:

1. **Plans ready before the press.** Greenhouse's public board API lists a posting's
   questions (`?questions=true`), so a posting's plan can be built when it is saved, and
   its free-text answers drafted into the packet for review then. It would need an egress
   entry and a DATAFLOW line.
2. **A model for what nothing matched.** One batched call per form, through
   `core/llm.mjs`, that may only map a field to an answer key or pick an option index.
   It never writes a value, so coverage grows without a new way to be wrong.
3. **Workday**, whose steps, per-tenant accounts, and fields that only register keystrokes
   (modes/apply.md, Known ATS Quirks) make it a separate adapter.

## Campaigns

A recurring career fair runs as a cycle of online pre-applications with their own deadlines,
invitations to interview by email, interviews packed into the fair days, and follow-ups
afterward. A campaign is the entity that holds that cycle together.

```
campaigns       id, name, kind (fair | cycle), url, venue, timezone, starts_on, ends_on, notes
campaign_rows   campaign_id, tracker_num, channel (the fair site, the employer's ATS), note
events          kind (interview | deadline | followup | fair | task | other), title,
                starts_at (UTC, or a date when all day), ends_at, timezone, location,
                meeting_url, tracker_num?, campaign_id?, round, source, done_at, cancelled_at
```

A campaign's deadlines, fair days, and slots are rows in the one `events` table, which is also
where interviews and follow-ups outside any fair live, so the calendar feed, Today, and the
conflict check read one place.

Deadlines keep their source timezone, because a deadline posted in JST and read in ET is the
easiest one to miss. The campaign page lists every linked application with its status,
channel, packet readiness (including whether the Japanese packet has confirmed Japanese for
every fact), and deadline. It shows the fair days as a timeline of slots with travel gaps and
conflicts marked. Every deadline and slot flows into `ics-out`. The next year's campaign
starts as a copy of the last one with its dates cleared.

The tracker remains the source of truth for application state, and campaigns only group and
schedule rows, which keeps upstream tools working on the tracker unchanged.

## Data flow additions

`DATAFLOW.md` (one file, at the repo root) gains a section for each connector, written for a
non-engineer, and `tests/dataflow.spec.mjs` fails when a connector, a host one may reach, or a
module that calls out is missing from it. Each section covers the following.

- **What arrives.** Messages that match the search, calendar events, feeds the candidate
  adds, and the board pages the extension reads. Messages contain other people's names and addresses, so they are kept in `sync.db`,
  shown to the owner and agents only, and purged by connector or entirely from settings.
- **What leaves.** Requests to Google, Microsoft, and LINE, each limited to its declared
  hosts and logged in `egress.log`. MCP results go to whichever agent the owner authorized,
  which for a hosted model means the model provider receives the tool results that agent asks
  for.
- **Who can reach it remotely.** People through Cloudflare Access and their invite. Agents
  through tokens or OAuth the owner granted and can revoke.

## Testing

- Every operation has a `node:test` spec against the fixture data root that covers its
  permission, its stamp rule, and its schema.
- A guard test fails if any server action, CLI, or MCP handler writes to the data root
  without going through `ops.run`.
- Connectors are tested against recorded responses, with no live network. Every fixture is
  synthetic: no real posting, message, page, or person, since this repo is public.
- The MCP surface is tested by listing tools and calling one from each permission tier with
  an agent token, which asserts that every stamp is refused.

## Phases

| Phase | Ships | Why first |
|---|---|---|
| 0 | `core/ops/` with the campaign, schedule, capture, and inbox operations, `ics-out`, `ics-in`, `gmail` with signals, the capture bookmarklet, the campaign page | A fair cycle needs deadlines on the calendar and invitations caught from mail before it needs anything else |
| 1 | `shukatsud` with the app mounted inside it, the remaining operations, server actions moved onto `ops.run`, CLI routing, the guard test | One writer and one door |
| 2 | MCP over HTTP and stdio, agent principals, tokens, resources and prompts | Agents become first-class clients |
| 3 | OAuth for remote MCP, the tunnel routes, Cloudflare Access split | claude.ai and phone access |
| 4 | `platforms/`, the passive extension and `browser` connector, form filling (`apply/`, `application.plan`), then the board readers, `msgraph`, `gcal`, `eventkit`, `line` | More of the same pattern |

Phases 0 to 3 shipped together in October 2026. In phase 4, the platform registry and the
passive extension shipped first, then form filling for Greenhouse, Lever, and Ashby, then
`line`; the board readers wait on pages kept from real use.
