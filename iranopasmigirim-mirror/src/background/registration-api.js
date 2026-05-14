export async function submitRegistrationViaEndpoint({ endpoint, draft, instructions }) {
  const target = String(endpoint || '').trim();
  if (!target) throw new Error('Request service is not configured for this extension build');
  if (!draft || !instructions || !instructions.step1 || !instructions.step2) {
    throw new Error('Registration request is incomplete');
  }

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      protocolVersion: 1,
      requestId: draft.requestId,
      userRepoUrl: draft.userRepoUrl,
      requestedUrl: draft.requestedUrl,
      siteHost: draft.siteHost,
      registryRequest: JSON.parse(instructions.step1.content),
      files: {
        registryRequest: {
          repoUrl: instructions.step1.repoUrl,
          branch: instructions.step1.branch,
          path: instructions.step1.path,
          content: instructions.step1.content,
        },
        ownershipProof: {
          repoUrl: instructions.step2.repoUrl,
          branch: instructions.step2.branch,
          path: instructions.step2.path,
          content: instructions.step2.content,
        },
      },
    }),
    cache: 'no-store',
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch (_) { data = { error: text }; }
  }
  if (!response.ok || (data && data.ok === false)) {
    const message = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${response.status}`;
    throw new Error(`Request service failed: ${message}`);
  }
  return data || { ok: true };
}