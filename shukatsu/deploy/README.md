# Running shukatsu at home

One small, always-on machine serves the app to the candidate and the people they invite.
Any of these works: an Apple silicon Mac mini, or an x86 mini PC running Linux. What it
needs is modest: Node 22.13 or newer (for the built-in `node:sqlite`), `git`, `unzip`,
4 GB of RAM, and a few GB of disk. Next to nothing runs until someone opens a page.

Two repos live on the machine:

- the engine: this fork, `pockanoodles/shukatsu` (public), and
- the data root: the candidate's private repo (`~/Projects/resume` on the laptop), which
  has no remote by default. A private remote the candidate owns is allowed; a public one
  never is.

When the machine exists, add it to `~/Projects/homelab/inventory.toml` like any other
device: its own SSH key, Remote Login, and the sleep setting checked by `bin/check`. Per
the homelab placement rule, put it somewhere the candidate administers: whoever runs a
machine can read all of it.

## 1. Put both repos on the machine

```sh
git clone https://github.com/pockanoodles/shukatsu.git ~/shukatsu
# Make the server's copy the primary, cloned once from the laptop (this works with or without a remote):
git clone laptop:Projects/resume ~/resume          # over SSH, from the machine
echo "$HOME/resume" > ~/shukatsu/.career-ops-data   # the engine finds it through this marker
```

The server's copy is now the primary: the app commits every confirmed change there. The
laptop keeps a clone of it (`git clone mini:resume ~/Projects/resume` once the server
exists) and pulls before working. For CLI work, the simplest rule is to run the CLI on the
server (`ssh mini 'cd shukatsu && node shukatsu/review.mjs'`), so there is one writer. If you
do edit on the laptop, commit there and `git pull` on the server from the laptop's clone;
a simultaneous edit to `career-profile.yml` on both sides shows up as a normal git merge
conflict, never as lost work.

## 2. Install and build

```sh
cd ~/shukatsu && npm ci                 # the engine's own dependencies
cd shukatsu && npm ci && cp .env.example .env
$EDITOR .env                            # SHUKATSU_URL, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
npm run build
```

## 3. Create the owner

There is no public sign-up page. The first account is made from the machine:

```sh
cd ~/shukatsu && SHUKATSU_URL=https://your-address node shukatsu/people.mjs init --name "Sam Candidate"
```

It prints a link that works once, for 24 hours. Open it, choose a login and password, and
add a passkey from Settings on each device you use.

## 4. Run it as a service

- Linux: `deploy/shukatsu.service` (systemd, with the filesystem locked to the two repos).
- macOS: `deploy/com.shukatsu.app.plist` (launchd agent).

Both bind `127.0.0.1:3000`. Nothing listens on the network directly; the next step decides
who can reach it.

## 5. Let the family in

Pick one:

**Tailscale (private).** Everyone who uses the app joins the tailnet: the Tailscale app on
each phone, signed in with an account you share the machine with. Then
`tailscale serve --bg 3000` gives the app an HTTPS address on `*.ts.net`, which passkeys
need. Set `SHUKATSU_URL` to that address. Nothing is reachable from the open internet. The
cost is one more app for parents to install.

**Cloudflare Tunnel (public address, no open ports).** `deploy/cloudflared.yml` routes a
hostname you own to the app. Anyone can load the landing page; everything else needs an
invite. For a second lock, put Cloudflare Access (email one-time codes for the invited
addresses only) in front. Set `SHUKATSU_URL` and `SHUKATSU_ALLOWED_ORIGINS` to the hostname.

Then invite people from the People page (or `node shukatsu/people.mjs invite --name Mom --role
editor --lang ja`) and send each link over LINE or iMessage.

**LINE (optional).** To send the weekly digest on LINE, connect it under Settings,
Connections; the page walks through the Official Account and shows the webhook address.
LINE has to reach that address from the internet, so with Cloudflare it just works (with
Access in front, `/connectors/*` is already on the bypass list). With Tailscale alone it
can't: either add `tailscale funnel` for that one path, or keep LINE off. Each person then
links their own LINE account from their Settings page.

## 6. Back it up

```sh
node shukatsu/deploy/backup.mjs ~/Library/Application\ Support/shukatsu/backups /Volumes/<encrypted-disk>/Backups/shukatsu --keep 14 --min-hours 20
```

It snapshots the app database (people, sessions, proposals, comments) while the app runs,
bundles the data root's whole git history, and tars the gitignored files worth keeping
(`jds/`, `output/`, the pipeline inbox), once into each target. The database holds password
hashes, so every target must be encrypted (an internal disk under FileVault counts). A
target on a disk that isn't plugged in is skipped, never created on the boot disk, and
`--min-hours` skips a target whose newest snapshot is younger than that.

On a Mac, `deploy/com.shukatsu.backup.plist` runs it nightly and again whenever a disk is
mounted, so an external disk that is attached only now and then still gets a snapshot. On
Linux, a daily cron line or systemd timer with the same command does the nightly part.

## 7. Updating

```sh
cd ~/shukatsu && git pull
node update-system.mjs check            # upstream career-ops releases, as on the laptop
cd shukatsu && npm ci && npm run build && npm test
sudo systemctl restart shukatsu         # or: launchctl kickstart -k gui/$(id -u)/com.shukatsu.app
```

The engine is loaded at runtime, not bundled, so any change under `shukatsu/core/` or the
upstream modules takes effect on restart.

## Checks

- `curl -s localhost:3000/api/health` answers `{"ok":true}` when the engine loads and the
  data root is readable.
- `node shukatsu/master.mjs validate` and `node shukatsu/review.mjs` work on the server
  exactly as on the laptop: same files, same engine.
