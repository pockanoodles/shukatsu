# Data flow

Shukatsu holds a job seeker's full work history, their applications, and the conversations of the family and mentors who help them. This page says what leaves the machine it runs on, where it goes, and why, and it is written to be read without knowing the code. If something here stops being true, the code is wrong and this page is right. The more detailed account of the app's connectors and permissions is [`shukatsu/DATAFLOW.md`](shukatsu/DATAFLOW.md).

## The short version

Shukatsu runs on a computer you own, and its author runs no server. The author receives nothing from your copy, because there is no account with the author, no analytics, no crash reporting and no telemetry. By default the only traffic that leaves the machine is the encrypted connection that lets the people you invited reach the app, and everything else is something you turn on yourself.

## What leaves, where it goes, and why

| Where | What | Why |
|---|---|---|
| **Anthropic API** (`api.anthropic.com`), only when `ANTHROPIC_API_KEY` is set | One resume bullet, its role heading and title, and up to 6,000 characters of the job posting, each time someone presses "Suggest wordings" on a packet | To get three reworded versions of that bullet. Nothing else from the record, no names of the people using the app, no contacts |
| **Gmail** (`gmail.googleapis.com`, `oauth2.googleapis.com`), only after the candidate connects it | A mail search and the sign-in with Google, using the candidate's own Google Cloud app with read-only permission | To find replies from employers, hiring systems and the school's job platforms, so they can be matched to applications |
| **A calendar feed's own host** (for example the Canvas feed), only after the candidate pastes the address | One request to download the calendar, carrying only what the link itself identifies | So classes and exams count as busy time when an interview is scheduled |
| **Tailscale or Cloudflare**, whichever you choose to let invited people in | The encrypted connection between each person's browser and the machine | So family and mentors can open the app from their own phones and computers |
| **An agent you name** (Claude Code, claude.ai, or another MCP client) | Whatever that agent's operations return: the record, the tracker, packets, the calendar and the inbox | So the agent can do the work you gave it, and it never sees compensation or contacts unless you tick that box for that agent |
| **Calendar apps that subscribe** (Apple Calendar, Google Calendar, Outlook) | The schedule behind one private link, fetched about once an hour | So interviews and deadlines show up in the calendar app. Each link is for one person and can be revoked alone |
| **Your backup disk** | A snapshot of the data root and the app database | So a dead machine loses nothing. Point it at an encrypted disk you own |
| **GitHub**, when you update | A `git fetch` of the code, and the career-ops update check | To pull new versions of the app and of the career-ops engine |

Applications are never sent by Shukatsu. You submit them yourself, outside the app, and then mark them sent.

## Who sees what

The candidate is the owner and sees everything. Editors and reviewers read the record and the applications and add their own suggestions, and viewers read only. Nobody but the candidate can change the record, the tracker, or who has access. Compensation targets are not shown anywhere in the app today, and contacts are shown only to the candidate.

Family and mentors reach the app through the tunnel or tailnet you set up, with an account you invited them to. Sign-in is a password (stored only as a scrypt hash) or a passkey, and there is no public sign-up. Tailscale is end-to-end encrypted between the devices on your tailnet. A Cloudflare Tunnel decrypts the traffic at Cloudflare's edge before passing it to your machine, so Cloudflare can see it while it passes through. If that matters for the people you invite, use Tailscale or put Cloudflare Access in front.

## Where things are kept

Everything is on the machine, in two places. The data root is your private git repo holding the record (`career-profile.yml`), the tracker, resumes and archived postings, and it has no remote. Beside it, `.shukatsu/` holds the app database (accounts, comments, proposals, the activity log), the connectors' copies of mail and calendar events, and the egress log. Those files are never committed to this repository.

Credentials that connectors store are encrypted with a key kept in the Mac's Keychain, or in a private file under `~/.config/shukatsu/` on Linux. The key is never in the data root, so backups and git history carry no password.

## The egress log

Every call the app makes to an outside service writes one line to `.shukatsu/egress.log` with the time, who triggered it, the host or model, the sizes and the status. It never holds the text that was sent, a link's path, a password or a token. The model call is in one file, `shukatsu/core/llm.mjs`, and every connector request goes through one wrapper, `shukatsu/connectors/ctx.mjs`, which refuses anything that is not HTTPS or not on that connector's list of allowed hosts. Gmail may reach only `gmail.googleapis.com` and `oauth2.googleapis.com`, and the calendar feed connector may reach only the host of the feed you gave it.

## Phone calls, recordings and the browser

Shukatsu does not record, transcribe or place phone calls, and it has no microphone access (the app's security headers turn the microphone, camera and location off). The phone calls on the product page mean the habit of relatives calling with suggestions, which the review queue replaces. A phone number appears only if the candidate puts it in the resume header.

The app serves its own pages, scripts and fonts. The fonts are downloaded once when the app is built and served from your machine, so opening a page makes no request to Google or anyone else. The app's content security policy only allows connections back to itself.

## Postings

Postings come from the people using the app. The candidate, editors, reviewers and agents suggest a posting by URL, which saves only the link. "Send to Shukatsu" saves the text of the page the candidate is reading into the data root, and it sends nothing anywhere else. The daemon does not fetch job sites or scan boards.

## The career-ops engine's own commands

This repository includes the career-ops engine, and its commands run only when you run them yourself. The Shukatsu daemon runs a few of the engine's scripts as local processes (the tracker, report numbers, status changes, profile validation), and none of those call out. The engine's other commands do reach the internet.

| Command | Where it goes | When |
|---|---|---|
| Board scanners (`scan.mjs`, `scan-ats-full.mjs`, `scan-hn.mjs` and the providers they load) | The public APIs and pages of the job boards and applicant tracking systems you list in `portals.yml`, and Hacker News | Only when you run a scan. You are responsible for each site's terms |
| Posting checks (`check-liveness.mjs`, `fetch-jd.mjs`, `browser-extract.mjs`) | The posting's own address, sometimes through a Playwright browser on your machine | Only when you run them |
| Model scripts (`gemini-eval.mjs`, `openai-eval.mjs`, `openrouter-runner.mjs`, `ollama-eval.mjs`) | Google, an OpenAI-compatible endpoint you set, OpenRouter, or Ollama on your own machine | Only when you run one with its key set. These send posting and profile text, so read the provider's terms first |
| `update-system.mjs` | GitHub, to read career-ops' releases and fetch its code | Only when you run an update check |
| Optional plugins (`plugins/`: Apify, Notion, Gmail, H1B sponsor lookup) | That service's own API | Only when you install and configure one |
| `hired-share.mjs` | Nothing. It opens a prefilled GitHub issue in your browser and you submit it yourself | Only when you choose to share a story |

These commands are upstream's, and their network calls are not in one audited client. The board providers share one HTTP layer with a guard against private addresses, and the model scripts and plugins each call their own endpoint. Treat them as tools you point at the internet yourself.

## Removing someone, or everything

"Remove access" on the People page signs that person out everywhere at once and stops their invite links. Their past comments and proposals stay, credited to them, because the record of who suggested what is part of the history. To delete everything, delete the data root and the `.shukatsu/` folder next to it, and remove Shukatsu under your Google account's third-party access if you connected Gmail.

## What is never collected

Shukatsu has no telemetry, no analytics and no crash reporting, and it makes no request to any server run by its author. The framework it is built with, Next.js, collects anonymous usage data by default, and Shukatsu switches that off for the app's build and run commands.
