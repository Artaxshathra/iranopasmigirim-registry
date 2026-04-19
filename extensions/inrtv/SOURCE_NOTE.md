## Source Code Build Instructions (AMO Reviewer Note)

This extension bundles a third-party library (`hls.js`) that is not included
in the source repository — it is downloaded and integrity-verified at build time.

### Prerequisites

- Node.js ≥ 18
- `curl`, `tar`, `zip` (standard on Linux/macOS; Git Bash on Windows)

### Steps

```bash
cd extensions/inrtv

# 1. Download hls.js v1.6.16 (SHA-256 verified)
./bootstrap.sh

# 2. Build Firefox extension zip
./build.sh
```

The Firefox zip is written to `extensions/inrtv/dist/inrtv-firefox.zip`.

### What bootstrap.sh does

1. Downloads `hls.js@1.6.16` tarball from the npm registry
2. Verifies its SHA-256 checksum (`442f599c...2d40e0`)
3. Strips the sourcemap reference line
4. Prepends the Apache-2.0 license banner
5. Writes to `src/lib/hls.min.js`

No other build tools, transpilers, or bundlers are used. All extension source
files are plain JavaScript, HTML, and CSS — what you see in `src/` is what
ships in the zip.
