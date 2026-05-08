// Single source of truth. Everything that's environment-shaped lives here so
// reviewers and forkers have one file to inspect.
//
// SECURITY MODEL:
//   The extension only ingests files from a commit whose signature verifies
//   against TRUSTED_SIGNERS below. If GitHub is compromised, if an account
//   is hijacked, if a collaborator pushes, the signature won't match and the
//   sync is rejected — the previous good cache stays in place. This means
//   the entire trust boundary collapses to "do you trust the keys below?",
//   which is a question users can answer by inspecting THIS file alone.
//
//   To rotate keys you ship a new extension version. There is intentionally
//   no in-extension key-update mechanism: a remote-update path is exactly
//   the surface a censor would target.

export const GITHUB_OWNER  = 'iran-mirror';        // PLACEHOLDER — set before release
export const GITHUB_REPO   = 'iranopasmigirim';    // PLACEHOLDER — set before release
export const GITHUB_BRANCH = 'main';

// The site we mirror. The extension redirects top-level navigations to this
// host into the extension origin so the cached content is what the user sees.
export const TARGET_HOST = 'iranopasmigirim.com';

// Where cached pages live inside the extension origin. Keep it short — it
// shows up in every URL the user sees.
export const SERVE_PATH = '/site/';

// Polling cadence. 5 min is a good default: cheap on the GitHub API (one
// call per poll if nothing changed, thanks to tree-SHA short-circuit), and
// short enough that a hot edit is visible to users within minutes.
export const POLL_INTERVAL_MINUTES = 5;

// Files larger than this are skipped. A site mirror should never need a
// 10 MB file; if one shows up it's probably a bundling mistake or hostile.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// On a sync failure, retry on doubling backoff capped at this many minutes.
// We never *succeed* faster than POLL_INTERVAL_MINUTES, so the worst case
// during an outage is a small constant rate of API calls.
export const MAX_BACKOFF_MINUTES = 60;

// Hard ceiling on per-sync HTTP requests. Defends against a hostile commit
// that lists 10 000 paths and would tie up the worker for hours.
export const MAX_FILES_PER_SYNC = 2000;

// Lightweight cache hygiene pass cadence. The cleanup run is intentionally
// infrequent so normal sync performance is unaffected.
export const MAINTENANCE_INTERVAL_HOURS = 24;

// Trusted signing keys. Each entry is the ASCII-armored OpenPGP public key
// of someone allowed to publish updates. The verification path is:
//   1. Fetch commit's `verification` field from GitHub API
//   2. Confirm verification.verified === true
//   3. Verify signature payload locally against TRUSTED_SIGNER_PUBLIC_KEYS
//   4. Confirm the verified key fingerprint is in TRUSTED_SIGNERS
// (Step 3 is what makes us independent of GitHub's own trust judgement.)
//
// PLACEHOLDER — replace with the real key fingerprint(s) before release.
// Fingerprints are 40-char uppercase hex with no spaces.
export const TRUSTED_SIGNERS = [
  // 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
];

// Armored OpenPGP public keys corresponding to TRUSTED_SIGNERS.
// Keep this list in strict 1:1 operational sync with TRUSTED_SIGNERS.
export const TRUSTED_SIGNER_PUBLIC_KEYS = [
  // `-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----`,
];

// Feature flag: while TRUSTED_SIGNERS is empty (pre-release), we accept
// GitHub's own verification verdict instead of a key match. This lets the
// extension be useful during early development without a signing key yet.
// Flip to false the moment you ship a real key.
export const ALLOW_UNPINNED_SIGNATURES = false;
