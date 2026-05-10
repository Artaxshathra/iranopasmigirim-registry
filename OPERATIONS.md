# Mirror System Operations Manual

Complete step-by-step guide for setting up and running the entire iranopasmigirim mirror ecosystem.

## Table of Contents

1. [System Architecture Overview](#system-architecture-overview)
2. [Quick Start (5-Minute Local Test)](#quick-start-5-minute-local-test)
3. [Production Setup](#production-setup)
   - [Phase 1: Registry Repository Setup](#phase-1-registry-repository-setup)
   - [Phase 2: Producer Server Setup](#phase-2-producer-server-setup)
   - [Phase 3: Extension Installation](#phase-3-extension-installation)
4. [User Onboarding](#user-onboarding)
5. [End-to-End Workflow](#end-to-end-workflow)
6. [Troubleshooting & Maintenance](#troubleshooting--maintenance)
7. [Advanced Configuration](#advanced-configuration)

---

## System Architecture Overview

The mirror system has **three components**:

```
┌─────────────────────────────────────────────────────────┐
│  GitHub (Central Registry Repository)                   │
│  ├── /requests/  (user requests)                        │
│  ├── /approved/  (approval status)                      │
│  └── /deliveries/ (signed mirror deliveries)            │
└──────────────────┬──────────────────────────────────────┘
                   │ (monitors)
                   │
        ┌──────────▼──────────┐
        │  Producer Server    │
        │ (systemd timer/py)  │
        └──────────┬──────────┘
                   │ (scrapes & signs)
                   │
        ┌──────────▼──────────────────┐
        │  Users' Mirror Requests     │
        │ (fork of registry repo)      │
        └──────────┬──────────────────┘
                   │
        ┌──────────▼──────────────────┐
        │  Browser Extension (Users)  │
        │ ├── Chrome (MV3)            │
        │ └── Firefox (MV2)           │
        └─────────────────────────────┘
```

**Data Flow:**

1. **User** creates request in their fork → pushes to GitHub
2. **Producer** detects request → verifies ownership → mirrors site → signs delivery → pushes to registry
3. **Extension** fetches delivery from registry → verifies signature → stores offline
4. **Extension** serves content offline when requested

---

## Quick Start (5-Minute Local Test)

Test the extension locally without full production setup:

### Prerequisites
- Node.js 18+
- `npm` available

### Steps

```bash
# 1. Navigate to repository
cd /path/to/iranopasmigirim-mirror

# 2. Build extension (Chrome)
npm run dev:chrome

# 3. Find the build output
echo "Chrome extension path: $(pwd)/dist/chrome"

# 4. Load in Chrome
# → Open chrome://extensions/
# → Enable "Developer mode" (top right)
# → Click "Load unpacked"
# → Select the dist/chrome folder
# → Done! Extension is now loaded

# For Firefox, replace step 2 with:
npm run dev:firefox
# Then load in about:debugging → Load Temporary Add-on → select dist/firefox/manifest.json
```

**Result:** Extension loads and shows in browser toolbar. Click icon to see configuration panel.

---

## Production Setup

### Phase 1: Registry Repository Setup

**Goal:** Create a central GitHub repository that acts as the mirror registry.

#### Step 1.1: Create Registry Repository on GitHub

1. Go to **github.com** and create a new repository:
   - Name: `iranopasmigirim-registry`
   - Description: "Central mirror registry for iranopasmigirim extension"
   - Visibility: **Public** (users need to read requests, deliveries, and registrations)
   - Initialize with README
   - Add .gitignore: select "Node"

2. Clone locally and set up branches:

```bash
git clone https://github.com/YOUR_USERNAME/iranopasmigirim-registry
cd iranopasmigirim-registry

# Create initial branch structure
git checkout -b requests
git commit --allow-empty -m "Initial requests branch"
git push -u origin requests

git checkout -b registrations
git commit --allow-empty -m "Initial registrations branch"
git push -u origin registrations

git checkout -b approvals
git commit --allow-empty -m "Initial approvals branch"
git push -u origin approvals

git checkout main
```

#### Step 1.2: Set Up Directory Structure

Create these directories in the registry repo:

```bash
mkdir -p docs logs
touch docs/README.md logs/.gitkeep

# Create status monitoring file
cat > registry-status.json << 'EOF'
{
  "version": "0.2.0",
  "last_updated": "2026-05-11T00:00:00Z",
  "producer_status": "initializing",
  "requests_pending": 0,
  "deliveries_completed": 0
}
EOF

git add .
git commit -m "Initialize registry structure"
git push -u origin main
```

#### Step 1.3: Record Registry Configuration

Create a configuration file for producers to reference:

```bash
cat > registry-config.json << 'EOF'
{
  "registry_name": "iranopasmigirim-registry",
  "registry_owner": "YOUR_USERNAME",
  "registry_url": "https://github.com/YOUR_USERNAME/iranopasmigirim-registry",
  "api_base": "https://api.github.com/repos/YOUR_USERNAME/iranopasmigirim-registry",
  "trusted_signers": [
    {
      "name": "Primary Producer",
      "fingerprint": "AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1",
      "key_url": "https://raw.githubusercontent.com/YOUR_USERNAME/iranopasmigirim-registry/main/keys/producer-public.asc"
    }
  ],
  "branches": {
    "requests": "requests",
    "approvals": "approvals",
    "registrations": "registrations",
    "deliveries": "deliveries"
  }
}
EOF

git add registry-config.json
git commit -m "Add registry configuration"
git push
```

#### Step 1.4: Create Deliveries Branch

```bash
git checkout -b deliveries
git commit --allow-empty -m "Initial deliveries branch"
git push -u origin deliveries
git checkout main
```

**Checkpoint:** Registry repo is created with proper branch structure. Users can now fork this repo.

---

### Phase 2: Producer Server Setup

**Goal:** Install and configure the producer server that monitors requests and mirrors content.

#### Step 2.1: Server Prerequisites

Ensure you have:
- Linux server (Ubuntu 20.04+ recommended)
- Python 3.8+
- Git
- GPG installed
- Internet connectivity (to scrape sites and push to GitHub)

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y python3 python3-pip git gpg curl

# Install Python dependencies
pip3 install requests cryptography pyyaml
```

#### Step 2.2: Clone Producer Repository

```bash
# Clone the main mirror repository (which contains the producer)
git clone https://github.com/YOUR_USERNAME/iranopasmigirim-mirror
cd iranopasmigirim-mirror

# Create configuration directory
mkdir -p ~/.config/iranopasmigirim-producer
cd ~/.config/iranopasmigirim-producer
```

#### Step 2.3: Set Up GPG Signing Key

The producer signs all delivery commits with a GPG key. You should have created this earlier (fingerprint: `AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1`).

Export the public key:

```bash
# Export public key
gpg --armor --export AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1 > producer-public.asc

# Copy to registry repo (for extension to verify signatures)
cp producer-public.asc /path/to/iranopasmigirim-registry/keys/producer-public.asc
cd /path/to/iranopasmigirim-registry
git add keys/producer-public.asc
git commit -m "Add producer signing key"
git push
```

If you **don't have a key yet**, create one:

```bash
gpg --gen-key

# Follow the prompts:
# - Name: "iranopasmigirim-producer"
# - Email: "producer@iranopasmigirim.local"
# - Passphrase: (strong passphrase)

# Get the fingerprint
gpg --list-keys

# Use that fingerprint (16-character hex) in the next steps
```

#### Step 2.4: Create Producer Configuration

```bash
cat > /home/USER/.config/iranopasmigirim-producer/config.toml << 'EOF'
[github]
# Leave empty to use public API (rate-limited)
# Or set to your GitHub token for higher limits
token = ""
registry_owner = "YOUR_USERNAME"
registry_repo = "iranopasmigirim-registry"
registry_url = "https://github.com/YOUR_USERNAME/iranopasmigirim-registry"

[producer]
# GPG fingerprint for signing deliveries
gpg_fingerprint = "AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1"
gpg_passphrase = "YOUR_GPG_PASSPHRASE"

# Local directory for mirrored content
mirror_cache_dir = "/var/lib/iranopasmigirim/cache"

# Whitelist of sites that can be mirrored
whitelist_file = "/home/USER/.config/iranopasmigirim-producer/whitelist.json"

# Request batch processing
requests_per_run = 5
max_mirror_size_mb = 500

[security]
# Block these patterns in scraped content
blocked_patterns = [
  ".*payment.*",
  ".*credit.*card.*",
  ".*billing.*",
  ".*stream.*m3u.*",
  ".*iframe.*cloudflare.*"
]

[logging]
log_level = "INFO"
log_dir = "/var/log/iranopasmigirim-producer"
EOF

# Restrict permissions (contains GPG passphrase)
chmod 600 /home/USER/.config/iranopasmigirim-producer/config.toml
```

**Important:** Replace placeholders:
- `YOUR_USERNAME`: Your GitHub username
- `YOUR_GPG_PASSPHRASE`: Your GPG key passphrase

#### Step 2.5: Create Whitelist

The whitelist defines which sites users can request mirroring for:

```bash
cat > /home/USER/.config/iranopasmigirim-producer/whitelist.json << 'EOF'
{
  "version": "1.0",
  "last_updated": "2026-05-11T00:00:00Z",
  "sites": [
    {
      "domain": "example.com",
      "description": "Example site",
      "enabled": true,
      "max_size_mb": 100
    },
    {
      "domain": "news.example.org",
      "description": "News aggregator",
      "enabled": true,
      "max_size_mb": 250
    }
  ]
}
EOF
```

#### Step 2.6: Create Mirror Cache Directory

```bash
sudo mkdir -p /var/lib/iranopasmigirim/cache
sudo mkdir -p /var/log/iranopasmigirim-producer
sudo chown $USER:$USER /var/lib/iranopasmigirim/cache
sudo chown $USER:$USER /var/log/iranopasmigirim-producer
chmod 700 /var/lib/iranopasmigirim/cache
chmod 700 /var/log/iranopasmigirim-producer
```

#### Step 2.7: Test Producer Manually

Before setting up automation, test the producer:

```bash
cd /path/to/iranopasmigirim-mirror

# Run producer for a single request processing cycle
python3 pusher/mirror_and_push.py --config ~/.config/iranopasmigirim-producer/config.toml --dry-run

# Check output:
# - Should list requests found
# - Show ownership verification results
# - Display what would be mirrored
# - NO --dry-run: actually mirrors and pushes
```

#### Step 2.8: Set Up Systemd Timer (Automation)

Create systemd service and timer for automatic request processing:

```bash
# Create systemd service file
sudo tee /etc/systemd/system/iranopasmigirim-producer.service > /dev/null << 'EOF'
[Unit]
Description=iranopasmigirim Producer - Mirror and Delivery Service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=USER
Group=USER
WorkingDirectory=/path/to/iranopasmigirim-mirror

# Run producer
ExecStart=/usr/bin/python3 pusher/mirror_and_push.py \
  --config /home/USER/.config/iranopasmigirim-producer/config.toml

# Restart on failure
Restart=on-failure
RestartSec=60

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iranopasmigirim-producer

# Security
PrivateTmp=yes
NoNewPrivileges=yes
EOF

# Create systemd timer (runs every 5 minutes)
sudo tee /etc/systemd/system/iranopasmigirim-producer.timer > /dev/null << 'EOF'
[Unit]
Description=iranopasmigirim Producer Timer - Run every 5 minutes
Requires=iranopasmigirim-producer.service

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
AccuracySec=1sec

[Install]
WantedBy=timers.target
EOF

# Enable and start timer
sudo systemctl daemon-reload
sudo systemctl enable iranopasmigirim-producer.timer
sudo systemctl start iranopasmigirim-producer.timer

# Verify it's running
sudo systemctl status iranopasmigirim-producer.timer
sudo systemctl list-timers --all
```

#### Step 2.9: Monitor Producer Logs

```bash
# Watch producer activity
sudo journalctl -u iranopasmigirim-producer.service -f

# View recent logs
sudo journalctl -u iranopasmigirim-producer.service -n 50

# Check timer execution history
sudo journalctl -u iranopasmigirim-producer.timer
```

**Checkpoint:** Producer server is configured and running on a timer. It will process requests every 5 minutes.

---

### Phase 3: Extension Installation

**Goal:** Install the mirror extension in users' browsers.

#### Step 3.1: Build the Extension

For **Chrome (MV3)**:

```bash
cd /path/to/iranopasmigirim-mirror
npm run build:chrome
# Output: dist/chrome/

# Or for development (skips release checks):
npm run dev:chrome
```

For **Firefox (MV2)**:

```bash
npm run build:firefox
# Output: dist/firefox/

# Or for development:
npm run dev:firefox
```

#### Step 3.2: Configure Extension for Registry

Before installing, configure the extension to point to your registry:

Edit `src/config.js` and update:

```javascript
export const REGISTRY_REPO = {
  owner: 'YOUR_USERNAME',
  repo: 'iranopasmigirim-registry',
  // Full URL for API
  url: 'https://api.github.com/repos/YOUR_USERNAME/iranopasmigirim-registry'
};

export const TRUSTED_SIGNERS = [
  {
    name: 'Primary Producer',
    fingerprint: 'AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1',
    // You can optionally fetch keys from your registry
    // key_url: 'https://raw.githubusercontent.com/YOUR_USERNAME/iranopasmigirim-registry/main/keys/producer-public.asc'
  }
];
```

Then rebuild:

```bash
npm run build:chrome  # or build:firefox
```

#### Step 3.3: Load Extension in Chrome

1. Open **chrome://extensions/**
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select `/path/to/iranopasmigirim-mirror/dist/chrome`
5. Extension now appears in toolbar

#### Step 3.4: Load Extension in Firefox

1. Open **about:debugging**
2. Click "This Firefox" (left sidebar)
3. Click "Load Temporary Add-on"
4. Select `/path/to/iranopasmigirim-mirror/dist/firefox/manifest.json`
5. Extension now appears in toolbar

#### Step 3.5: Initial Extension Configuration

Click the extension icon in toolbar:

1. **Enter Registry URL:**
   - Field: "Registry Repository URL"
   - Value: `https://github.com/YOUR_USERNAME/iranopasmigirim-registry`

2. **Enter Your Fork URL** (if you've forked the registry):
   - Field: "Your Requests Repository"
   - Value: `https://github.com/YOUR_USERNAME/iranopasmigirim-registry` (your fork)

3. Click "Save Configuration"

4. Click "Verify Registry" to test connectivity

**Result:** Extension is configured and can now sync with the registry.

---

## User Onboarding

**Goal:** Guide new users through requesting mirrors for sites they need.

### User Prerequisites

Users need:
- One of the supported browsers (Chrome or Firefox)
- GitHub account (free)
- Internet connection

### Step 1: Install Extension

Follow [Phase 3: Extension Installation](#phase-3-extension-installation) above.

### Step 2: Fork Registry Repository

1. Go to `https://github.com/YOUR_USERNAME/iranopasmigirim-registry`
2. Click "Fork" (top right)
3. Name it `iranopasmigirim-registry` (or custom name)
4. Fork to your GitHub account

### Step 3: Request a Mirror via Extension

1. Click extension icon in toolbar
2. Go to **"Request Mirror"** tab
3. Enter domain to request (e.g., `news.example.com`)
4. Click "Create Request"
5. Extension creates a commit with:
   - Request file: `requests/news-example-com/request.json`
   - Timestamp and user info
6. Click "Push to GitHub"
7. Extension opens your fork; confirm the push

### Step 4: Enable Request in Registry

After pushing, the request is in your fork. To enable it in the registry:

1. Go to your fork on GitHub
2. Create a Pull Request to the **registry owner's** `requests` branch
3. Or, if you have write access, push directly to the registry

The producer monitors the registry's `requests` branch and processes requests every 5 minutes.

### Step 5: Track Mirror Status

1. In extension popup, go to **"Status"** tab
2. You'll see:
   - Request status (pending, approved, delivered)
   - Mirror freshness (when last synced)
   - Storage size used
3. Once delivered, the site is available offline

---

## End-to-End Workflow

### Complete Example: Mirroring a News Site

**Timeline:** ~5-10 minutes

#### Minute 0: User Requests Mirror

**User:** Clicks extension → "Request Mirror" → enters `news.example.com`

**Behind the scenes:**
- Extension creates JSON file in local IndexedDB
- User confirms and pushes: request appears in their GitHub fork
- Request file: `requests/news-example-com/request.json`

```json
{
  "timestamp": "2026-05-11T14:30:00Z",
  "domain": "news.example.com",
  "user_id": "github_username",
  "owner_proof_branch": "registrations/news-example-com",
  "request_id": "abc123"
}
```

#### Minute 1: User Proves Ownership

User must prove they access or contribute to the site (prevents abuse).

**Options:**
- A. Commit a special token to the site's GitHub repo (if public)
- B. Create a specific DNS record (if they control DNS)
- C. Upload a verification file to a public directory on the site

**In this example:** User has access to news site's GitHub repo.

Extension creates ownership proof commit:

```bash
# In user's fork, on registrations/news-example-com branch
echo "iranopasmigirim_proof_12345" > proof.txt
git commit -am "Ownership proof for news.example.com"
git push -u origin registrations/news-example-com
```

**Result:** Request has ownership proof ready.

#### Minute 2-4: Producer Detects and Processes

**Producer runs (every 5 min):**

1. Scans registry `requests` branch
2. Finds `requests/news-example-com/request.json`
3. Fetches ownership proof from `registrations/news-example-com`
4. Verifies user actually has access (checks GitHub commits)
5. Approves request

**If approved:**

1. Scrapes `news.example.com` (all HTML, CSS, JS, images)
2. **Sanitizes** (removes payment forms, tracking, ads)
3. Packages into compressed delivery
4. **Signs** with GPG key (AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1)
5. Pushes signed delivery to registry `deliveries` branch

**Delivery structure:**

```
deliveries/
└── news-example-com/
    ├── delivery-2026-05-11.tar.gz (site content)
    ├── delivery-2026-05-11.tar.gz.sig (GPG signature)
    ├── manifest.json (site metadata)
    └── manifest.json.sig
```

#### Minute 5-7: Extension Syncs

**Extension runs background sync:**

1. Polls registry `deliveries` branch
2. Finds new delivery for `news.example.com`
3. Downloads `.tar.gz` and `.sig` file
4. **Verifies signature** against trusted producer key
5. Extracts and stores in IndexedDB (with timestamp)
6. Updates status: "available offline"

**User sees:** Status changes to "Delivered" with freshness timestamp

#### Minute 8: User Accesses Offline

**User:** Disconnects internet, tries to visit `news.example.com`

**Browser flow:**

1. Normal DNS fails (no internet)
2. Browser throws error page
3. User clicks extension icon
4. Extension shows: "news.example.com is available offline"
5. User clicks "Open Offline Version"
6. Extension serves cached site from IndexedDB
7. User browses full site, all resources load from cache

---

## Troubleshooting & Maintenance

### Common Issues

#### Issue 1: Producer Not Processing Requests

**Symptoms:**
- Requests stay in `requests` branch for >10 minutes
- No new deliveries appear in `deliveries` branch

**Diagnosis:**

```bash
# Check if timer is running
sudo systemctl status iranopasmigirim-producer.timer

# Check recent logs
sudo journalctl -u iranopasmigirim-producer.service -n 100

# Check if producer can access GitHub
curl -I https://api.github.com/repos/YOUR_USERNAME/iranopasmigirim-registry
```

**Solutions:**

```bash
# Restart timer
sudo systemctl restart iranopasmigirim-producer.timer

# If authentication issues (rate limiting), add GitHub token:
# Edit /home/USER/.config/iranopasmigirim-producer/config.toml
# Set: token = "your_github_token_here"

# Restart
sudo systemctl restart iranopasmigirim-producer.timer
```

#### Issue 2: Extension Won't Sync with Registry

**Symptoms:**
- Extension shows "Status: Failed to sync"
- Stored mirrors are not updating

**Diagnosis in Extension:**

```javascript
// Open browser console (F12), go to extension service worker logs:
// See sync errors, manifest validation failures
```

**Solutions:**

1. Check registry URL in extension config:
   - Should be: `https://github.com/YOUR_USERNAME/iranopasmigirim-registry`
   - NOT: `https://api.github.com/...` (API URL is auto-computed)

2. Verify GitHub repo is public:
   ```bash
   # Check repo visibility
   curl https://api.github.com/repos/YOUR_USERNAME/iranopasmigirim-registry \
     | grep "\"private\""
   # Should return: "private": false
   ```

3. Clear extension data and re-sync:
   - Extension popup → "Storage" → "Clear All Data"
   - Wait 10 seconds, extension auto-syncs

#### Issue 3: Signature Verification Fails

**Symptoms:**
- Extension shows delivery available, but won't open it
- Console error: "Signature verification failed"

**Diagnosis:**

```bash
# Check if producer's public key is in registry
curl https://raw.githubusercontent.com/YOUR_USERNAME/iranopasmigirim-registry/main/keys/producer-public.asc

# Verify producer signed commit correctly
gpg --verify /path/to/iranopasmigirim-registry/deliveries/*/manifest.json.sig
```

**Solutions:**

1. Ensure producer key is in registry:
   ```bash
   cd /path/to/iranopasmigirim-registry
   gpg --armor --export AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1 > keys/producer-public.asc
   git add keys/producer-public.asc
   git commit -m "Update producer key"
   git push
   ```

2. Rebuild extension with correct key fingerprint:
   ```bash
   # Update src/config.js TRUSTED_SIGNERS
   npm run build:chrome
   # Reload extension (Ctrl+Shift+R in chrome://extensions/)
   ```

#### Issue 4: Storage Full / Can't Store New Mirrors

**Symptoms:**
- Extension shows "Storage quota exceeded"
- New deliveries won't download
- Can't store new mirrors

**Solutions:**

Via Extension UI:

1. Extension popup → "Storage" tab
2. See storage breakdown by site
3. Click "Remove" next to least-needed site
4. Click "Evict Oldest Files" to auto-clean stale mirrors

Manually (via browser console):

```javascript
// Open F12 → Console in extension service worker context
const db = await openDB('mirror-storage');
const store = db.transaction('files', 'readwrite').store;
await store.clear();
console.log('Storage cleared');
```

---

### Maintenance Tasks

#### Weekly: Check Producer Health

```bash
# Check last execution
sudo systemctl list-timers iranopasmigirim-producer.timer

# Count processed requests
sudo journalctl -u iranopasmigirim-producer.service --since "1 week ago" \
  | grep "Delivery signed" | wc -l

# Monitor disk usage
du -sh /var/lib/iranopasmigirim/cache
```

#### Monthly: Rotate Logs

```bash
# Archive logs older than 30 days
find /var/log/iranopasmigirim-producer -name "*.log" -mtime +30 \
  -exec gzip {} \;

# Or use logrotate (recommended)
sudo tee /etc/logrotate.d/iranopasmigirim-producer > /dev/null << 'EOF'
/var/log/iranopasmigirim-producer/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
}
EOF
```

#### Quarterly: Update Whitelist

```bash
# Edit whitelist
nano /home/USER/.config/iranopasmigirim-producer/whitelist.json

# Add new sites or disable problematic ones
# Producer picks up changes automatically on next run
```

#### Annually: Rotate GPG Key

If key needs rotation (compromised or expires):

```bash
# Generate new key
gpg --gen-key

# Get fingerprint
gpg --list-keys | grep iranopasmigirim-producer

# Update producer config
nano /home/USER/.config/iranopasmigirim-producer/config.toml
# Change: gpg_fingerprint = "NEW_FINGERPRINT"

# Export and update registry
gpg --armor --export NEW_FINGERPRINT > keys/producer-public.asc
cd /path/to/iranopasmigirim-registry
git add keys/producer-public.asc
git commit -m "Rotate producer signing key"
git push

# Update extension
# Edit src/config.js TRUSTED_SIGNERS with new fingerprint
npm run build:chrome
npm run build:firefox
# Distribute new extension version

# Restart producer
sudo systemctl restart iranopasmigirim-producer.service
```

---

## Advanced Configuration

### Custom Request Approval Workflow

By default, producer auto-approves all requests from whitelisted domains.

For **manual approval**, create an approval step:

1. Producer pushes request to `approvals` branch (not `deliveries`)
2. Admin reviews on GitHub and merges to `deliveries`
3. Extension only syncs from `deliveries` branch

**Implement:**

Edit `pusher/mirror_and_push.py`:

```python
# Instead of:
producer.push_delivery('deliveries', delivery_data)

# Use:
producer.push_delivery('approvals', delivery_data)
# Admin manually tests then: git merge approvals → deliveries
```

### Rate Limiting by User

Prevent abuse (users requesting too many mirrors):

```toml
[security]
# In config.toml
max_requests_per_user_per_day = 5
max_total_size_per_user_mb = 1000
```

Producer enforces these limits before processing.

### Geographic Mirroring

Mirror content from different regions:

```bash
# Spin up additional producer instances in different regions
# Each with unique GPG key and registry path

# Producer A (US): signs to us-deliveries branch
# Producer B (EU): signs to eu-deliveries branch

# Extension config:
TRUSTED_SIGNERS = [
  { name: "US Producer", fingerprint: "KEY_A" },
  { name: "EU Producer", fingerprint: "KEY_B" }
]
```

### Bandwidth Throttling

Limit producer scraping impact:

```toml
[producer]
# Delay between requests (seconds)
request_delay = 2

# Max parallel downloads
max_concurrent_downloads = 2

# Total bandwidth limit (MB/s)
bandwidth_limit_mbps = 5
```

### Webhook Notifications

Notify users when mirrors are ready:

```python
# In pusher/mirror_and_push.py, after delivery signed:
if 'webhook_url' in delivery_data:
    requests.post(delivery_data['webhook_url'], json={
        'status': 'delivered',
        'domain': delivery_data['domain'],
        'timestamp': datetime.utcnow().isoformat()
    })
```

---

## Quick Reference

### Essential Commands

```bash
# Build extension
npm run dev:chrome         # Development build (Chrome)
npm run dev:firefox        # Development build (Firefox)
npm run build:chrome       # Production build (Chrome)
npm run build:firefox      # Production build (Firefox)

# Testing
npm test                   # Run all tests (77 total)
npm test -- --grep "sync" # Run specific test group

# Producer
python3 pusher/mirror_and_push.py --config ~/.config/iranopasmigirim-producer/config.toml --dry-run
sudo systemctl restart iranopasmigirim-producer.timer
sudo journalctl -u iranopasmigirim-producer.service -f

# Registry
cd /path/to/iranopasmigirim-registry
git checkout requests
git checkout deliveries
git checkout registrations
```

### File Locations

```
Extension source:     /path/to/iranopasmigirim-mirror/src/
Extension output:     /path/to/iranopasmigirim-mirror/dist/
Producer code:        /path/to/iranopasmigirim-mirror/pusher/
Producer config:      ~/.config/iranopasmigirim-producer/
Mirror cache:         /var/lib/iranopasmigirim/cache/
Producer logs:        /var/log/iranopasmigirim-producer/
Registry repo:        /path/to/iranopasmigirim-registry/
```

### Key Fingerprints

```
Primary Producer:
  Fingerprint: AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1
  Email: producer@iranopasmigirim.local
```

---

## Getting Help

- **Extension issues:** Check browser console (F12 → Console)
- **Producer issues:** Check logs: `sudo journalctl -u iranopasmigirim-producer.service -f`
- **Registry sync issues:** Verify GitHub connectivity: `curl https://api.github.com`
- **GPG/Signature issues:** Check key is exported: `gpg --list-keys | grep iranopasmigirim`

---

**Last Updated:** May 11, 2026  
**Version:** 0.2.0  
**Status:** Complete and tested
