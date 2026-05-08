# Mirror — iranopasmigirim

A browser extension that lets you read [iranopasmigirim.com](https://iranopasmigirim.com)
from inside Iran by pulling a periodically-updated, **cryptographically signed**
copy of the site from a public GitHub repository.

## How it works

```
                +---------------+              +-------------------+
[ Live site ]──>| GitHub Action |──[signed]──> | GitHub repo: main |
                +---------------+              +-------------------+
                                                        │
                                          (raw.githubusercontent.com)
                                                        │
                                                        ▼
                                          +─────────────────────────+
                                          | Extension (this repo)   |
                                          |   • polls tree SHA      |
                                          |   • verifies signature  |
                                          |   • caches IndexedDB    |
                                          |   • redirects → ext URL |
                                          +─────────────────────────+
                                                        │
                                                        ▼
                                                   Your browser
```

Two halves, run independently:

1. **Mirror side** (a GitHub Action or a cron job): scrapes the live site,
   commits the result to a public repo, **signs the commit** with a key
   you control.
2. **Reader side** (this extension): polls the repo every ~5 min, verifies
   the signature, downloads only the changed files, and serves them inside
   the browser at `chrome-extension://<id>/site/`.

GitHub and `raw.githubusercontent.com` are reachable from Iran. The data
plane (raw downloads) has no rate limit. The metadata plane (the GitHub
API tree+commit endpoints) costs at most one request per poll, well
under the 60/hr unauthenticated limit.

## Trust model

The extension's `src/config.js` ships an array of `TRUSTED_SIGNERS` — GPG key
fingerprints of accounts allowed to publish updates. Before ingesting a
single byte, the extension:

1. Fetches the tip commit's `verification` block from the GitHub API.
2. Confirms `verification.verified === true` (GitHub's own attestation).
3. Extracts signer identity from the detached OpenPGP signature packet and
  confirms it **matches one of the pinned fingerprints/key-ids in
  `TRUSTED_SIGNERS`**.

If any step fails the sync is aborted and the previous good cache is left
in place. **Rotating keys requires shipping a new extension version** —
there is intentionally no in-extension key-update path, because that
update path is exactly the surface a censor would target.

The extension never sends a request to `iranopasmigirim.com`. Only
`api.github.com` and `raw.githubusercontent.com` are in the host
allowlist, enforced by manifest permissions and CSP.

## Build

```bash
./bootstrap.sh          # npm install
./build.sh test         # 56 unit tests
./build.sh              # builds dist/chrome and dist/firefox
./build.sh chrome       # just chrome
./build.sh firefox      # just firefox

# release build gate (fails on insecure config)
./build.sh release
```

The build produces `dist/chrome/` (MV3) and `dist/firefox/` (MV2). The
service worker, popup script, manifest, HTML, CSS, and icons are all
staged in.

## Install (development)

### Chrome / Edge / Brave

1. `npm run build:chrome`
2. Open `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `dist/chrome/` folder

### Firefox

1. `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on…"
4. Pick any file inside `dist/firefox/`

## Set up the mirror repo

1. Create a public GitHub repo (e.g. `your-name/iranopasmigirim`).
2. Generate a GPG key on a trusted machine:
   ```bash
   gpg --full-generate-key      # 4096-bit RSA, no expiry, real email
   gpg --list-secret-keys       # note the long key ID
   gpg --armor --export-secret-keys <KEYID> > private.asc
   gpg --fingerprint <KEYID>    # 40-char hex fingerprint
   ```
3. Add `private.asc` content to the repo's secrets as `GPG_PRIVATE_KEY`,
   and the passphrase as `GPG_PASSPHRASE`.
4. Upload the **public** key to your GitHub account (Settings → SSH and
   GPG keys → New GPG key) so GitHub can mark commits `verified=true`.
5. Copy `.github/workflows/mirror.yml` from this repo into the mirror
   repo's `.github/workflows/`.
6. Edit `src/config.js` in the **extension repo** (this one):
   - Set `GITHUB_OWNER` and `GITHUB_REPO`.
   - Set `TRUSTED_SIGNERS` to `[<your fingerprint>]`.
   - Flip `ALLOW_UNPINNED_SIGNATURES` to `false`.
7. Rebuild and reinstall the extension.

## Producer App (your side)

The producer app is in `pusher/mirror_and_push.py`.

It provides a clean CLI:
- `init` creates config
- `doctor` validates tools/config
- `run-once` runs one full cycle (scrape -> sanitize -> signed commit -> push)
- `daemon` runs continuously on a schedule

### Step-by-step setup (Linux VPS)

1. Install dependencies:
```bash
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends python3 python3-venv git gpg httrack
```

2. Create runtime user and clone mirror repo:
```bash
sudo useradd -r -m -s /usr/sbin/nologin mirror || true
sudo -u mirror mkdir -p /srv/mirror-repo
sudo -u mirror git clone <your-mirror-repo-url> /srv/mirror-repo
```

3. Install producer app binary and configs:
```bash
sudo cp pusher/mirror_and_push.py /usr/local/bin/
sudo chmod 755 /usr/local/bin/mirror_and_push.py
sudo mkdir -p /etc/mirror
sudo cp pusher/mirror.toml.example /etc/mirror/mirror.toml
sudo cp pusher/mirror.service pusher/mirror.timer /etc/systemd/system/
```

4. Edit `/etc/mirror/mirror.toml`:
- set `target_url`
- set `repo_path`
- set `signing_key`
- set `git_branch`
- review blocklists for `block_payment_domains` and `block_stream_extensions`

5. Store passphrase securely (if key has one):
```bash
cat <<'EOF' | sudo tee /etc/mirror/secrets.env >/dev/null
GPG_PASSPHRASE=your-passphrase-if-needed
EOF
sudo chmod 600 /etc/mirror/secrets.env
sudo chown root:root /etc/mirror/secrets.env
```

6. Validate setup:
```bash
sudo -u mirror /usr/local/bin/mirror_and_push.py --config /etc/mirror/mirror.toml doctor
```

7. Run first cycle manually:
```bash
sudo -u mirror /usr/local/bin/mirror_and_push.py --config /etc/mirror/mirror.toml run-once
```

8. Enable periodic automatic runs:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mirror.timer
sudo journalctl -u mirror.service -f
```

The unit is hardened (`ProtectSystem=strict`, `NoNewPrivileges`, etc.) and the producer app is single-instance locked.

## Browse the mirror

After installing, open `chrome-extension://<your-id>/site/` (or click "Open
mirror" in the popup), or just type `iranopasmigirim.com` into the address
bar — the extension's redirect rule will take you to the cached copy.

## What does NOT work

- **Search forms, login, comments, anything that posts data.** The mirror
  is read-only by design.
- **Live content.** Whatever's on the live site at the moment of the last
  scrape is what you see; pages added in between won't appear until the
  next mirror cycle.
- **Pages > 10 MB.** Per-file cap. Real site pages should never be this big.
- **Sites with > 2000 files.** Per-sync cap. Bump if you really need it.

## Project layout

```
src/
  background/
    service-worker.js   # entry: alarms, fetch, message routing, DNR rule install
    sync.js             # incremental sync engine + backoff
    github.js           # API + raw fetches + signature verification
    serve.js            # cache → Response (with <base href> injection)
    db.js               # IndexedDB wrapper
    mime.js             # extension → MIME table
  popup/
    popup.html
    popup.js
    popup.css
  config.js             # constants — edit before release
manifest.json           # Chrome MV3
manifest_firefox.json   # Firefox MV2
build.js                # esbuild driver
.github/workflows/
  mirror.yml            # COPY into the mirror repo, not used here
pusher/
  mirror_and_push.py    # producer CLI app (init/doctor/run-once/daemon)
  mirror.toml.example   # producer config template
  README.md             # producer quick reference
  mirror.service        # systemd unit
  mirror.timer
test/                   # 56 unit tests, no browser needed
```
