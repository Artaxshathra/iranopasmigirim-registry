# Deployment Checklists and Diagnostics

Quick reference for setup, testing, and troubleshooting.

---

## Development Setup Checklist

```bash
# Clone and navigate
git clone https://github.com/YOUR_FORK/iranopasmigirim-mirror.git
cd iranopasmigirim-mirror

# Run development build
./setup.sh dev

# Load in browser
# Chrome: chrome://extensions -> Load unpacked -> dist/chrome
# Firefox: about:debugging -> Load Temporary Add-on -> dist/firefox/manifest.json
```

✓ Tests pass  
✓ Extension loads without errors  
✓ Popup shows "Not configured" (expected)  

---

## Quality Assurance Checklist

Before committing or releasing:

```bash
# Full verification
./setup.sh verify
```

Expected output:
- ✓ npm install: success
- ✓ 80 extension tests: all passed
- ✓ Producer Python syntax: valid
- ✓ 14 producer tests: all passed
- ✓ Chrome build: successful
- ✓ Firefox build: successful

---

## Registry Setup Checklist

Creating the central GitHub registry:

```bash
./setup.sh registry myusername iranopasmigirim-registry
```

Verify:
- [ ] Repository created on GitHub
- [ ] Branches exist: requests, registrations, approvals, deliveries
- [ ] Registry config pushed to main
- [ ] (Manual) Add repository to account profile

---

## Producer Setup Checklist

Setting up the server that mirrors content:

### Prerequisites
```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y python3 python3-pip git gpg httrack curl

# GPG key setup
gpg --gen-key
# Save fingerprint for next step
```

### Setup
```bash
./setup.sh producer ~/.config/iranopasmigirim-producer/config.toml
```

Verify:
- [ ] Config file created
- [ ] GPG key fingerprint matches config
- [ ] Dry run completed successfully
- [ ] Test registry sync showed expected behavior

### Systemd Automation (Manual Step)

See OPERATIONS.md Phase 2 Step 2.8 for timer configuration.

---

## Extension Installation Checklist

Installing built extension in browser:

```bash
./setup.sh dev build
./setup.sh install-ext dist/chrome
```

Verify:
- [ ] Extension appears in chrome://extensions
- [ ] Extension ID matches release pins (if applicable)
- [ ] No permission warnings
- [ ] Popup loads without errors

---

## Diagnostic Commands

Test quick status:

```bash
# Verify everything works
./setup.sh verify

# Run just tests (no build)
./setup.sh dev test

# Run just Python producer tests
python3 -m unittest -v pusher/test_producer.py

# Check extension syntax
python3 -m py_compile pusher/mirror_and_push.py

# Quick Firefox check
./setup.sh dev firefox

# Check producer config
grep -E "registry_repo|signing_key|whitelist_hosts" config.toml
```

---

## Common Issues

### Extension doesn't load
```bash
# Rebuild
./setup.sh dev chrome

# Check for errors
cat dist/chrome/manifest.json | python3 -m json.tool
```

### Tests fail
```bash
# Full verification
./setup.sh verify

# Just JS tests
npm test

# Just producer tests
python3 -m unittest -v pusher/test_producer.py
```

### Producer won't run
```bash
# Check Python syntax
python3 -m py_compile pusher/mirror_and_push.py

# Check dependencies
python3 -c "import requests, cryptography; print('OK')"

# Check httrack installed
which httrack
```

### Registry sync issues
```bash
# Check git config
git config --global user.email
git config --global user.name

# Check GitHub token
echo $GITHUB_TOKEN
```

---

## Performance Notes

- First build takes ~30 seconds (npm install)
- Rebuilds take ~3 seconds
- Full test suite (80 JS + 14 producer tests) takes ~10 seconds
- Producer dry run takes ~5 seconds
- Production mirror of typical site takes 2-5 minutes

---

## Logs and Output

- Extension tests: `npm test`
- Producer tests: `python3 -m unittest -v pusher/test_producer.py`
- Producer running: Check systemd journal `journalctl -u iranopasmigirim-producer.timer -f`
- Extension sync: Check browser DevTools -> Application -> IndexedDB

---

**Version:** 0.2.0
**Last Updated:** May 11, 2026
