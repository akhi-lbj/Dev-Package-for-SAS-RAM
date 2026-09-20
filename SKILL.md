---
name: sas-ram-integration
description: >-
  Framework-agnostic integration guide and API specification for SAS Retrieval Agent
  Manager (RAM) v1 REST APIs. Details both integration patterns: Method 1 (Stateless
  Pass-Through BFF Proxy) and Method 2 (Stateful Application Gateway with HttpOnly
  cookie session binding, async polling, live traces, and attachment extraction).
  Covers OAuth 2.0 Device Code authentication with PKCE, SAS Viya SASLogon,
  302 redirect interception, and 504 timeout immunity.
---

# SAS Retrieval Agent Manager (RAM) — Master Integration Specification

Universal, framework-agnostic specification for connecting any web frontend, full-stack application, or agentic service to **SAS Retrieval Agent Manager (RAM)** v1 REST APIs.

---

## 1. Architecture Decision Matrix: Method 1 vs. Method 2

Direct browser-to-RAM HTTP calls are blocked by CORS and SAS security boundaries. An intermediary proxy layer is mandatory. Choose between two supported architectures:

| Architectural Dimension | Method 1: Stateless Pass-Through BFF Proxy | Method 2: Stateful Application Gateway Pattern |
| :--- | :--- | :--- |
| **Core Concept** | Transparent reverse proxy; client manages token lifecycle. | Dedicated gateway service; binds browser via `HttpOnly` cookie. |
| **Token Handling** | Client passes `Authorization: Bearer <token>`. | Tokens kept server-side in session store; client never sees JWTs. |
| **Auth Implementation** | Client or proxy orchestrates Device Code Flow with PKCE. | Gateway endpoints (`/auth/device/start`, `/auth/device/poll`). |
| **Session Tracking** | Stateless (no server memory or disk state). | Stateful: `ram_sid` cookie mapped to session registry + disk backup. |
| **Token Concurrency** | Vulnerable to race conditions on simultaneous token refresh. | Mutex-locked (`asyncio.Lock` / sync mutex) to prevent token burn. |
| **504 Timeout Immunity**| Client-driven (synchronous risks 30-60s ingress timeout). | Built-in: Enforces `synchronous=false` and polls query status. |
| **Execution Tracing** | Client must individually query each trace endpoint. | Built-in: Parallel aggregation of `/toolCalls`, `/retrievalCalls`, `/llmCalls`. |
| **Ad-Hoc Attachments** | Client must manually format and inline text into prompt. | Built-in: `/extract` endpoint extracts text with 20k char prompt budget. |
| **Target Platforms** | Serverless / Edge (Next.js route handlers, Cloudflare, Express). | Long-running backends (FastAPI, Express/Nest, Go, Spring Boot). |
| **Best Used For** | Rapid prototypes, single-user internal tools, edge runtimes. | Multi-user enterprise applications, long agent queries, production. |

---

## 2. Universal SAS RAM REST API Reference

Base Endpoint: `{RAM_API_URL}` (e.g. `https://<sas-host>/SASRetrievalAgentManager/api/v1`)

### Endpoint Catalog

| Purpose | Method & Path | Query Parameters / Headers | Description & Payload |
| :--- | :--- | :--- | :--- |
| **List Collections** | `GET /collections` | `limit=50&start=0` | Returns available indexed knowledge base collections. |
| **List Agents** | `GET /agents` | `limit=50&start=0` | Returns available reasoning and retrieval agents. |
| **Execute Query** | `POST /query` | `synchronous={bool}&persistent=true` | Submits a query prompt. Body: `{"content": "...", "agentId": "..."}` |
| **Query Status** | `GET /query/{id}` | None | Polls query state: `pending`, `running`, `completed`, `failed`. |
| **Query Sessions** | `GET /querySessions` | `sortBy=insertTimestamp:descending` | Lists conversation history sessions. |
| **Session Messages**| `GET /query` | `filter=eq(querySessionId,{id})` | Retrieves prior conversation turns for a session. |
| **Delete Session** | `DELETE /querySessions/{id}` | None | Deletes conversation session from RAM backend. |
| **Tool Traces** | `GET /toolCalls` | `filter=eq(parentQueryId,'{id}')` | Tool inputs, arguments, outputs, execution duration. |
| **Retrieval Traces**| `GET /retrievalCalls` | `filter=eq(parentQueryId,'{id}')` | KB search queries, relevancy scores, chunk snippets. |
| **LLM Traces** | `GET /llmCalls` | `filter=eq(parentQueryId,'{id}')` | LLM token usage, system prompts, reasoning steps. |

