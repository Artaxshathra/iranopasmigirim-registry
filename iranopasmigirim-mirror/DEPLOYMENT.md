# Deployment Quick Reference

Fast lookup for common setup and deployment tasks.

## Setup Checklists

### ✅ Local Development (5 minutes)

- [ ] Clone repo: `git clone ...iranopasmigirim-mirror`
- [ ] Install deps: `npm install`
- [ ] Run tests: `npm test` (should see 77/77 passing)
- [ ] Build Chrome: `npm run dev:chrome`
- [ ] Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`
- [ ] Click extension icon to test UI
- [ ] Done! Ready to code

### ✅ Single Registry Setup (30 minutes)

Goal: Set up central registry repo that producers and users connect to.

- [ ] Create GitHub repo: `iranopasmigirim-registry` (public)
- [ ] Clone: `git clone ...iranopasmigirim-registry`
- [ ] Create branches: `git checkout -b requests && git push -u origin requests`
  - Also: `registrations`, `approvals`, `deliveries`
- [ ] Add `registry-config.json` with your GitHub username
- [ ] Add `keys/` directory, place producer public key there
- [ ] Test accessibility: `curl https://api.github.com/repos/YOUR_USER/iranopasmigirim-registry`
- [ ] Done! Registry ready

### ✅ Producer Setup (45 minutes)

Goal: Deploy producer server that monitors requests and mirrors content.

- [ ] Ensure Python 3.8+, GPG installed
- [ ] Create GPG key (or use existing): `gpg --gen-key`
- [ ] Get fingerprint: `gpg --list-keys` (grab the 16-char hex)
- [ ] Create config: `~/.config/iranopasmigirim-producer/config.toml`
  - Set `registry_owner`, `gpg_fingerprint`, `mirror_cache_dir`
- [ ] Create whitelist: `~/.config/iranopasmigirim-producer/whitelist.json`
- [ ] Create cache dir: `sudo mkdir -p /var/lib/iranopasmigirim/cache`
- [ ] Test manually: `python3 pusher/mirror_and_push.py --config ~/.config/... --dry-run`
- [ ] Create systemd service + timer (copy from OPERATIONS.md)
- [ ] Start timer: `sudo systemctl start iranopasmigirim-producer.timer`
- [ ] Verify: `sudo systemctl status iranopasmigirim-producer.timer`
- [ ] Done! Producer running every 5 min

### ✅ User Installation (10 minutes)

Goal: Get one user up and running with the extension.

- [ ] Build extension: `npm run build:chrome` (or `build:firefox`)
- [ ] Update `src/config.js` with registry details (owner, repo)
- [ ] Rebuild if changed config: `npm run build:chrome`
- [ ] Load in browser:
  - Chrome: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`
  - Firefox: `about:debugging` → Load Temporary → select `dist/firefox/manifest.json`
- [ ] Click extension icon
- [ ] Paste registry repo URL (e.g., `https://github.com/YOUR_USER/iranopasmigirim-registry`)
- [ ] Click "Save Configuration"
- [ ] Done! Extension ready to use

---

## Diagnostic Commands

### Check Producer Status

```bash
# Is timer running?
sudo systemctl status iranopasmigirim-producer.timer

# Last 50 lines of logs
sudo journalctl -u iranopasmigirim-producer.service -n 50

# Watch logs in real-time
sudo journalctl -u iranopasmigirim-producer.service -f
```

### Test GitHub Connectivity

```bash
# Can producer reach GitHub?
curl -I https://api.github.com

# Can producer reach your registry?
curl https://api.github.com/repos/YOUR_USER/iranopasmigirim-registry \
  | grep -E '"private"|"pushed_at"'

# List requests in registry
curl https://api.github.com/repos/YOUR_USER/iranopasmigirim-registry/contents/requests \
  -H "Accept: application/vnd.github.v3+json"
```

### Test GPG Signing

```bash
# List your GPG keys
gpg --list-keys

# Export public key
gpg --armor --export AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1

# Test signing a file
echo "test" | gpg --clearsign

# Verify signature
gpg --verify file.sig
```

### Debug Extension (Browser Console)

```javascript
// In extension service worker context (F12 → Console):

// Check stored config
const db = await indexedDB.databases();
console.log(db);

// Try manual sync
chrome.alarms.get('sync', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('sync', { periodInMinutes: 10 });
    console.log('Manual sync triggered');
  }
});

// Check recent errors
chrome.runtime.getBackgroundPage(bg => {
  bg.console.log('Service worker logs...');
});
```

---

## File Locations Quick Map

```
📦 iranopasmigirim-mirror/           Main repository
├── 📄 OPERATIONS.md                  ← Full deployment guide (start here!)
├── 📄 README.md                      ← This project overview
├── src/
│   ├── background/                   Extension runtime (service worker, sync, db)
│   ├── popup/                        Extension UI (configuration, status)
│   └── config.js                     ← Edit for registry URL & signer fingerprint
├── pusher/
│   └── mirror_and_push.py            Producer executable
├── dist/
│   ├── chrome/                       ← Load this in Chrome
│   └── firefox/                      ← Load this in Firefox
├── test/                             Extension tests (77 tests)
└── scripts/
    └── test-local.sh                 Quick build + load helper

📁 ~/.config/iranopasmigirim-producer/
├── config.toml                       ← Producer configuration
├── whitelist.json                    ← Sites allowed to mirror
└── keys/                             GPG keys

📁 /var/lib/iranopasmigirim/cache/    Mirror cache (producer writes here)
📁 /var/log/iranopasmigirim-producer/ Producer logs

📦 iranopasmigirim-registry/          Central registry (users don't need to clone)
├── requests/                         User requests live here
├── registrations/                    Ownership proofs
├── approvals/                        Intermediate approval status
├── deliveries/                       ← Extension syncs from here
└── keys/
    └── producer-public.asc           Signer public key
```

