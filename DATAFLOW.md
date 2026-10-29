# Data flow

Shukatsu holds a job seeker's full work history, their applications, and the conversations of the family and mentors who help them. This page says what leaves the machine it runs on, where it goes, and why, and it is written to be read without knowing the code. If something here stops being true, the code is wrong and this page is right. `shukatsu/tests/dataflow.spec.mjs` fails when a connector, a host one may reach, or a module that calls out isn't named here.

## The short version

Shukatsu runs on a computer you own, and its author runs no server. The author receives nothing from your copy, because there is no account with the author, no analytics, no crash reporting and no telemetry. By default the only traffic that leaves the machine is the encrypted connection that lets the people you invited reach the app, and everything else is something you turn on yourself.

## What leaves, where it goes, and why

| Where | What | Why |
|---|---|---|
| **Anthropic API** (`api.anthropic.com`), only when `ANTHROPIC_API_KEY` is set | One resume bullet, its role heading and title, and up to 6,000 characters of the job posting, each time someone presses "Suggest wordings" on a packet | To get three reworded versions of that bullet. Nothing else from the record, no names of the people using the app, no contacts |
| **Gmail** (`gmail.googleapis.com`, `oauth2.googleapis.com`), only after the candidate connects it | A mail search and the sign-in with Google, using the candidate's own Google Cloud app with read-only permission | To find replies from employers, hiring systems and the school's job platforms, so they can be matched to applications |
| **A calendar feed's own host** (for example the Canvas feed), only after the candidate pastes the address | One request to download the calendar, carrying only what the link itself identifies | So classes and exams count as busy time when an interview is scheduled |
| **LINE** (`api.line.me`), only after the candidate connects it | The weekly digest to each person who linked their own LINE account: by default a nudge with dates, three counts and a link, or the full digest if the candidate chooses it. When the candidate asks someone to look at something, or uses or sets aside what they sent back, one fixed line and a link to that ask. Never compensation or contacts | So the people helping hear about the week, and about what was asked of them, without opening the app. LINE's operator stores what is sent (see LINE, below) |
| **The employer's application page**, when the candidate presses Fill | The answers that go into that form: name, email, phone, links, school, the resume PDF, and answers the candidate stated in `data/form-answers.yml` | So the candidate doesn't type them again. The employer's page holds them from that moment (see Filled application forms, below) |
| **Tailscale or Cloudflare**, whichever you choose to let invited people in | The encrypted connection between each person's browser and the machine | So family and mentors can open the app from their own phones and computers |
| **An agent you name** (Claude Code, claude.ai, or another MCP client) | Whatever that agent's operations return: the record, the tracker, packets, the calendar and the inbox | So the agent can do the work you gave it, and it never sees compensation or contacts unless you tick that box for that agent |
| **The address an MCP client gives as its ID**, when it signs in through OAuth | One request for that client's public description (its name and where to send you back after you approve it), carrying nothing about you | So the consent screen can show which client is asking. Only https addresses on the public internet are fetched, once an hour at most per client |
| **Calendar apps that subscribe** (Apple Calendar, Google Calendar, Outlook) | The schedule behind one private link, fetched about once an hour | So interviews and deadlines show up in the calendar app. Each link is for one person and can be revoked alone |
| **Your backup disk** | A snapshot of the data root and the app database | So a dead machine loses nothing. Point it at an encrypted disk you own |
| **The data root's private remote**, only if you add one | What you commit in the data root: the record, the tracker, resume recipes, archived postings and the resumes themselves. Never `.shukatsu/`, which git ignores | So the history survives a dead machine. It must be private and yours |
| **GitHub**, when you update | A `git fetch` of the code, and the career-ops update check | To pull new versions of the app and of the career-ops engine |

Applications are never sent by Shukatsu. You submit them yourself, on the employer's own page, and then mark them sent.

## Who sees what

The candidate is the owner and sees everything. The people the candidate invites see what their role allows (`shukatsu/core/people.mjs` has the full table): editors and reviewers read the record and the applications and add their own suggestions, and viewers read only. Nobody but the candidate can change the record, the tracker, or who has access, and nobody at all can submit an application from here.

