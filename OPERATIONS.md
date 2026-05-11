# Production Setup and Operations

All setup is automated through the setup.sh script. This document explains what's happening at each step.

---

## Overview

Mirror consists of three components:

1. Registry Repository (GitHub) - central request/delivery inbox
2. Producer Server - monitors requests, mirrors content, signs deliveries
3. Extension (users' browsers) - fetches deliveries, verifies signatures, serves offline

---

## Phase 1: Registry Repository Setup

Central GitHub repo that acts as the mirror registry.

Command:
```bash
./setup.sh registry OWNER REPO
```

Example:
```bash
./setup.sh registry myusername iranopasmigirim-registry
```

What it does:
- Creates repository on GitHub (you complete this step manually)
- Clones and sets up branches: requests, registrations, approvals, deliveries
- Creates registry-config.json with metadata
- Pushes configuration to GitHub

Result: Public GitHub repository ready to receive requests and deliver mirrors.

---

## Phase 2: Producer Server Setup

Install and configure the producer server that processes requests.

Prerequisites:
- Python 3.8+
- Git
- GPG
- httrack (web scraper)
- Linux server recommended

Command:
```bash
./setup.sh producer ~/.config/iranopasmigirim-producer/config.toml
```

What it does:
- Validates all dependencies installed
- Checks producer Python syntax
- Runs dry-run test
- Provides next steps for systemd timer setup

Configuration:
Producer needs a TOML config file. Example at: pusher/mirror.toml.example

Key settings:
- registry_repo_url: URL to central registry
- signing_key: GPG key fingerprint for signing deliveries
- whitelist_hosts: which sites can be mirrored
- block_payment_domains: block payment site requests
- block_stream_extensions: block streaming file requests

After setup:
Manual step - configure systemd timer for automation (see [OPERATIONS.md](OPERATIONS.md) Phase 2, Step 2.8)

---

## Phase 3: Extension Installation

Install the mirror extension in your browser.

Build:
```bash
./setup.sh dev build
```

Install:
```bash
./setup.sh install-ext dist/chrome
```

or for Firefox:
```bash
./setup.sh install-ext dist/firefox
```

What it does:
- Shows step-by-step browser loading instructions
- Extension then connects to registry for syncing

---

## User Workflow

After all three phases are set up:

1. User installs extension from Phase 3
2. User configures registry URL in extension popup
3. User requests mirror for whitelisted site
4. Producer processes request within configured interval (default 5 min)
5. Extension syncs delivery from registry
6. User accesses offline mirror

---

## Quality Assurance

Run all verifications:
```bash
./setup.sh verify
```

This validates:
- 80 extension unit tests
- 14 producer tests
- Python syntax
- Production build integrity

All tests must pass before release.

---

## For More Details

See DEPLOYMENT.md for:
- Detailed checklists
- Diagnostic commands
- Common troubleshooting
- Advanced configuration

---

**Version:** 0.2.0
**Last Updated:** May 11, 2026
