# Backend-For-Frontend (BFF) Proxy Pattern for SAS RAM

When building web applications that integrate with SAS Retrieval Agent Manager (RAM), **never call SAS RAM endpoints directly from browser client JavaScript**.

Always route client calls through a server-side proxy route (e.g., Next.js App Router Route Handler, Express, or FastAPI).

---

## 1. Why a BFF Proxy is Mandatory

1. **CORS Restrictions**: SAS RAM REST endpoints do not permit arbitrary cross-origin browser requests by default.
2. **Token Security**: Prevents raw tokens or service secrets from being exposed directly to the browser DOM.
3. **Gateway Redirect Interception**: SAS RAM is shielded behind an `oauth2-proxy` gateway which behaves differently from standard REST APIs when unauthenticated.
4. **SSL / Self-Signed Certificates**: Corporate SAS deployments often use internal or self-signed certificates. Node.js backend proxies can easily manage SSL validation in development.

---

## 2. The Critical Gotcha: Intercepting `oauth2-proxy` Redirects

### The Problem:
When a client sends an invalid, expired, or missing `Authorization` header to SAS RAM, the ingress gateway (`oauth2-proxy`) **does NOT return an HTTP 401 Unauthorized status code**. 

Instead, it returns an **HTTP 302 Redirect** pointing to the SAS login HTML page.

By default, the standard `fetch()` API in Node.js/browsers automatically follows redirects. As a result:
- The server receives the SAS HTML login document.
- It returns HTTP `200 OK` to your frontend.
- The frontend attempts to parse the response as JSON (`response.json()`), crashing with:
  `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

### The Solution:
In your proxy route handler, you **must set `redirect: "manual"`** on all outbound `fetch()` requests and check for redirect status codes:

```ts
const response = await fetch(targetUrl, {
  method: request.method,
  headers: forwardHeaders,
  body: requestBody,
  redirect: "manual", // CRITICAL: Do not automatically follow redirects!
});

// Intercept unauthenticated redirects and return a clean 401 JSON response
if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
  return new Response(JSON.stringify({ error: "Not authenticated with RAM backend" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
```

---

## 3. Handling Self-Signed SSL Certificates

In development or proof-of-concept environments, SAS Viya servers often run with company internal or self-signed certificates.

In your proxy utility (e.g., `src/lib/fetch-config.ts`):
```ts
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
```
*(Warning: For production deployments, install the trusted SAS CA bundle in your container/OS rather than globally disabling TLS verification).*

---

## 4. URL Mapping Pattern

Standardize your proxy URL structure so the frontend can query any RAM endpoint simply:

* **Frontend call**:
  `GET /custom-chat-api?endpoint=/collections`
* **Proxy maps to**:
  `${process.env.RAM_URL}/SASRetrievalAgentManager/api/v1/collections`

* **Frontend call**:
  `POST /custom-chat-api?endpoint=/query&synchronous=true&persist=true`
* **Proxy maps to**:
  `${process.env.RAM_URL}/SASRetrievalAgentManager/api/v1/query?synchronous=true&persist=true`