Family and mentors reach the app through the tunnel or tailnet you set up, with an account you invited them to. Sign-in is a password (stored only as a scrypt hash) or a passkey, and there is no public sign-up. Tailscale is end-to-end encrypted between the devices on your tailnet. A Cloudflare Tunnel decrypts the traffic at Cloudflare's edge before passing it to your machine, so Cloudflare can see it while it passes through. If that matters for the people you invite, use Tailscale or put Cloudflare Access in front.

## Where things are kept

Everything is on the machine, in the data root: your private git repo. By default it has no remote. You may give it one, so its history survives the machine, as long as the remote is private and yours: a private GitHub repository, or a bare repo on a disk or server you control. Whoever hosts that remote can read everything you commit to it. Never give the data root a public remote, and never commit anything from it to this repository, which is public.

| What | Where | Who can see it |
|---|---|---|
| Every achievement, with its evidence | `data/career-profile.yml` | Everyone signed in. Evidence file paths: the candidate only |
| Generated resumes, archived job postings | `output/`, `jds/` | Everyone signed in |
| The application tracker and its status history | `data/applications.md`, `data/status-log.tsv` | Everyone signed in |
| Accounts, password hashes, passkeys, sessions | `.shukatsu/app.db` (never in git) | Nobody reads hashes. People are listed to the candidate only |
| Proposals, comments, packets, the activity log | `.shukatsu/app.db` | Everyone signed in, except account changes (candidate only) |
| What connectors copied in, and their sign-ins | `.shukatsu/sync.db` (never in git) | The candidate, and agents the candidate allowed |
| Compensation targets | `config/profile.yml` | Not shown in the app today. The per-person "can see compensation" grant on the People page is the switch any future view will honor |
| Contacts | `data/contacts.tsv` | The candidate only. The app never shows them |
| Stated form answers (work authorization, demographics and the like) | `data/form-answers.yml` | The candidate, and the employer's form when the candidate presses Fill |
| Confirmations made in review | `sources/review-log.md`, plus one git commit per change | Everyone signed in (the log), the candidate (the git history) |

The data root's `.gitignore` keeps `.shukatsu/` out of git, so it never reaches a remote. Credentials that connectors store are encrypted with a key kept in the Mac's Keychain, or in a private file under `~/.config/shukatsu/` on Linux. The key is never in the data root, so backups and git history carry no password.

## The egress log

Every call the app makes to an outside service writes one line to `.shukatsu/egress.log` with the time, who triggered it, the host or model, the sizes and the status. It never holds the text that was sent, a link's path, a password or a token. Three modules make those calls, and all three write the log through `shukatsu/core/egress.mjs`:

- `shukatsu/core/llm.mjs`, the model call, and nothing else calls a model.
- `shukatsu/connectors/ctx.mjs`, the wrapper every connector request goes through. It refuses anything that is not HTTPS or not on that connector's list of allowed hosts: Gmail may reach only `gmail.googleapis.com` and `oauth2.googleapis.com`, LINE only `api.line.me`, and the calendar feed connector only the host of the feed you gave it.
- `shukatsu/core/oauth.mjs`, for an MCP client's public description, through a guard that resolves the address first and refuses private and local ones.

## Agents

An agent the candidate names on the Agents page (Claude Code, claude.ai) reaches Shukatsu with a key or through OAuth, and reads whatever its operations return: the record, the tracker, packets, the calendar, and the inbox. When the agent runs on a hosted model, the model's provider receives those results as part of the conversation. Agents never see compensation or contacts unless the candidate ticks that box for that agent, and they can never confirm a fact, accept a proposal, mark something sent, or change who has access. Every change an agent makes is in the activity log under its name, and revoking its key or disabling it on the Agents page cuts it off at once.

## Connectors

Connectors bring outside data in, or send the digest out. Each is off until the candidate connects it on the Connections page (Settings), each can only reach the internet addresses listed for it, and every request it makes adds a line to the egress log.

What they copy lives in `.shukatsu/sync.db`, beside `app.db` and never in git. It holds copies that can always be fetched again, so deleting it loses nothing that can't come back.

Nothing a connector reads writes the record. A message or event is read for a signal (for example "this looks like an interview invitation for application 12"), and a signal only proposes a change. The candidate, or an agent the candidate allowed, makes the change through the app's ordinary actions, which check permissions and appear in the activity log under that person's or agent's name.

### Calendar feed (`ics-in`)

