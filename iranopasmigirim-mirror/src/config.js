// Extension runtime configuration.
//
// Trust pins for producer signatures.
export const SERVE_PATH = '/site/';

export const POLL_INTERVAL_MINUTES = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKOFF_MINUTES = 60;
export const MAX_FILES_PER_SYNC = 2000;
export const MAINTENANCE_INTERVAL_HOURS = 24;

// Hardened trust pins. Replace with real values before release.
export const TRUSTED_SIGNERS = [];
export const TRUSTED_SIGNER_PUBLIC_KEYS = [];
export const REVOKED_SIGNERS = [];
export const ALLOW_UNPINNED_SIGNATURES = false;

// Request-response protocol constants.
export const USER_REPO_PLACEHOLDER = 'https://github.com/username/your-mirror-repo';
export const REGISTRY_REPO_URL = 'https://github.com/your-org/mirror-registry';
export const REGISTRY_BRANCH = 'registrations';
export const REQUESTS_BRANCH = 'requests';
export const CONTENT_BRANCH = 'content';
export const MIRROR_MANIFEST_PATH = '_mirror/manifest.json';
export const DEFAULT_ENTRY_PATH = 'index.html';
export const REQUEST_ANALYSIS_DELAY_MS = 30 * 60 * 1000;

export const WHITELIST = {
  'bbc.com': {
    paths: ['/news', '/news/*'],
    include_css: true,
    include_images: true,
    follow_depth: 0,
    max_size_mb: 50,
  },
};
