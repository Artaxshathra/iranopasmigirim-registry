// Extension runtime configuration.
//
// Trust pins for producer signatures.
export const SERVE_PATH = '/site/';

export const POLL_INTERVAL_MINUTES = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKOFF_MINUTES = 60;
export const MAX_FILES_PER_SYNC = 2000;
export const MAINTENANCE_INTERVAL_HOURS = 24;
export const STORAGE_RECOVERY_TARGET_BYTES = 16 * 1024 * 1024;
export const STALE_FILE_TTL_DAYS = 30;

// Hardened trust pins for producer signatures.
export const TRUSTED_SIGNERS = [
  'AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1',
];
export const TRUSTED_SIGNER_PUBLIC_KEYS = [
  `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEagDyphYJKwYBBAHaRw8BAQdAFZPlss2qqpsCELhTbgXxpLwS1L0ELnagk6qm
RGMyMoy0LU1pcnJvciBQcm9kdWNlciA8bWlycm9yLXByb2R1Y2VyQGlucnR2Lmxv
Y2FsPoiZBBMWCgBBFiEEr5WrdyXWiiq7qLk43RPsM2iqBdEFAmoA8qYCGwMFCQHh
M4AFCwkIBwICIgIGFQoJCAsCBBYCAwECHgcCF4AACgkQ3RPsM2iqBdE3YgD6AjAv
7+PvEqDMRov+7zbfgawSScKepXkWsvxgaXk2vGgA/AvpDfO6GKxYKShujSpWuiL0
Qr/oY0rpNqBYzHgJbz8I
=ZHxb
-----END PGP PUBLIC KEY BLOCK-----`,
];
export const REVOKED_SIGNERS = [];
export const ALLOW_UNPINNED_SIGNATURES = false;

// Request-response protocol constants.
export const USER_REPO_PLACEHOLDER = 'https://github.com/username/your-mirror-repo';
export const REGISTRY_REPO_URL = 'https://github.com/Artaxshathra/iranopasmigirim-registry';
export const REGISTRY_BRANCH = 'registrations';
export const REQUESTS_BRANCH = 'requests';
export const CONTENT_BRANCH = 'content';
export const MIRROR_MANIFEST_PATH = '_mirror/manifest.json';
export const DEFAULT_ENTRY_PATH = 'index.html';
export const REQUEST_ANALYSIS_DELAY_MS = 30 * 60 * 1000;