- **What arrives.** The events in a calendar feed the candidate pastes in, such as the Canvas calendar feed: class times, exam times, and due dates, with titles, places, and descriptions as the school wrote them.
- **What leaves.** One request to the feed's own host to download the calendar. Nothing about the candidate is sent except what that link itself identifies. The feed link is a private key to the candidate's calendar, so it is kept encrypted and never shown again after it is saved.
- **Who can see it.** Classes and exams count as busy time when an interview is being scheduled, and due dates are listed beside them. The copied events themselves are read only by the candidate and by agents the candidate allowed. Other people on the app do not see them.
- **How to remove it.** Connections, then Remove, deletes the feed, its link, and every event copied from it. "Delete copies from Calendar feeds" keeps the feed and deletes the copies.

### Gmail (`gmail`)

- **What arrives.** Only mail that matches a search. The search asks for mail from the hiring systems employers use (Greenhouse, Lever, Workday, and similar), from the school's job platforms (NUworks, Handshake, the career fair site), from the four LinkedIn addresses that write about applications and messages (never LinkedIn's other mail), from the websites of companies in the tracker and campaigns, and mail whose subject has words such as interview, assessment, application, offer, 面接, or 選考. For each match Shukatsu keeps who sent it, who it went to, the subject, the time, the text (cut off at 20,000 characters), and the links in it. It never fetches attachments, and the rest of the mailbox stays in Google.
- **What leaves.** Requests to `gmail.googleapis.com` (the search and the matching messages) and `oauth2.googleapis.com` (sign-in and renewing it). The search words are sent to Google, which already holds the mail. The candidate's own Google Cloud app (client id and secret) is used for this, and its permission is read-only (`gmail.readonly`), so Shukatsu cannot send, delete, or change mail.
- **Who can see it.** Messages hold other people's names and addresses. They are read only by the candidate and by agents the candidate allowed. When an agent reads one, the text goes to whichever AI provider runs that agent, and the app marks it as outside text so the agent treats it as information and not as instructions.
- **How to remove it.** "Delete copies from Gmail" deletes the messages and signals but keeps the connection. Remove deletes the connection and its sign-in. To end Google's side of it, the candidate also removes Shukatsu under their Google account's third-party access. A Google Cloud app left in Testing mode loses its sign-in every 7 days, so the Connections page asks the candidate to publish it as an unverified app for their own account.

### Browser extension (`browser`)