### Query Execution Contracts

#### Query Request Payload (`POST /query`):
```json
{
  "content": "Analyze the attached document for regulatory compliance.\n\n--- Attached document: audit.pdf ---\n[Extracted text...]\n--- End of attached document ---",
  "agentId": "60918895-0702-4c77-83c6-96fc52cd80a0",
  "collectionIds": ["optional-collection-uuid"],
  "querySessionId": "optional-existing-session-uuid"
}
```

#### Synchronous Response (`200 OK` when `synchronous=true`):
```json
{
  "id": "query-uuid-1234",
  "querySessionId": "session-uuid-5678",
  "content": "Based on the audit report, the compliance findings are...",
  "status": "completed",
  "sources": [{ "documentName": "audit.pdf", "page": 2, "snippet": "..." }],
  "insertTimestamp": "2026-09-20T10:00:00Z"
}
```

#### Asynchronous Initial Response (`synchronous=false`):
```json
{
  "id": "query-uuid-1234",
  "querySessionId": "session-uuid-5678",
  "status": "pending"
}
```

#### Query Status Polling Response (`GET /query/{id}`):
```json
{
  "id": "query-uuid-1234",
  "status": "completed",
  "content": "Synthesized agent response...",
  "sources": [...],
  "error": null
}
```

---

## 3. Authentication Engine: Device Code Flow (PKCE) & SASLogon

RAM applications authenticate via **OAuth 2.0 Device Authorization Grant with PKCE** (standard for standalone RAM / Keycloak public client `sas-ram-api`) or **SAS Viya SASLogon**.

```
Detection Probe: GET {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/.well-known/openid-configuration
If HTTP 200 -> Flow A (Device Code Flow with PKCE)
If HTTP 404/Redirect -> Flow B (SAS Viya SASLogon Auth Code)
```

### Flow A: OAuth 2.0 Device Code Flow with PKCE (RFC 8628)
Zero-configuration public client flow (`client_id: sas-ram-api`). Requires no redirect URI whitelisting or client secret.

1. **PKCE Key Generation**:
   - `code_verifier`: 32 random bytes, base64url-encoded (unpadded).
   - `code_challenge`: `base64url(SHA-256(code_verifier))`.
2. **Device Code Request**:
   - `POST {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/protocol/openid-connect/auth/device`
   - Content-Type: `application/x-www-form-urlencoded`
   - Body: `client_id=sas-ram-api&scope=openid&code_challenge={challenge}&code_challenge_method=S256`
   - Response:
     ```json
     {
       "device_code": "dev-code-xyz",
       "user_code": "WXYZ-1234",
       "verification_uri": "https://<host>/auth/device",
       "verification_uri_complete": "https://<host>/auth/device?user_code=WXYZ-1234",
       "expires_in": 600,
       "interval": 5
     }
     ```
3. **User Authorization**: User visits `verification_uri` in browser, enters `user_code`, and approves access.
4. **Token Polling Loop**:
   - Cadence: Poll every `interval` seconds (default: 5s).
   - `POST {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/protocol/openid-connect/token`
   - Content-Type: `application/x-www-form-urlencoded`
   - Body: `grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=sas-ram-api&device_code={device_code}&code_verifier={code_verifier}`
   - Responses:
     - `HTTP 400` with `{"error": "authorization_pending"}` &rarr; Continue polling.
     - `HTTP 400` with `{"error": "slow_down"}` &rarr; Increase polling interval by 5s.
     - `HTTP 200` &rarr; Success! Returns `{"access_token": "...", "refresh_token": "...", "expires_in": 300}`.
5. **Token Refresh & Concurrency Warning**:
   - `POST .../protocol/openid-connect/token` with `grant_type=refresh_token&client_id=sas-ram-api&refresh_token={refresh_token}`.
   - **Critical**: Many OIDC servers enforce single-use refresh token rotation. Concurrent refresh requests burn the token and cause session revocation (`invalid_grant`). Serializing refresh calls behind a mutex is required.

### Flow B: SAS Viya SASLogon Authorization Code Flow
Used in full SAS Viya environments with SASLogon.

