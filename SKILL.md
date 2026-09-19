---
name: sas-ram-integration
description: >-
  Comprehensive, all-in-one guide and code recipes for integrating frontend and
  full-stack applications with SAS Retrieval Agent Manager (RAM) v1 REST APIs. Use
  this skill whenever building, configuring, or debugging an application connecting
  to SAS RAM, implementing OAuth 2.0 Device Code authentication with PKCE, setting up
  Backend-For-Frontend (BFF) API proxies, or executing retrieval agent queries against
  private document collections.
---

# SAS Retrieval Agent Manager (RAM) — Master Integration Guide

This is the all-encompassing guide for building, configuring, and deploying web applications that connect to **SAS Retrieval Agent Manager (RAM)**. It contains complete architectural patterns, API contracts, inline code recipes, and troubleshooting runbooks.

---

## Table of Contents
1. [Architecture Overview: The BFF Proxy Pattern](#1-architecture-overview-the-bff-proxy-pattern)
2. [Environment Configuration](#2-environment-configuration)
3. [Authentication: OAuth 2.0 Device Code Flow (RFC 8628)](#3-authentication-oauth-20-device-code-flow-rfc-8628)
4. [BFF Proxy Implementation & Gateway Gotchas](#4-bff-proxy-implementation--gateway-gotchas)
5. [Core SAS RAM REST API Reference](#5-core-sas-ram-rest-api-reference)
6. [Frontend Client Implementation](#6-frontend-client-implementation)
7. [Step-by-Step Project Scaffolding Recipe](#7-step-by-step-project-scaffolding-recipe)
8. [cURL Verification Playbook](#8-curl-verification-playbook)
9. [Troubleshooting & Gotchas Matrix](#9-troubleshooting--gotchas-matrix)
10. [Companion Templates & Reference Files](#10-companion-templates--reference-files)

---

## 1. Architecture Overview: The BFF Proxy Pattern

Custom web applications **must not** make direct HTTP calls from the browser to SAS RAM. Always use a **Backend-For-Frontend (BFF)** proxy layer (e.g., Next.js App Router Route Handler, Express, or FastAPI):

```
[ Browser Client ]
       │
       │  (JSON / Bearer Token)
       ▼
[ Application Server / BFF Proxy ]  <─── Handles self-signed SSL/TLS certs
       │                                 Intercepts 302 redirects -> 401 JSON
       │  (Authorization: Bearer <JWT>)
       ▼
[ SAS Ingress Gateway (oauth2-proxy) ]
       │
  ┌────┴───────────────────────────┐
  ▼                                ▼
[ SAS RAM Auth Service (/auth) ] [ SAS RAM API v1 ]
  - Device Auth (/auth/device)    - Collections (/collections)
  - Token Exchange (/token)       - Agents (/agents)
                                  - Query Execution (/query)
                                  - Chat Sessions (/querySessions)
```

### Why a BFF Proxy is Mandatory:
1. **CORS Restrictions**: SAS RAM APIs do not allow cross-origin browser requests by default.
2. **The 302 Redirect Trap**: When a token expires, the SAS ingress gateway returns an **HTTP 302 redirect to login HTML** instead of an HTTP 401. A proxy intercepts this and returns a clean JSON error.
3. **Internal SSL Certificates**: Enterprise SAS deployments often use internal or self-signed TLS certificates that Node.js backend proxies can cleanly handle in development.

---

## 2. Environment Configuration

Create a `.env` file at the root of your application:

```env
# Base URL for your SAS Retrieval Agent Manager instance (no trailing slash)
RAM_URL=https://<your-sas-ram-host>

# Optional URL prefix when served under a subpath (e.g., /ChatExtension)
NEXT_PUBLIC_BASE_PATH=
```

---

## 3. Authentication: OAuth 2.0 Device Code Flow (RFC 8628)

The **OAuth 2.0 Device Authorization Grant with PKCE** is the standard, zero-friction authentication method for custom SAS RAM applications.

### Why Device Code Flow is the Golden Standard:
* **Zero Administrator Setup**: Uses the built-in public client `sas-ram-api`. Does not require administrative access to configure redirect URL whitelists.
* **Domain Independent**: Works identically on `localhost:3000`, staging environments, or production domains.
* **Maximum Security**: Passwords are never handled or seen by your code. Users authenticate directly on SAS's secure domain using their existing credentials or active browser session.

### Sequence Flow:
```
[ Your Web App ]               [ Next.js Proxy ]                [ SAS Auth Service ]
       │                              │                                  │
  1. Click "Sign in"                  │                                  │
       │─────────────────────────────>│ POST /login                      │
       │                              │─────────────────────────────────>│ 2. Request Device Code
       │                              │                                  │    (client_id: sas-ram-api)
       │                              │<─────────────────────────────────│ 3. Returns:
       │                              │                                  │    - user_code (e.g. STDC-OFPE)
       │<─────────────────────────────│                                  │    - verification_uri
  4. Display user code & link         │                                  │    - device_code
       │                              │                                  │
  5. User opens verification_uri      │                                  │
     and enters code in SAS ────────────────────────────────────────────>│ 6. User clicks "Grant"
       │                              │                                  │    (uses active SAS cookie)
       │                              │ 7. Background Polling            │
       │                              │    POST /token...                │
       │                              │<─────────────────────────────────│    "authorization_pending"
       │                              │                                  │
       │                              │ 8. Upon authorization:           │
       │                              │    POST /token...                │
       │                              │<─────────────────────────────────│    Returns JWT Access Token!
       │<─────────────────────────────│                                  │
  9. App stores token & loads data!   │                                  │
```

### Complete Implementation Code:

#### TypeScript Implementation:
```ts
import { createHash, randomBytes } from "node:crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function initiateDeviceAuthorization(ramUrl: string) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const authUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/auth/device`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "sas-ram-api",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "openid",
    }),
  });

  if (!response.ok) throw new Error(`Device auth failed: ${response.status}`);
  const data = await response.json();
  return { ...data, code_verifier: codeVerifier };
}

export async function pollDeviceToken(ramUrl: string, deviceCode: string, codeVerifier: string) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const tokenUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: "sas-ram-api",
      device_code: deviceCode,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (err.error === "authorization_pending") return { status: "pending" };
    throw new Error(err.error_description || err.error || "Token exchange failed");
  }

  return { status: "ready", tokens: await response.json() };
}

export async function refreshAccessToken(ramUrl: string, refreshToken: string) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const tokenUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "sas-ram-api",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) throw new Error("Token refresh failed");
  return response.json();
}
```

---

## 4. BFF Proxy Implementation & Gateway Gotchas

Create a server-side route handler (e.g. `src/app/custom-chat-api/route.ts` in Next.js, or an Express router):

```ts
import { NextRequest } from "next/server";

// Allow self-signed internal certificates in development
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function getForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authHeader = request.headers.get("authorization");
  if (authHeader) headers.set("Authorization", authHeader);
  return headers;
}

