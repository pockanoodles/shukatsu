# Data flow

shukatsu holds a job candidate's full work history, their applications, and the
conversations of the family and mentors helping them. This page says, in plain terms,
where each piece lives, who can see it, and what ever leaves the machine.

## Where things live

| What | Where | Who can see it |
|---|---|---|
| Every achievement, with its evidence | `data/career-profile.yml` in the private data root | Everyone signed in. Evidence file paths: the candidate only |
| Generated resumes, archived job postings | `output/`, `jds/` in the data root | Everyone signed in |
| The application tracker and its status history | `data/applications.md`, `data/status-log.tsv` | Everyone signed in |
| Accounts, password hashes, passkeys, sessions | `.shukatsu/app.db` in the data root (never in git) | Nobody reads hashes. People are listed to the candidate only |
| Proposals, comments, packets, the activity log | `.shukatsu/app.db` | Everyone signed in, except account changes (candidate only) |
| Compensation targets | `config/profile.yml` | Not shown in the app today. The per-person "can see compensation" grant on the People page is the switch any future view will honor |
| Contacts (`data/contacts.tsv`) | The data root | The candidate only. The app never shows them |
| Confirmations made in review | `sources/review-log.md`, plus one git commit per change | Everyone signed in (the log), the candidate (the git history) |

The people the candidate invites see what their role allows (`shukatsu/core/people.mjs`
has the full table): editors and reviewers read the record and applications and add
their own suggestions; viewers read only. Nobody but the candidate can change the record,
the tracker, or who has access, and nobody at all can submit an application from here.

## What leaves the machine

**By default, nothing.** Pages, fonts, and scripts are all served by the machine itself:
no analytics, no tracking, no fonts from Google at view time (they're downloaded once at
build time and served locally).

These can be turned on, each by the candidate:

1. **The tunnel or tailnet** that lets invited people reach the app. Cloudflare (tunnel)
   or Tailscale (tailnet) carries the encrypted traffic between the visitor's browser and
   the machine. Neither stores the data.
2. **AI wordings** (off unless `ANTHROPIC_API_KEY` is set). When someone presses "Suggest
   wordings" on a packet, one bullet's text, its role heading, and up to 6,000 characters
   of the job posting go to Anthropic's API. Nothing else from the record, and no names of
   the people using the app. Each call is logged to `.shukatsu/egress.log` with who, when,
   the model, and the sizes (not the text). The only code that does this is
   `shukatsu/core/llm.mjs`.
3. **Backups** to wherever `deploy/backup.mjs` is pointed, which should be an encrypted disk
   the candidate owns.
4. **Agents.** An agent the candidate names on the Agents page (Claude Code, claude.ai)
   reaches shukatsu with a key or through OAuth, and reads whatever its operations return:
   the record, the tracker, packets, the calendar, and the inbox. When the agent runs on a
   hosted model, the model's provider receives those results as part of the conversation.
   Agents never see compensation or contacts unless the candidate ticks that box for that
   agent, and they can never confirm a fact, accept a proposal, mark something sent, or
   change who has access. Every change an agent makes is in the activity log under its
   name, and revoking its key or disabling it on the Agents page cuts it off at once.
5. **Calendar links.** A private calendar link (`/cal/...ics`) lets Apple Calendar, Google
   Calendar, or Outlook fetch the schedule about once an hour. Whoever holds the link sees
   interview times, deadlines, and places, and the candidate's own link also shows notes and
   meeting links. Each link is made for one person and can be revoked alone.
6. **Captured postings.** "Send to shukatsu" copies the text of the posting the candidate is
   looking at into the data root, where it becomes the archived job description. It sends
   nothing anywhere else.

Applications themselves are never sent by shukatsu. The candidate submits them, outside
the app, and then marks them sent.

## Connectors

Connectors bring outside data in. Each is off until the candidate connects it on the
Connections page (Settings), each can only reach the internet addresses listed for it, and
every request it makes adds a line to `.shukatsu/egress.log` with the time, the connector,
the address's host, and the size and status. That log never holds a link's path, a
password, a token, or any message text.

What they copy lives in `.shukatsu/sync.db`, beside `app.db` and never in git. It holds
copies that can always be fetched again, so deleting it loses nothing that can't come
back. Credentials in it are encrypted with a key kept in the Mac's Keychain (or, on
Linux, in a private file under `~/.config/shukatsu/`), never in the data root, so
backups and git history carry no password.

Nothing a connector reads writes the record. A message or event is read for a signal
(for example "this looks like an interview invitation for application 12"), and a signal
only proposes a change. The candidate, or an agent the candidate allowed, makes the change
through the app's ordinary actions, which check permissions and appear in the activity
log under that person's or agent's name.

### Calendar feed (`ics-in`)

- **What arrives.** The events in a calendar feed the candidate pastes in, such as the
  Canvas calendar feed: class times, exam times, and due dates, with titles, places, and
  descriptions as the school wrote them.
- **What leaves.** One request to the feed's own host to download the calendar. Nothing
  about the candidate is sent except what that link itself identifies. The feed link is
  a private key to the candidate's calendar, so it is kept encrypted and never shown again
  after it is saved.
- **Who can see it.** Classes and exams count as busy time when an interview is being
  scheduled, and due dates are listed beside them. The copied events themselves are read
  only by the candidate and by agents the candidate allowed. Other people on the app do not see them.
- **How to remove it.** Connections, then Remove, deletes the feed, its link, and every
  event copied from it. "Delete copies from Calendar feeds" keeps the feed and deletes the
  copies.

### Gmail (`gmail`)

- **What arrives.** Only mail that matches a search. The search asks for mail from the
  hiring systems employers use (Greenhouse, Lever, Workday, and similar), from the school's
  job platforms (NUworks, Handshake, the career fair site), from the websites of
  companies in the tracker and campaigns, and mail whose subject has words such as
  interview, assessment, application, offer, 面接, or 選考. For each match shukatsu keeps
  who sent it, who it went to, the subject, the time, the text (cut off at 20,000
  characters), and the links in it. It never fetches attachments, and the rest of the
  mailbox stays in Google.
- **What leaves.** Requests to `gmail.googleapis.com` (the search and the matching
  messages) and `oauth2.googleapis.com` (sign-in and renewing it). The search words are
  sent to Google, which already holds the mail. The candidate's own Google Cloud app (client
  id and secret) is used for this, and its permission is read-only (`gmail.readonly`),
  so shukatsu cannot send, delete, or change mail.
- **Who can see it.** Messages hold other people's names and addresses. They are read only
  by the candidate and by agents the candidate allowed. When an agent reads one, the text
  goes to whichever AI provider runs that agent, and the app marks it as outside text so
  the agent treats it as information and not as instructions. Remote reach is limited
  to the candidate's signed-in session and the agents the candidate authorized.
- **How to remove it.** "Delete copies from Gmail" deletes the messages and signals but
  keeps the connection. Remove deletes the connection and its sign-in. To end Google's side of it, the
  candidate also removes shukatsu under their Google account's third-party access.
  A Google Cloud app left in Testing mode loses its sign-in every 7 days, so the Connections
  page asks the candidate to publish it as an unverified app for their own account.

## Removing someone

"Remove access" on the People page signs that person out everywhere at once and stops
their sign-in links from working. Their past comments and proposals stay, credited to them,
because the record of who suggested what is part of the history. To erase a person
entirely, the candidate deletes their row from `.shukatsu/app.db`.