1. **User Login**: User opens `{VIYA_HOST}/SASLogon/oauth/authorize?client_id=sas.cli&response_type=code` in browser.
2. **Code Exchange**:
   - `POST {VIYA_HOST}/SASLogon/oauth/token`
   - Headers: `Authorization: Basic c2FzLmNsaTo=` (Base64 of `sas.cli:`), `Content-Type: application/x-www-form-urlencoded`
   - Body: `grant_type=authorization_code&code={pasted_code}`
   - Returns `access_token` and `refresh_token`.

### Flow C: Service Accounts & Static Bearer Tokens
- **Static Token**: Set `RAM_TOKEN=<token>` for automated pipelines or development environments.
- **Client Credentials**: `POST {VIYA_HOST}/SASLogon/oauth/token` with `grant_type=client_credentials`, `client_id`, and `client_secret`.

---

## 4. Method 1: Stateless Pass-Through BFF Proxy

A transparent reverse-proxy layer forwarding incoming requests to SAS RAM while handling browser security limitations.

```
[ Browser Client ]
       │  1. Manages Token & Device Polling (or passes Viya Token)
       │  2. Calls /api/proxy?endpoint=... with `Authorization: Bearer <Token>`
       ▼
[ Stateless BFF Proxy Handler ]
       │  - Forwards Bearer token & endpoint path
       │  - Intercepts 302 Ingress Redirects -> Returns 401 JSON
       ▼
[ SAS Ingress Gateway & RAM v1 REST APIs ]
```

### Universal Proxy Implementation Contract
1. **Endpoint Forwarding**: Route pattern `/api/proxy?endpoint=<subpath>`. Construct destination:
   `targetUrl = {RAM_API_URL}/{endpoint}?{remaining_params}`
2. **Header Propagation**: Forward incoming `Authorization` and `Content-Type: application/json` headers.
3. **CRITICAL - Disable Automatic Redirects**: Set HTTP client redirect handling to `manual`.
4. **Intercept 302 Login Redirect Trap**:
   - When a token expires, the SAS Ingress gateway returns an HTTP `302/307 Redirect` to an HTML login page.
   - When status is `3xx` or response type is `opaqueredirect`, immediately return HTTP `401 Unauthorized` with JSON:
     `{"error": "Session expired or unauthorized"}`.
5. **Stream Response**: Return upstream status code and JSON payload directly to client.

### Framework Implementation Reference (Method 1)