---

## Common Fixes

### "Manifest file is missing" when loading src/

**Problem:** You loaded `src/` folder in `chrome://extensions/`, but manifests are generated during build.

**Fix:** Load the *built* folder instead:
```bash
# Build first
npm run dev:chrome

# Then load dist/chrome (not src/)
# chrome://extensions → Load unpacked → dist/chrome
```

### Producer stuck, not processing requests

**Problem:** Requests aren't being processed.

**Steps:**
1. Check timer: `sudo systemctl status iranopasmigirim-producer.timer`
2. Check logs: `sudo journalctl -u iranopasmigirim-producer.service -f`
3. Test manually: `python3 pusher/mirror_and_push.py --config ~/.config/iranopasmigirim-producer/config.toml --dry-run`
4. Check network: `curl https://api.github.com`
5. Verify config file exists and is readable

### Extension won't sync / shows "Failed to fetch registry"

**Problem:** Extension can't connect to registry.

**Steps:**
1. Check registry URL in extension UI (should be HTTPS, not SSH)
2. Verify registry is public: `curl https://api.github.com/repos/YOUR_USER/iranopasmigirim-registry | grep "private"`
3. Clear extension data: Popup → Storage → Clear All
4. Reload extension: Press F5 in `chrome://extensions/`

### Signature verification fails

**Problem:** Delivery won't open, shows "Signature verification failed"

**Steps:**
1. Verify producer key is in registry: `curl https://raw.githubusercontent.com/YOUR_USER/iranopasmigirim-registry/main/keys/producer-public.asc`
2. Check fingerprint matches in `src/config.js`
3. Rebuild extension: `npm run build:chrome`
4. Reload extension: F5 in `chrome://extensions/`

---

## Environment Variables

Producer can read environment instead of config file:

```bash
export IRANOPASMIGIRIM_GITHUB_TOKEN="ghp_..."
export IRANOPASMIGIRIM_REGISTRY_OWNER="your_username"
export IRANOPASMIGIRIM_REGISTRY_REPO="iranopasmigirim-registry"
export IRANOPASMIGIRIM_GPG_FINGERPRINT="AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1"
export IRANOPASMIGIRIM_GPG_PASSPHRASE="your_passphrase"

python3 pusher/mirror_and_push.py
```

---

## Performance Tuning

### Producer Slow / Timing Out

If producer takes >5min per cycle:

```toml
# In config.toml
[producer]
requests_per_run = 2           # Process fewer requests per cycle
max_mirror_size_mb = 250       # Don't mirror huge sites
request_delay = 1              # Decrease delay between scrapes

[github]
# Add GitHub token for higher rate limits
token = "ghp_YOUR_TOKEN_HERE"
```

Then restart: `sudo systemctl restart iranopasmigirim-producer.service`

### Extension Slow / High Memory

If extension uses lots of RAM:

1. Clear old mirrors: Popup → Storage → Remove unused sites
2. Reduce cache: `src/config.js` set `MAX_STORAGE_MB` lower
3. Rebuild: `npm run build:chrome`

---

## Rollback Procedures

### Revert Failed Delivery

If bad mirror pushed to registry:

```bash
cd /path/to/iranopasmigirim-registry

# Find bad commit
git log --oneline deliveries -n 20

# Revert
git revert COMMIT_HASH

git push origin deliveries

# Extension will auto-detect revert and not sync bad version
```

### Recover from Storage Corruption

Extension stored file is corrupt?

```javascript
// In browser console (extension context):

// Option 1: Delete one site's cache
const db = await indexedDB.open('mirror-storage');
const tx = db.transaction('files', 'readwrite');
const store = tx.objectStore('files');
await store.delete('news-example-com');

// Option 2: Nuke everything
await store.clear();
await db.close();

// Extension will re-sync from registry next cycle
```

---

## Scaling to Multiple Producers

Each producer signs with its own key:

```
registry/
├── keys/
│   ├── producer-1.asc  (fingerprint: AAA...)
│   ├── producer-2.asc  (fingerprint: BBB...)
│   └── producer-3.asc  (fingerprint: CCC...)
└── deliveries/
    ├── site-1/  (signed by producer-1)
    ├── site-2/  (signed by producer-2)
    └── site-3/  (signed by producer-3)
```

Extension config:

```javascript
export const TRUSTED_SIGNERS = [
  { name: 'Producer 1', fingerprint: 'AAA...' },
  { name: 'Producer 2', fingerprint: 'BBB...' },
  { name: 'Producer 3', fingerprint: 'CCC...' },
];
```

Each producer verifies with its own key; users benefit from redundancy.

---

## References

- **Full setup guide:** [OPERATIONS.md](../OPERATIONS.md)
- **Build & development:** [README.md](README.md)
- **Extension code:** `src/background/`
- **Producer code:** `pusher/mirror_and_push.py`
- **Tests:** `test/`, `pusher/test_producer.py`

---

**Last Updated:** May 11, 2026  
**Version:** 0.2.0
