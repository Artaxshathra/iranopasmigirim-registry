import {
  CONTENT_BRANCH,
  REGISTRY_BRANCH,
  REGISTRY_REPO_URL,
  REQUESTS_BRANCH,
  WHITELIST,
} from '../config.js';
import { parseGitHubUrl } from './github.js';

export function canonicalRepoUrl(repoUrl) {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  return `https://github.com/${owner}/${repo}`;
}

export function normalizeHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function normalizeFingerprint(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export function parseRequestedSite(requestedUrl) {
  let u;
  try {
    u = new URL(String(requestedUrl || '').trim());
  } catch (_) {
    throw new Error('Requested site URL is invalid');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Requested site must use https://');
  }
  return {
    requestedUrl: u.href,
    siteHost: normalizeHost(u.hostname),
    origin: u.origin,
  };
}

export function isAllowedHost(siteHost, whitelist = WHITELIST) {
  const normalized = normalizeHost(siteHost);
  if (!normalized) return false;
  return Object.prototype.hasOwnProperty.call(whitelist, normalized);
}

function randomHex(bytes = 8) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createRegistrationDraft({ userRepoUrl, requestedUrl, now = Date.now() }) {
  const canonicalUserRepoUrl = canonicalRepoUrl(userRepoUrl);
  const site = parseRequestedSite(requestedUrl);

  if (!isAllowedHost(site.siteHost)) {
    throw new Error(`Requested host is not allowed by whitelist: ${site.siteHost}`);
  }

  const requestId = `req-${Math.floor(now / 1000)}-${randomHex(6)}`;
  const nonce = randomHex(16);
  const challengePath = `_mirror/challenges/${requestId}.txt`;
  const registryRequestPath = `requests/${requestId}.json`;
  const registryStatusPath = `status/${requestId}.json`;

  return {
    requestId,
    createdAt: now,
    userRepoUrl: canonicalUserRepoUrl,
    siteHost: site.siteHost,
    requestedUrl: site.requestedUrl,
    requestedOrigin: site.origin,
    ownership: {
      nonce,
      challengePath,
      branch: REQUESTS_BRANCH,
      verified: false,
      verifiedAt: 0,
    },
    registry: {
      repoUrl: REGISTRY_REPO_URL,
      requestPath: registryRequestPath,
      statusPath: registryStatusPath,
      branch: REGISTRY_BRANCH,
      state: 'draft',
      stateReason: 'awaiting submission',
      updatedAt: now,
    },
    delivery: {
      branch: CONTENT_BRANCH,
      ready: false,
      commitSha: null,
      manifestPath: '_mirror/manifest.json',
      producerFingerprint: null,
    },
  };
}

export function buildRegistrationRequestDocument(draft) {
  return {
    requestId: draft.requestId,
    createdAt: draft.createdAt,
    requestedUrl: draft.requestedUrl,
    siteHost: draft.siteHost,
    requestedOrigin: draft.requestedOrigin,
    userRepoUrl: draft.userRepoUrl,
    ownership: {
      challengePath: draft.ownership.challengePath,
      nonce: draft.ownership.nonce,
      branch: draft.ownership.branch,
    },
    delivery: {
      branch: draft.delivery.branch,
      manifestPath: draft.delivery.manifestPath,
    },
    protocolVersion: 1,
  };
}

export function buildCommitInstructions(draft) {
  const doc = buildRegistrationRequestDocument(draft);
  return {
    requestId: draft.requestId,
    step1: {
      repoUrl: draft.registry.repoUrl,
      branch: draft.registry.branch,
      path: draft.registry.requestPath,
      content: `${JSON.stringify(doc, null, 2)}\n`,
      commitMessage: `register: ${draft.requestId}`,
    },
    step2: {
      repoUrl: draft.userRepoUrl,
      branch: draft.ownership.branch,
      path: draft.ownership.challengePath,
      content: `${draft.ownership.nonce}\n`,
      commitMessage: `proof: ${draft.requestId}`,
    },
    step3: {
      action: 'refresh-registration-status',
      note: 'Use the extension refresh button after both commits are pushed.',
    },
  };
}

export function mergeRegistrationRemoteState(draft, registryStatus, proofText, now = Date.now()) {
  const next = {
    ...draft,
    ownership: { ...draft.ownership },
    registry: { ...draft.registry },
    delivery: { ...draft.delivery },
  };

  const proofMatches = typeof proofText === 'string' && proofText.trim() === draft.ownership.nonce;
  if (proofMatches) {
    next.ownership.verified = true;
    next.ownership.verifiedAt = next.ownership.verifiedAt || now;
  }

  if (registryStatus && typeof registryStatus === 'object') {
    if (typeof registryStatus.state === 'string' && registryStatus.state.trim()) {
      const normalizedState = registryStatus.state.trim().toLowerCase();
      const allowedStates = new Set(['draft', 'pending', 'approved', 'rejected', 'error']);
      if (allowedStates.has(normalizedState)) {
        next.registry.state = normalizedState;
      }
    }
    if (typeof registryStatus.reason === 'string') {
      next.registry.stateReason = registryStatus.reason;
    }
    next.registry.updatedAt = now;

    if (typeof registryStatus.deliveryBranch === 'string' && registryStatus.deliveryBranch.trim()) {
      next.delivery.branch = registryStatus.deliveryBranch.trim();
    }
    if (typeof registryStatus.commitSha === 'string' && registryStatus.commitSha.trim()) {
      const sha = registryStatus.commitSha.trim().toLowerCase();
      if (/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
        next.delivery.commitSha = sha;
        next.delivery.ready = true;
      }
    }
    if (typeof registryStatus.producerFingerprint === 'string') {
      const fp = normalizeFingerprint(registryStatus.producerFingerprint);
      if (/^[0-9A-F]{40}$/.test(fp)) {
        next.delivery.producerFingerprint = fp;
      }
    }
  }

  if (next.registry.state === 'approved' && next.ownership.verified) {
    next.delivery.ready = Boolean(next.delivery.commitSha);
  }

  return next;
}