#### TypeScript / JavaScript Proxy Handler (Next.js / Node / Edge):
```ts
export async function handleProxyRequest(req: Request, ramApiUrl: string) {
  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) return new Response(JSON.stringify({ error: "endpoint required" }), { status: 400 });

  url.searchParams.delete("endpoint");
  const target = `${ramApiUrl.replace(/\/+$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}${url.search ? `?${url.searchParams}` : ""}`;

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const auth = req.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: ["POST", "PUT", "PATCH"].includes(req.method) ? await req.text() : undefined,
    redirect: "manual", // Trap 302 redirects
  });

  if (res.status >= 300 && res.status < 400) {
    return new Response(JSON.stringify({ error: "Session expired or unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}
```

#### Client-Side Device Flow & API Caller (Method 1):
```ts
export class StatelessRamClient {
  constructor(private proxyUrl: string, private getToken: () => string | null) {}

  private async api<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${this.proxyUrl}?endpoint=${encodeURIComponent(endpoint)}`, { ...init, headers });
    if (!res.ok) throw new Error(`RAM API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  listCollections = () => this.api<{ items: any[] }>("/collections?limit=50");
  listAgents = () => this.api<{ items: any[] }>("/agents?limit=50");
  sendQuerySync = (content: string, agentId?: string) =>
    this.api<any>("/query?synchronous=true&persistent=true", {
      method: "POST",
      body: JSON.stringify({ content, agentId }),
    });
}
```

---

## 5. Method 2: Stateful Application Gateway Pattern

An enterprise production pattern for dedicated backend services (FastAPI, Express/NestJS, Go, Spring Boot) that maintains user sessions server-side, manages token lifecycles with concurrency locks, and provides 504-immune asynchronous execution for long-running retrieval agent queries.

```
[ Browser Client ]
       │  (HttpOnly Session Cookie: ram_sid)
       ▼
[ Application Gateway (FastAPI / Express / Go) ]
   ├── 1. Session Binding: Maps ram_sid to server token store
   ├── 2. Device Auth / Viya Engine: Handles PKCE & SASLogon server-side
   ├── 3. Concurrency Mutex Lock: Serializes token refresh (prevents token burn)
   ├── 4. 504-Immune Async Poller: Submits with synchronous=false & polls
   ├── 5. Live Trace Aggregator: Gathers /toolCalls, /retrievalCalls, /llmCalls
   ├── 6. Ad-Hoc Extractor: Parses PDF/DOCX into prompt budget (20k chars)
   └── 7. Session Persistence: Writes sessions to disk (survives restarts)
       │  (Authorization: Bearer <Token>)
       ▼
[ SAS Ingress Gateway & RAM v1 REST APIs ]
```

### Core Architecture & Gateway Routes

#### 1. Session Binding (`ram_sid` Cookie)
- The router assigns each browser an `HttpOnly`, `SameSite=Lax`, `Path=/api/ram` cookie containing a unique `ram_sid`.
- All tokens are stored exclusively server-side in a session registry.
- Sessions holding refresh tokens are persisted to `RAM_SESSION_FILE` (mode `0600`) so server restarts do not sign users out.
- Browser keeps an encrypted fallback copy in `localStorage` to restore via `POST /api/ram/auth/restore` after fresh container redeploys.

#### 2. Interactive Sign-In Routes (`/api/ram/auth/*`)
- `POST /api/ram/auth/device/start`:
  - Generates PKCE `code_verifier` and `code_challenge`.
  - Calls RAM device authorization endpoint with `client_id=sas-ram-api`.
  - Stores `verifier` and `device_code` in session; returns `userCode`, `verificationUri`.
- `POST /api/ram/auth/device/poll`:
  - Polls token endpoint with `grant_type=device_code` and `code_verifier`.
  - When approved, stores `access_token` and `refresh_token` in session and returns `{"ok": true}`.
- `POST /api/ram/auth/viya/code`: Exchanges pasted SASLogon authorization code (`sas.cli`) for environments using SAS Viya.
- `POST /api/ram/auth/signout`: Revokes session, forgets tokens, and clears `ram_sid` cookie.
- `POST /api/ram/auth/restore`: Accepts saved session payload from browser after backend cold restarts.

#### 3. Concurrency-Locked Token Refresh (Preventing Token Burn)
To prevent Keycloak/OIDC single-use token rotation race conditions:
```python
_locks: dict[str, asyncio.Lock] = {}

def _lock(sid: str) -> asyncio.Lock:
    if sid not in _locks: _locks[sid] = asyncio.Lock()
    return _locks[sid]

async def get_valid_token(sid: str, session: dict) -> str:
    # Fast-path check
    if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
        return session["token"]
    async with _lock(sid):
        # Double-check inside mutex
        if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
            return session["token"]
        # Perform refresh
        new_tokens = await execute_refresh_grant(session["refresh_token"])
        session["token"], session["refresh_token"] = new_tokens["access_token"], new_tokens.get("refresh_token")
        session["expires_at"] = time.time() + new_tokens.get("expires_in", 300)
        return session["token"]
```

#### 4. 504-Immune Asynchronous Query Execution (`POST /api/ram/query`)
Complex retrieval agent queries regularly exceed 30–60s ingress proxy timeout limits.
- Gateway submits query with `synchronous=false&persistent=true`.
- RAM immediately returns HTTP 200/201: `{"id": "QUERY_UUID", "querySessionId": "SESSION_UUID"}`.
- If documents were attached, gateway inlines them directly into the prompt within a character budget:
  ```
  {question}

  --- Attached document: {filename} ---
  {extracted_text_within_budget}
  --- End of attached document ---

  Use the attached document content above to answer the question where relevant.
  ```

#### 5. Query Polling & Live Execution Tracing
- `GET /api/ram/query/{query_id}`: Polls query completion status every 2 seconds.
- `GET /api/ram/query/{query_id}/trace`: Concurrently queries sub-step endpoints using `filter=eq(parentQueryId,'{query_id}')`:
  - `GET /toolCalls`: tool execution inputs, arguments, outputs.
  - `GET /retrievalCalls`: KB retrieval search text, similarity scores, document chunks.
  - `GET /llmCalls`: LLM prompts, reasoning steps, token counts.

#### 6. Ad-Hoc Document Text Extraction (`POST /api/ram/extract`)
- Accepts uploaded `multipart/form-data` file (PDF, DOCX, TXT, CSV, JSON).
- Extracts plain text (PDF via `pypdf`, DOCX via `python-docx`).
- Truncates to prompt budget (`MAX_ATTACH_CHARS = 20_000`).
- Rejects images or scanned PDFs without text layers with HTTP 415/422 explaining OCR requirements.

### Method 2 Implementation Blueprint (Python / FastAPI)

```python
# Reference Implementation Blueprint (FastAPI Gateway Router)
import os, secrets, io, asyncio, time, base64, hashlib
from fastapi import APIRouter, Request, Response, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
import httpx

SESSION_COOKIE = "ram_sid"
MAX_ATTACH_CHARS = 20_000
_sessions: dict[str, dict] = {}
_locks: dict[str, asyncio.Lock] = {}

async def bind_session(request: Request, response: Response):
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid or sid not in _sessions:
        sid = secrets.token_urlsafe(24)
        _sessions[sid] = {"token": None, "refresh_token": None, "expires_at": 0, "device": {}}
        response.set_cookie(SESSION_COOKIE, sid, max_age=86400 * 30, httponly=True, samesite="lax", path="/api/ram")
    request.state.sid = sid
    request.state.session = _sessions[sid]

router = APIRouter(prefix="/api/ram", dependencies=[Depends(bind_session)])

# ── 1. Device Authorization (PKCE) ──
@router.post("/auth/device/start")
async def auth_device_start(request: Request):
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
        r = await client.post(DEVICE_AUTH_URL, data={
            "client_id": "sas-ram-api", "scope": "openid",
            "code_challenge": challenge, "code_challenge_method": "S256"
        })
    data = r.json()
    request.state.session["device"] = {"verifier": verifier, "device_code": data["device_code"]}
    return data

@router.post("/auth/device/poll")
async def auth_device_poll(request: Request):
    dev = request.state.session.get("device", {})
    if not dev.get("device_code"): raise HTTPException(400, "No device auth in progress")
    async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
        r = await client.post(TOKEN_URL, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": "sas-ram-api", "device_code": dev["device_code"],
            "code_verifier": dev["verifier"]
        })
    data = r.json()
    if r.status_code == 200:
        s = request.state.session
        s["token"], s["refresh_token"] = data["access_token"], data.get("refresh_token")
        s["expires_at"] = time.time() + data.get("expires_in", 300)
        s["device"] = {}
        return {"ok": True}
    if data.get("error") in ("authorization_pending", "slow_down"):
        return {"pending": True, "slowDown": data.get("error") == "slow_down"}
    raise HTTPException(400, data.get("error_description", "Auth failed"))

# ── 2. Async Query Submission ──
class QueryRequest(BaseModel):
    content: str
    agentId: str | None = None
    querySessionId: str | None = None
    attachments: list[dict] | None = None

@router.post("/query")
async def submit_query(body: QueryRequest, request: Request):
    token = request.state.session.get("token")
    if not token: raise HTTPException(401, "Sign in required")

    content = body.content
    if body.attachments:
        for a in body.attachments:
            content += f"\n\n--- Attached document: {a['name']} ---\n{a['text'][:MAX_ATTACH_CHARS]}\n--- End of attached document ---"
        content += "\n\nUse the attached document content above to answer the question where relevant."

    payload = {"content": content, "agentId": body.agentId, "querySessionId": body.querySessionId}
    async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
        r = await client.post(f"{RAM_API_URL}/query?synchronous=false&persistent=true",
                              headers={"Authorization": f"Bearer {token}"}, json=payload)
    data = r.json()
    return {"queryId": data.get("id"), "querySessionId": data.get("querySessionId")}

# ── 3. Query Polling & Trace Aggregation ──
@router.get("/query/{query_id}")
async def query_status(query_id: str, request: Request):
    token = request.state.session.get("token")
    async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
        r = await client.get(f"{RAM_API_URL}/query/{query_id}", headers={"Authorization": f"Bearer {token}"})
    return r.json()

@router.get("/query/{query_id}/trace")
async def query_trace(query_id: str, request: Request):
    token = request.state.session.get("token")
    flt = f"eq(parentQueryId,'{query_id}')"
    h = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(verify=VERIFY_SSL) as client:
        t, r, l = await asyncio.gather(
            client.get(f"{RAM_API_URL}/toolCalls", params={"filter": flt}, headers=h),
            client.get(f"{RAM_API_URL}/retrievalCalls", params={"filter": flt}, headers=h),
            client.get(f"{RAM_API_URL}/llmCalls", params={"filter": flt}, headers=h),
            return_exceptions=True
        )
    return {
        "toolCalls": t.json().get("items", []) if not isinstance(t, Exception) and t.status_code == 200 else [],
        "retrievalCalls": r.json().get("items", []) if not isinstance(r, Exception) and r.status_code == 200 else [],
        "llmCalls": l.json().get("items", []) if not isinstance(l, Exception) and l.status_code == 200 else [],
    }

# ── 4. Document Text Extraction ──
@router.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    data = await file.read()
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        from pypdf import PdfReader
        text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    elif ext in ("txt", "md", "csv", "json"):
        text = data.decode("utf-8", errors="replace")
    else:
        raise HTTPException(415, f"Unsupported format: .{ext}")
    return {"name": file.filename, "text": text[:MAX_ATTACH_CHARS], "truncated": len(text) > MAX_ATTACH_CHARS}
```

#### Universal Frontend Client for Method 2 (JavaScript):
```javascript
export async function startDeviceLogin() {
  return fetch('/api/ram/auth/device/start', { method: 'POST', credentials: 'same-origin' }).then(r => r.json());
}

export async function pollDeviceLogin() {
  return fetch('/api/ram/auth/device/poll', { method: 'POST', credentials: 'same-origin' }).then(r => r.json());
}

export async function submitAndStreamQuery({ content, agentId, sessionId, attachments, onTrace }) {
  // 1. Submit async query (sends HttpOnly ram_sid cookie automatically)
  const res = await fetch('/api/ram/query', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, agentId, querySessionId: sessionId, attachments }),
  }).then(r => r.json());

  const queryId = res.queryId;

  // 2. Poll query status and live trace
  while (true) {
    await new Promise(res => setTimeout(res, 2000));
    if (onTrace) fetch(`/api/ram/query/${queryId}/trace`, { credentials: 'same-origin' }).then(r => r.json()).then(onTrace).catch(() => {});

    const status = await fetch(`/api/ram/query/${queryId}`, { credentials: 'same-origin' }).then(r => r.json());
    if (status.status === 'completed') return status;
    if (status.status === 'failed') throw new Error(status.error || 'Agent execution failed');
  }
}
```

---

## 6. Universal Enterprise Gotchas & Troubleshooting

| Symptom | Root Cause | Universal Fix |
| :--- | :--- | :--- |
| **`SyntaxError: Unexpected token '<'` (HTML returned)** | Upstream gateway returned a `302/307 Redirect` to an HTML login page. | Set proxy redirect behavior to `manual`. Intercept 3xx responses and return JSON `{"error": "Unauthorized"}` with HTTP 401. |
| **HTTP 504 Gateway Timeout** | Ingress controller killed idle HTTP connection during synchronous `POST /query`. | Submit query with `synchronous=false&persistent=true` and poll `GET /query/{id}` every 2s. |
| **Token Burn / `invalid_grant` Logouts** | Multiple concurrent requests triggered simultaneous refresh with single-use refresh token. | Implement per-session mutex lock (`asyncio.Lock`) around token refresh operations. |
| **`DEPTH_ZERO_SELF_SIGNED_CERT` / SSL Failure** | Internal enterprise CA cert not trusted by runtime trust store. | In dev, set `NODE_TLS_REJECT_UNAUTHORIZED=0` or `verify=False`. In prod, mount corporate CA certificate. |
| **CORS Errors in Browser** | Browser called SAS RAM URL directly. | Route all API calls through the proxy layer (`/api/proxy` or `/api/ram`). |
| **Scanned PDF Returns Empty Text** | Document contains bitmap images without an embedded text layer. | Return HTTP 422 informing the user that OCR is required. |

---

## 7. Direct cURL Diagnostic Playbook

Test any SAS RAM environment directly from terminal:

```bash
export RAM_BASE="https://<your-sas-host>"
export RAM_API="${RAM_BASE}/SASRetrievalAgentManager/api/v1"
export REALM="sas-iot"

# 1. Request Device Code (PKCE)
curl -k -X POST "${RAM_BASE}/SASRetrievalAgentManager/auth/realms/${REALM}/protocol/openid-connect/auth/device" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=sas-ram-api&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
# Displays user_code and verification_uri. User approves in browser.

# 2. Exchange Device Code for Token
curl -k -X POST "${RAM_BASE}/SASRetrievalAgentManager/auth/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=sas-ram-api&device_code=DEVICE_CODE&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

export TOKEN="<access_token>"

# 3. List Knowledge Base Collections
curl -k -X GET "${RAM_API}/collections?limit=10" \
  -H "Authorization: Bearer ${TOKEN}"

# 4. List Configured Retrieval Agents
curl -k -X GET "${RAM_API}/agents?limit=10" \
  -H "Authorization: Bearer ${TOKEN}"

# 5. Submit Asynchronous Query
curl -k -X POST "${RAM_API}/query?synchronous=false&persistent=true" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Summarize policy guidelines", "agentId": "AGENT_UUID"}'
# Returns {"id": "QUERY_UUID", ...}

# 6. Poll Query Status
curl -k -X GET "${RAM_API}/query/QUERY_UUID" \
  -H "Authorization: Bearer ${TOKEN}"

# 7. Query Execution Tool & Retrieval Traces
curl -k -X GET "${RAM_API}/toolCalls?filter=eq(parentQueryId,'QUERY_UUID')" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 8. Companion Templates & Reference Files

Drop-in implementation files, OpenAPI specs, and reference documentation available in this skill package:

### Reference Specifications (`references/` & `examples/`)
* **OpenAPI 3.0 Contract**: [`references/openapi-v1.yml`](./references/openapi-v1.yml) *(3,770-line complete OpenAPI 3.0 specification for SAS RAM v1)*
* **API Overview & Schemas**: [`references/api-overview.md`](./references/api-overview.md) *(Detailed REST endpoints, query parameters, schemas, and trace endpoints)*
* **Authentication Reference**: [`references/authentication.md`](./references/authentication.md) *(RFC 8628 Device Code Flow with PKCE, Viya SASLogon, and concurrency-locked token rotation)*
* **BFF Proxy & Gateway Architecture**: [`references/bff-proxy-pattern.md`](./references/bff-proxy-pattern.md) *(Method 1 vs. Method 2 comparison, 302 redirect trap interception, and SSL handling)*
* **cURL Walkthrough**: [`examples/curl-walkthrough.md`](./examples/curl-walkthrough.md) *(Hands-on terminal guide for validating RAM connections step-by-step)*

### Method 1: Stateless Pass-Through BFF Proxy Templates (`templates/`)
* **Environment Configuration**: [`templates/.env.example`](./templates/.env.example)
* **TypeScript Ready Files**:
  * Type Definitions: [`templates/typescript/types.d.ts`](./templates/typescript/types.d.ts)
  * Proxy Route Handler: [`templates/typescript/api-proxy-route.ts`](./templates/typescript/api-proxy-route.ts)
  * Device Auth Service: [`templates/typescript/auth-device-flow.ts`](./templates/typescript/auth-device-flow.ts)
  * Query / Chat Service: [`templates/typescript/chat-service.ts`](./templates/typescript/chat-service.ts)
* **JavaScript Ready Files**:
  * Proxy Route Handler: [`templates/javascript/api-proxy-route.js`](./templates/javascript/api-proxy-route.js)
  * Device Auth Service: [`templates/javascript/auth-device-flow.js`](./templates/javascript/auth-device-flow.js)
  * Query / Chat Service: [`templates/javascript/chat-service.js`](./templates/javascript/chat-service.js)

### Method 2: Stateful Application Gateway Templates (`templates/python/` & `templates/javascript/`)
* **FastAPI Gateway Router**: [`templates/python/ram_router.py`](./templates/python/ram_router.py) *(Complete implementation with `ram_sid` session cookies, PKCE device flow, SASLogon exchange, mutex refresh, 504-immune async polling, live traces, and file extraction)*
* **Gateway Client (Frontend)**: [`templates/javascript/gateway-client.js`](./templates/javascript/gateway-client.js) *(Client-side helper for cookie-backed session binding, polling, and trace streaming)*
