# Intermediary Proxy Patterns for SAS RAM: Method 1 vs. Method 2

When connecting custom web applications or agents to SAS Retrieval Agent Manager (RAM), **never call SAS RAM endpoints directly from browser JavaScript**.

CORS policies and SAS network ingress controllers block cross-origin browser traffic. An intermediary backend layer is mandatory.

---

## 1. Architectural Patterns Overview

| Feature | Method 1: Stateless Pass-Through BFF Proxy | Method 2: Stateful Application Gateway |
| :--- | :--- | :--- |
| **Core Mechanism** | Transparent reverse proxy; client manages tokens | Dedicated backend gateway; browser binds via `HttpOnly` cookie |
| **Token Handling** | Client passes `Authorization: Bearer <token>` | Tokens held server-side; client never sees JWTs |
| **Session Model** | Stateless (no memory/disk store on server) | Stateful: `ram_sid` cookie mapped to memory store + disk backup |
| **Timeout Handling** | Client orchestrates async polling manually | Gateway enforces async `synchronous=false` & polls upstream |
| **Trace Aggregation** | Client queries trace endpoints individually | Gateway aggregates `/toolCalls`, `/retrievalCalls`, `/llmCalls` |
| **Document Inlining** | Client manually parses & concatenates text | Gateway exposes `/extract` endpoint with character budgeting |
| **Recommended Runtime** | Serverless / Edge (Next.js route handlers, Express) | Long-running backend servers (FastAPI, Express, Go, Spring Boot) |

---

## 2. The Universal Gotcha: The 302 Redirect Trap

### The Problem
When a client sends an invalid, expired, or missing `Authorization` header to SAS RAM, the ingress gateway (`oauth2-proxy` or ingress controller) **does NOT return an HTTP 401 Unauthorized status code**.

Instead, it returns an **HTTP 302/307 Redirect** pointing to an HTML login page.

By default, the standard `fetch()` API in browsers and Node.js automatically follows redirects. As a result:
1. The server fetches the SAS HTML login document.
2. It returns HTTP `200 OK` to the frontend with an HTML document payload.
3. The frontend attempts to parse the response as JSON (`res.json()`), crashing with:
   `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

### The Universal Fix
In your proxy or gateway handler, always set **`redirect: "manual"`** on upstream requests:

```ts
const res = await fetch(targetUrl, {
  method: req.method,
  headers: upstreamHeaders,
  body: reqBody,
  redirect: "manual", // CRITICAL: Stop automatic redirect chasing
});

// Intercept 3xx redirect responses and convert to clean 401 JSON
if (res.status >= 300 && res.status < 400) {
  return new Response(JSON.stringify({ error: "Session expired or unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## 3. Method 1: Stateless BFF Proxy Contract

Under Method 1, the proxy layer forwards queries transparently while handling CORS and redirect trapping.

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
    redirect: "manual",
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

---

## 4. Method 2: Stateful Application Gateway Contract

Under Method 2, the gateway owns the token lifecycle and isolates the browser using an `HttpOnly` cookie (`ram_sid`).

### Key Responsibilities:
1. **Cookie Session Binding**: Sets `Set-Cookie: ram_sid=...; HttpOnly; SameSite=Lax; Path=/api/ram`.
2. **Concurrency Mutex Lock**: Protects token refresh with a per-session mutex (`asyncio.Lock`) so simultaneous requests don't burn single-use refresh tokens.
3. **Session Persistence**: Writes active tokens to a local session file (e.g. `.ram_sessions.json` with `0600` permissions) so backend restarts don't sign out users.
4. **504 Timeout Immunity**: Always passes `synchronous=false` to `POST /query`, returns `queryId`, and handles background polling.
5. **Trace Aggregation**: Concurrently queries `/toolCalls`, `/retrievalCalls`, and `/llmCalls` using `parentQueryId`.
6. **File Text Extraction**: Accepts multipart uploads (PDF, DOCX, TXT), strips binary headers, and truncates text to fit within prompt token budgets.