export async function GET(request: NextRequest) {
  const ramUrl = process.env.RAM_URL?.replace(/\/+$/, "");
  if (!ramUrl) return new Response("RAM_URL not configured", { status: 500 });

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return new Response("Endpoint parameter required", { status: 400 });

  const apiUrl = `${ramUrl}/SASRetrievalAgentManager/api/v1${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  
  const response = await fetch(apiUrl, {
    headers: getForwardHeaders(request),
    redirect: "manual", // CRITICAL: Never follow redirects automatically!
  });

  // Intercept gateway 302 redirects to login HTML and return clean 401
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return new Response(JSON.stringify({ error: "Not authenticated with SAS RAM backend" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return response;
}

export async function POST(request: NextRequest) {
  const ramUrl = process.env.RAM_URL?.replace(/\/+$/, "");
  if (!ramUrl) return new Response("RAM_URL not configured", { status: 500 });

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return new Response("Endpoint parameter required", { status: 400 });

  const searchParams = new URLSearchParams(request.nextUrl.searchParams);
  searchParams.delete("endpoint");
  const queryStr = searchParams.toString();
  const fullUrl = `${ramUrl}/SASRetrievalAgentManager/api/v1${endpoint}${queryStr ? `?${queryStr}` : ""}`;

  const body = await request.json();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: getForwardHeaders(request),
    body: JSON.stringify(body),
    redirect: "manual", // CRITICAL: Never follow redirects automatically!
  });

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return new Response(JSON.stringify({ error: "Not authenticated with SAS RAM backend" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return response;
}
```

---

## 5. Core SAS RAM REST API Reference

Base Endpoint: `{RAM_URL}/SASRetrievalAgentManager/api/v1`

### 1. Document Collections (`GET /collections`)
Lists knowledge base collections available to the authenticated user.
* **Query Params**: `limit` (default: 50, max: 100), `start` (offset).
* **Response**:
```json
{
  "count": 3,
  "limit": 50,
  "start": 0,
  "name": "collections",
  "items": [
    {
      "id": "60918895-0702-4c77-83c6-96fc52cd80a0",
      "name": "Healthcare Claims Data",
      "description": "Historical insurance records and analysis"
    }
  ]
}
```

### 2. Retrieval Agents (`GET /agents`)
Lists configured reasoning/retrieval agents.
* **Query Params**: `limit`, `start`.
* **Response**:
```json
{
  "count": 1,
  "limit": 50,
  "start": 0,
  "name": "agents",
  "items": [
    {
      "id": "60918895-0702-4c77-83c6-96fc52cd80a0",
      "name": "Default Retrieval Agent",
      "status": "ready"
    }
  ]
}
```

### 3. Query Execution (`POST /query`)
Executes a prompt against an agent or collection.
* **URL**: `POST /query?synchronous=true&persist=true`
  * `synchronous=true`: Returns the synthesized answer immediately in the response body.
  * `persist=true`: Automatically logs the question and answer in SAS RAM session history.
* **Request Body**:
```json
{
  "content": "What are the common occurrences in the male diabetes dataset?",
  "agentId": "60918895-0702-4c77-83c6-96fc52cd80a0",
  "querySessionId": "optional-existing-session-uuid"
}
```
* **Response (`201 Created` or `200 OK`)**:
```json
{
  "id": "query-uuid-5678",
  "querySessionId": "session-uuid-1234",
  "content": "Based on the records, the occurrences show a strong correlation with...",
  "status": "completed",
  "sources": [
    {
      "documentName": "Diabetes_Study_2025.pdf",
      "page": 7,
      "snippet": "...occurrences in male demographic cohorts..."
    }
  ],
  "insertTimestamp": "2026-09-19T11:00:05Z"
}
```

### 4. Query Sessions (`GET /querySessions`)
Lists conversation history sessions.
* **URL**: `GET /querySessions?sortBy=insertTimestamp:descending`
* **Response**:
```json
{
  "count": 5,
  "items": [
    {
      "id": "session-uuid-1234",
      "title": "What are the common occurrences in the male diabetes dataset?",
      "insertTimestamp": "2026-09-19T11:00:00Z"
    }
  ]
}
```

### 5. Fetch Session Messages (`GET /query`)
Retrieves past back-and-forth messages for a specific session:
* **URL**: `GET /query?filter=eq(querySessionId,<sessionId>)`

---

## 6. Frontend Client Implementation

Use standard Redux Toolkit Query or a lightweight client class to call the proxy:

### Lightweight Client Class (TypeScript / JavaScript):
```ts
export class SasRamClient {
  private proxyUrl: string;
  private getToken: () => string | null;

  constructor(proxyUrl = "/api/custom-chat-api", getToken: () => string | null = () => null) {
    this.proxyUrl = proxyUrl;
    this.getToken = getToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${this.proxyUrl}?endpoint=${encodeURIComponent(endpoint)}`, {
      ...options,
      headers,
    });

    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  getCollections() {
    return this.request<{ items: any[] }>("/collections?limit=100&start=0");
  }

  getAgents() {
    return this.request<{ items: any[] }>("/agents?limit=100&start=0");
  }

  getSessions() {
    return this.request<{ items: any[] }>("/querySessions?sortBy=insertTimestamp:descending");
  }

  getSessionMessages(sessionId: string) {
    return this.request<{ items: any[] }>(`/query?filter=eq(querySessionId,${sessionId})`);
  }

  sendQuery(content: string, agentId?: string, querySessionId?: string) {
    return this.request<any>("/query?synchronous=true&persist=true", {
      method: "POST",
      body: JSON.stringify({ content, agentId, querySessionId }),
    });
  }
}
```

---

## 7. Step-by-Step Project Scaffolding Recipe

To create a brand-new SAS RAM web application from scratch:

1. **Initialize Project**:
   ```bash
   npx -y create-next-app@latest my-ram-app --typescript --app --no-tailwind
   cd my-ram-app
   ```
2. **Set Environment**:
   Create `.env`:
   ```env
   RAM_URL=https://<your-sas-ram-host>
   ```
3. **Copy Templates**:
   * Copy [`templates/typescript/api-proxy-route.ts`](./templates/typescript/api-proxy-route.ts) to `src/app/custom-chat-api/route.ts`.
   * Copy [`templates/typescript/auth-device-flow.ts`](./templates/typescript/auth-device-flow.ts) to `src/services/auth.ts`.
   * Copy [`templates/typescript/types.d.ts`](./templates/typescript/types.d.ts) to `src/types/ram.d.ts`.
4. **Wire Up Sign-In Button**:
   * On click &rarr; Call `initiateDeviceAuthorization(process.env.NEXT_PUBLIC_RAM_URL)`.
   * Display `user_code` and `verification_uri`.
   * Start polling `pollDeviceToken` every 5 seconds.
   * On token received &rarr; Save `access_token` to React State / Context / Redux and route to `/chat`.
5. **Run Locally**:
   ```bash
   npm run dev
   ```

---

## 8. cURL Verification Playbook

Test your SAS RAM backend directly from terminal:

```bash
export RAM_URL="https://<your-sas-ram-host>"