- **What arrives.** Pages of NUworks, Handshake, and CareerForum.Net that the candidate opens in their own browser, read as they load. The extension never clicks, scrolls, types, or loads anything on those sites, so the sites see only the candidate's normal browsing. It first sends Shukatsu a page's address alone. Only for the kinds of page Shukatsu lists (a posting, the candidate's own applications list, a message thread) does it then send the page's title, visible text (cut off at 20,000 characters), and links. For every other page on those sites, Shukatsu keeps the path with its numbers removed (`/stu/users/:id`) and a count, and the page's text never leaves the browser.
- **LinkedIn is never read.** LinkedIn's User Agreement bans browser extensions that copy its pages, so the extension runs nothing there: no reader and no Fill. Its toolbar button sends only the page's address, which waits in the inbox until the candidate gives the employer's own posting or pastes the text by hand. LinkedIn still reaches Shukatsu through its mail (see Gmail).
- **What leaves.** Nothing leaves the machine. The extension sends pages only to the candidate's own Shukatsu, at the address set in its options, and the connector makes no request of its own. It uses a capture key, which saves pages and postings and, for Fill, reads the answers that go into a form.
- **Who can see it.** Message threads and some postings hold other people's names. Like messages, these pages are read only by the candidate and by agents the candidate allowed, and they are marked as outside text. A posting waits in the inbox until someone presses Save, which archives its text as the job description.
- **How to remove it.** Pause or turn off reading per site in the extension's options, or pause it on the Connections page. "Delete copies from Browser extension" deletes the pages, and Remove turns it off and deletes everything it kept. Revoking the capture key under Agents stops the extension at once.

### LINE (`line`)

This connector sends out rather than reading in.

- **What leaves.** To `api.line.me` only: once a day, a check of who the LINE account is (which proves the token still works); each week, the digest to every linked person who still has access, in nudge or full form; when the candidate asks a person to look at one answer or one fact's Japanese, and again when the candidate uses or sets aside what they sent, one message to that person only, always a nudge: a fixed line ("Something is waiting for you to look at", "What you looked at was used") and a link to the ask, with nothing about the application, the question, or the note; and a short fixed reply when someone messages the account. A **nudge** (the default) carries the week's dates, three counts, and a link to the app, with no company, role, or name in it. **Full** carries the digest itself: companies, roles, status changes, and the names of the people who helped that week. Never compensation or contacts. A digest goes to a person's LINE account by the id LINE gave it, which Shukatsu keeps in `.shukatsu/app.db` and never shows on any page. Messages from an Official Account aren't end-to-end encrypted, so LINE's operator (LY Corporation) stores whatever is sent.
- **What arrives.** LINE posts to `/connectors/line/webhook` when someone adds, blocks, or messages the account, signed with the channel secret; anything unsigned is refused. A six-digit code links the sender to the person who asked for it in their own Settings (it works once, for 15 minutes, and guessing is limited). Blocking the account unlinks them. Shukatsu keeps no message text: anything that isn't a code gets a reply asking them to use the app, and is dropped.
- **Who can see it.** The candidate sees who is linked, on the Connections page. Each person sees only their own link. Agents can't link, unlink, or send.
- **How to remove it.** A person unlinks themselves in Settings, or by blocking the account in LINE. The candidate unlinks anyone, pauses LINE, or removes it on the Connections page, which deletes the channel secret and token. Removing someone's access stops their digest at once. To end LINE's side, delete the Official Account in LINE Official Account Manager: messages already sent stay in each person's LINE until they delete them.

## Filled application forms

When the candidate presses Fill on an application form, the extension gets that form's answers from Shukatsu and types them into the employer's page: name, email, phone, links, school, the resume PDF, and any answers the candidate has stated in `data/form-answers.yml` (work authorization, demographics, and the like, which come only from there). The employer's page holds them from that moment. Some sites save a draft or read fields before Submit is pressed, so filling a form counts as giving it to that employer. Shukatsu itself sends them nowhere, and no model sees the form. The capture key that asks for these answers can read the candidate's contact details and stated answers, so it belongs in the extension only.

Fill knows Greenhouse, Lever, and Ashby by their field names, and on any other site it goes by the form's own labels, except LinkedIn, where it never runs. Preview (Alt+Shift+P) plans the same way and writes nothing to the page, so nothing reaches the employer.

"Remember my answers" on the panel sends what the candidate typed by hand on that form to their own Shukatsu, never anywhere else. It waits in `.shukatsu/app.db` as a suggestion, and only becomes an answer when the candidate accepts it on the Form answers page, which writes `data/form-answers.yml` and commits it to the data root's own history.

## Phone calls, recordings and the browser

Shukatsu does not record, transcribe or place phone calls, and it has no microphone access (the app's security headers turn the microphone, camera and location off). The phone calls on the product page mean the habit of relatives calling with suggestions, which the review queue replaces. A phone number appears only if the candidate puts it in the resume header.

The app serves its own pages, scripts and fonts. The fonts are downloaded once when the app is built and served from your machine, so opening a page makes no request to Google or anyone else. The app's content security policy only allows connections back to itself.

## Postings

Postings come from the people using the app. The candidate, editors, reviewers and agents suggest a posting by URL, which saves only the link. "Send to Shukatsu" (the extension's toolbar button, or the bookmarklet) saves the text of the page the candidate is reading into the data root, and it sends nothing anywhere else. On LinkedIn it saves the address alone, as above. The daemon does not fetch job sites or scan boards.

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

"Remove access" on the People page signs that person out everywhere at once, stops their sign-in links from working, and stops their LINE digest. Their past comments and proposals stay, credited to them, because the record of who suggested what is part of the history. To erase a person entirely, the candidate deletes their row from `.shukatsu/app.db`.

To delete everything, delete the data root (`.shukatsu/` is inside it), its private remote if you gave it one, and its backups; remove Shukatsu under your Google account's third-party access if you connected Gmail; and delete the LINE Official Account if you made one.

## What is never collected

Shukatsu has no telemetry, no analytics and no crash reporting, and it makes no request to any server run by its author. The framework it is built with, Next.js, collects anonymous usage data by default, and Shukatsu switches that off for the app's build and run commands.
