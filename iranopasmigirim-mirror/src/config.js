// Extension runtime configuration.
//
// Compatibility note:
// Some tests and release scripts still validate the hardened signer model via
// TRUSTED_SIGNERS / TRUSTED_SIGNER_PUBLIC_KEYS and repository candidate fields.
// We keep those exports while introducing request-response protocol constants.

export const GITHUB_OWNER  = 'iran-mirror';
export const GITHUB_REPO   = 'iranopasmigirim';
export const GITHUB_BRANCH = 'main';

export const REPO_CANDIDATES = [
  { owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: GITHUB_BRANCH },
];

export const TARGET_HOST = 'iranopasmigirim.com';
export const SERVE_PATH = '/site/';

export const POLL_INTERVAL_MINUTES = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKOFF_MINUTES = 60;
export const MAX_FILES_PER_SYNC = 2000;
export const MAINTENANCE_INTERVAL_HOURS = 24;

// Hardened trust pins. Replace with real values before release.
export const TRUSTED_SIGNERS = [];
export const TRUSTED_SIGNER_PUBLIC_KEYS = [];
export const ALLOW_UNPINNED_SIGNATURES = false;

// Request-response protocol constants.
export const USER_REPO_PLACEHOLDER = 'https://github.com/username/your-mirror-repo';
export const REQUESTS_BRANCH = 'requests';
export const CONTENT_BRANCH = 'content';
export const REQUEST_ANALYSIS_DELAY_MS = 30 * 60 * 1000;

export const WHITELIST = {
  'iranopasmigirim.com': {
    paths: ['/'],
    include_css: true,
    include_images: true,
    follow_depth: 1,
    max_size_mb: 100,
  },
  'bbc.com': {
    paths: ['/news', '/news/*'],
    include_css: true,
    include_images: true,
    follow_depth: 0,
    max_size_mb: 50,
  },
};
