/**
 * SAS Retrieval Agent Manager (RAM) — Method 2: Stateful Gateway Frontend Client
 * Communicates with the stateful application gateway (/api/ram/*).
 * Automatically passes the HttpOnly `ram_sid` session cookie via credentials: 'same-origin'.
 */

const BASE_URL = '/api/ram';

/**
 * ── 1. Authentication Endpoints ──
 */

export async function checkAuthStatus() {
  const res = await fetch(`${BASE_URL}/auth/status`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to check auth status: ${res.statusText}`);
  return res.json();
}

/**
 * Step 1: Initiate OAuth 2.0 Device Code Flow with PKCE
 * Returns { userCode, verificationUri, verificationUriComplete, expiresIn, interval }
 */
export async function startDeviceLogin() {
  const res = await fetch(`${BASE_URL}/auth/device/start`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Device login initiation failed: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Step 2: Poll for device login authorization approval
 * Returns { ok: true } on success, or { pending: true, slowDown: bool } while waiting
 */
export async function pollDeviceLogin() {
  const res = await fetch(`${BASE_URL}/auth/device/poll`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Authorization failed or expired.');
  }
  return data;
}

/**
 * Flow B: Exchange Viya SASLogon authorization code
 */
export async function submitViyaCode(code) {
  const res = await fetch(`${BASE_URL}/auth/viya/code`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'SASLogon code exchange failed');
  }
  return res.json();
}

/**
 * Sign out and clear server-side session cookie
 */
export async function signOut() {
  const res = await fetch(`${BASE_URL}/auth/signout`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return res.json();
}

/**
 * ── 2. Catalog & Discovery ──
 */

export async function listCollections(limit = 50, start = 0) {
  const res = await fetch(`${BASE_URL}/collections?limit=${limit}&start=${start}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to list collections: ${res.status}`);
  return res.json();
}

export async function listAgents(limit = 50, start = 0) {
  const res = await fetch(`${BASE_URL}/agents?limit=${limit}&start=${start}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to list agents: ${res.status}`);
  return res.json();
}

/**
 * ── 3. Document Text Extraction ──
 */

export async function extractDocument(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/extract`, {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Document extraction failed: ${res.statusText}`);
  }
  return res.json(); // { name, text, characterCount, truncated }
}

/**
 * ── 4. 504-Immune Asynchronous Query Execution with Live Tracing ──
 *
 * Submits query asynchronously (synchronous=false) and polls for completion,
 * concurrently polling execution traces (/toolCalls, /retrievalCalls, /llmCalls).
 */
export async function submitAndStreamQuery({
  content,
  agentId,
  collectionIds,
  sessionId,
  attachments = [],
  onTrace = null,
  onStatus = null,
  intervalMs = 2000,
  timeoutMs = 300000, // 5 min timeout
}) {
  // 1. Submit asynchronous query
  const res = await fetch(`${BASE_URL}/query`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      agentId,
      collectionIds,
      querySessionId: sessionId,
      attachments,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to submit query: ${res.statusText}`);
  }

  const { queryId, querySessionId } = await res.json();
  const startTime = Date.now();

  // 2. Poll query status and trace details until completed or failed
  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Query timed out waiting for agent completion.');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    // Concurrently fetch execution traces if callback provided
    if (onTrace) {
      fetch(`${BASE_URL}/query/${queryId}/trace`, { credentials: 'same-origin' })
        .then((r) => r.ok && r.json())
        .then((traces) => traces && onTrace(traces))
        .catch(() => {});
    }

    // Fetch primary query status
    const statusRes = await fetch(`${BASE_URL}/query/${queryId}`, { credentials: 'same-origin' });
    if (!statusRes.ok) continue;

    const data = await statusRes.json();
    if (onStatus) onStatus(data.status);

    if (data.status === 'completed') {
      return {
        queryId,
        querySessionId: querySessionId || data.querySessionId,
        content: data.content,
        sources: data.sources || [],
        insertTimestamp: data.insertTimestamp,
      };
    }

    if (data.status === 'failed') {
      throw new Error(data.error || data.detail || 'Retrieval agent execution failed.');
    }
  }
}

/**
 * ── 5. Session History ──
 */

export async function listSessions(limit = 50, start = 0) {
  const res = await fetch(`${BASE_URL}/sessions?limit=${limit}&start=${start}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json();
}

export async function getSessionMessages(sessionId) {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/messages`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Failed to fetch session messages: ${res.status}`);
  return res.json();
}

export async function deleteSession(sessionId) {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return res.json();
}
