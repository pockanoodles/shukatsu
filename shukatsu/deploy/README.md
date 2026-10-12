# Running shukatsu at home

One small, always-on machine serves the app to the candidate and the people they invite.
Any of these works: an Apple silicon Mac mini, or an x86 mini PC running Linux. What it
needs is modest: Node 22.13 or newer (for the built-in `node:sqlite`), `git`, `unzip`,
4 GB of RAM, and a few GB of disk. Next to nothing runs until someone opens a page.

Two repos live on the machine:

- the engine: this fork, `pockanoodles/shukatsu` (public), and
- the data root: the candidate's private repo (`~/Projects/resume` on the laptop), which
  has no remote and must never get a public one.

When the machine exists, add it to `~/Projects/homelab/inventory.toml` like any other
device: its own SSH key, Remote Login, and the sleep setting checked by `bin/check`. Per
the homelab placement rule, put it somewhere the candidate administers: whoever runs a
machine can read all of it.

## 1. Put both repos on the machine

```sh
git clone https://github.com/pockanoodles/shukatsu.git ~/shukatsu
# The data root has no remote. Make the server's copy the primary, cloned once from the laptop:
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
cd ~/shukatsu && SHUKATSU_URL=https://your-address node shukatsu/people.mjs init --name "Kaito Soeno"
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

## 6. Back it up

```sh
node shukatsu/deploy/backup.mjs /Volumes/<encrypted-disk>/shukatsu --keep 14
```

It snapshots the app database (people, sessions, proposals, comments) while the app runs,
bundles the data root's whole git history, and tars the gitignored files worth keeping
(`jds/`, `output/`, the pipeline inbox). The database holds password hashes, so the target
must be an encrypted volume. Schedule it daily with cron or a second launchd agent.

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
