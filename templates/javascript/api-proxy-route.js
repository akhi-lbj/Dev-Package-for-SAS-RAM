// Next.js Route Handler (JavaScript) - Proxy for SAS Retrieval Agent Manager (RAM)

// Allow self-signed SSL certificates in development mode
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function getForwardHeaders(request) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }

  return headers;
}

/**
 * Proxy GET requests to SAS RAM v1 API
 * Usage: GET /api/ram-proxy?endpoint=/collections?limit=50&start=0
 */
export async function GET(request) {
  const ramUrl = process.env.RAM_URL?.replace(/\/+$/, "");
  if (!ramUrl) {
    return new Response("RAM_URL not configured", { status: 500 });
  }

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return new Response("Missing 'endpoint' query parameter", { status: 400 });
  }

  const apiUrl = `${ramUrl}/SASRetrievalAgentManager/api/v1${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const forwardHeaders = getForwardHeaders(request);

  const response = await fetch(apiUrl, {
    headers: forwardHeaders,
    redirect: "manual", // CRITICAL: Do not follow redirects!
  });

  // Intercept oauth2-proxy redirect to SAS login page (which indicates unauthenticated)
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return new Response(JSON.stringify({ error: "Not authenticated with SAS RAM backend" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(errorText, {
      status: response.status,
      headers: response.headers,
    });
  }

  return response;
}

/**
 * Proxy POST requests to SAS RAM v1 API
 * Usage: POST /api/ram-proxy?endpoint=/query&synchronous=true&persist=true
 */
export async function POST(request) {
  const ramUrl = process.env.RAM_URL?.replace(/\/+$/, "");
  if (!ramUrl) {
    return new Response("RAM_URL not configured", { status: 500 });
  }

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return new Response("Missing 'endpoint' query parameter", { status: 400 });
  }

  const searchParams = new URLSearchParams(request.nextUrl.searchParams);
  searchParams.delete("endpoint");
  const queryString = searchParams.toString();
  const fullUrl = `${ramUrl}/SASRetrievalAgentManager/api/v1${endpoint}${queryString ? `?${queryString}` : ""}`;

  const requestBody = await request.json();
  const forwardHeaders = getForwardHeaders(request);

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(requestBody),
    redirect: "manual", // CRITICAL: Do not follow redirects!
  });

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return new Response(JSON.stringify({ error: "Not authenticated with SAS RAM backend" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(errorText, {
      status: response.status,
      headers: response.headers,
    });
  }

  return response;
}
