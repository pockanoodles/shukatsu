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

Three things can be turned on, each by the candidate:

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

Applications themselves are never sent by shukatsu. The candidate submits them, outside
the app, and then marks them sent.

## Removing someone

"Remove access" on the People page signs that person out everywhere at once and stops
their sign-in links from working. Their past comments and proposals stay, credited to them,
because the record of who suggested what is part of the history. To erase a person
entirely, the candidate deletes their row from `.shukatsu/app.db`.