# 1. Request Device Code & Verification URL
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/auth/device" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=sas-ram-api" \
  --data-urlencode "scope=openid" \
  --data-urlencode "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" \
  --data-urlencode "code_challenge_method=S256"

# 2. Open the returned verification_uri in your browser, enter the user_code, and grant access.

# 3. Exchange Device Code for Access Token
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  --data-urlencode "client_id=sas-ram-api" \
  --data-urlencode "device_code=PASTE_DEVICE_CODE_HERE" \
  --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

export ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIs..."

# 4. List Collections
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/collections?limit=10&start=0" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

# 5. List Agents
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/agents?limit=10&start=0" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

# 6. Execute Synchronous Query
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/api/v1/query?synchronous=true&persist=true" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, summarize the documents in this collection.", "agentId": "PASTE_AGENT_ID"}'
```

---

## 9. Troubleshooting & Gotchas Matrix

| Symptom / Error | Root Cause | Exact Solution |
| :--- | :--- | :--- |
| `SyntaxError: Unexpected token '<', "<!DOCTYPE "...` | Proxy followed the SAS ingress gateway's 302 redirect and returned HTML instead of JSON. | Set `redirect: "manual"` in proxy `fetch()`. Check if status is `3xx` or `opaqueredirect`, and return a clean HTTP `401 JSON`. |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | SAS server uses an internal enterprise or self-signed TLS certificate. | In development, add `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` to the proxy route handler. |
| `No Collections Available` | Incorrect `RAM_URL` or the authenticated SAS user lacks collection permissions. | Verify `RAM_URL` matches host, and verify in SAS RAM Admin UI that collections have been shared with the user. |
| Token Polling returns `400 authorization_pending` | Normal OAuth 2.0 Device Code behavior while waiting for the user to approve the code. | Keep polling at 5-second intervals until status is `200 OK`. Do not treat `authorization_pending` as a failure. |
| Chat answers do not persist in history | `POST /query` was sent without `persist=true`. | Always pass `?synchronous=true&persist=true` query parameters when submitting a query. |

---

## 10. Companion Templates & Reference Files

For drop-in files to copy into your codebase, use the companion assets in this skill:
* **Raw OpenAPI Specification**: [`references/openapi-v1.yml`](./references/openapi-v1.yml) *(3,770-line complete OpenAPI 3.0 contract)*
* **Environment Template**: [`templates/.env.example`](./templates/.env.example)
* **TypeScript Ready Files**:
  * Types: [`templates/typescript/types.d.ts`](./templates/typescript/types.d.ts)
  * Proxy Route: [`templates/typescript/api-proxy-route.ts`](./templates/typescript/api-proxy-route.ts)
  * Auth Service: [`templates/typescript/auth-device-flow.ts`](./templates/typescript/auth-device-flow.ts)
  * Chat Service (RTK Query): [`templates/typescript/chat-service.ts`](./templates/typescript/chat-service.ts)
* **JavaScript Ready Files**:
  * Proxy Route: [`templates/javascript/api-proxy-route.js`](./templates/javascript/api-proxy-route.js)
  * Auth Service: [`templates/javascript/auth-device-flow.js`](./templates/javascript/auth-device-flow.js)
  * Chat Service: [`templates/javascript/chat-service.js`](./templates/javascript/chat-service.js)
