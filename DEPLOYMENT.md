# Deployment Guide (Simple & Reliable)

This guide shows how to set up, test, and deploy the Mirror extension and producer with maximum clarity and minimum confusion.

---

## 1. Local Development & Testing

**Install dependencies and build:**
```bash
./setup.sh dev
```
- Installs all dependencies
- Runs all tests
- Builds the Chrome extension (output: dist/chrome)

**To run tests only:**
```bash
./setup.sh dev test
```

**To build for Firefox:**
```bash
./setup.sh dev firefox
```

**To verify everything (tests + build):**
```bash
./setup.sh verify
```

---

## 2. GitHub Setup (First Time Only)

**A. Generate SSH key (if you don't have one):**
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
# Press Enter for all prompts (use default location and no passphrase)
```

**A.1 If you get "Key is already in use" error:**
The SSH key is associated with another GitHub account. Choose one:
- **Option 1:** Remove the key from your other account first, then add it here
- **Option 2:** Generate a new SSH key with a different name:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_mirror -C "your-email@example.com"
  # Then add this key to GitHub instead
  ```
- **Option 3:** Switch to the other account's SSH key (if it's also yours)

**B. Add SSH key to GitHub (manual):**
1. Copy your public key:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
2. Go to https://github.com/settings/keys
3. Click "New SSH key"
4. Paste the key, give it a name, click "Add SSH key"

**C. Verify SSH connection:**
```bash
ssh -T git@github.com
# Should show: "Hi YOUR_USERNAME! You've successfully authenticated..."
```

**D. Configure Git (first time):**
```bash
git config --global user.email "your-email@example.com"
git config --global user.name "Your Name"
```

**D.1 If you used a custom SSH key name (e.g., `id_ed25519_mirror`):**
Add it to your SSH config so Git uses it automatically:
```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/id_ed25519_mirror
EOF
```

---

## 3. Registry Repository Setup (Manual + Script)

**A. Create the registry repo on GitHub (manual):**
1. Go to https://github.com/new
2. Name: `YOUR-REGISTRY-REPO` (e.g., `iranopasmigirim-registry`)
3. Description: Central mirror registry
4. Visibility: Public
5. Click "Create repository"

**B. Initialize registry branches and config (script):**
```bash
./setup.sh registry YOUR_GITHUB_USERNAME YOUR-REGISTRY-REPO
```
- This will set up the required branches and config file in the repo.

---

## 4. Producer Server Setup

**A. Prerequisites (manual):**
- Linux server (recommended)
- Python 3.8+, git, gpg, httrack

Install dependencies:
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip git gpg httrack
```

**B. GPG Key (manual):**
```bash
gpg --gen-key
# Save the fingerprint for config
```

**C. Configure producer (manual):**
- Copy and edit the example config: `pusher/mirror.toml.example`
- Set your registry repo URL and GPG fingerprint

**D. Test producer setup (script):**
```bash
./setup.sh producer /path/to/your/config.toml
```
- Checks dependencies, validates config, runs a dry-run

**E. (Manual) Set up systemd timer for automation:**
- See OPERATIONS.md for a sample systemd unit and timer

---

## 5. Extension Installation (Manual)

**A. Build the extension:**
```bash
./setup.sh dev build
```

**B. Install in browser:**
- **Chrome:**
  1. Open `chrome://extensions`
  2. Enable Developer mode
  3. Click "Load unpacked"
  4. Select `dist/chrome`
- **Firefox:**
  1. Open `about:debugging`
  2. Click "This Firefox"
  3. Click "Load Temporary Add-on"
  4. Select `dist/firefox/manifest.json`

---

## 6. Troubleshooting & Diagnostics

- **Verify everything:** `./setup.sh verify`
- **Clean build:** `./setup.sh clean`
- **Check Python syntax:** `python3 -m py_compile pusher/mirror_and_push.py`
- **Run producer tests:** `python3 -m unittest -v pusher/test_producer.py`
- **Check extension build:** `cat dist/chrome/manifest.json | python3 -m json.tool`

---

## 7. Common Issues

- **Extension doesn't load:** Rebuild and check for errors in manifest.json
- **Tests fail:** Run `./setup.sh verify` and check output
- **Producer won't run:** Check Python syntax, dependencies, and config
- **Registry sync issues:** Check your git config and GitHub token

---

**Version:** 0.2.0  
**Last Updated:** May 13, 2026
