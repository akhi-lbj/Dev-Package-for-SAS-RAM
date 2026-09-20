# SAS Retrieval Agent Manager (RAM) — Dev Package & Skill

Plug-and-play AI Agent Skill (`sas-ram-integration`), full REST API documentation, OpenAPI 3.0 specifications, and production-ready code templates (TypeScript, JavaScript, Python/FastAPI) for **SAS Retrieval Agent Manager (RAM)** v1 REST APIs.

---

## ⚡ Quick Install

Equip any AI coding agent (Antigravity, Cursor, Claude Code, Copilot) with the SAS RAM skill:

```bash
git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git .agents/skills/sas-ram-integration
```

*(Or copy [`SKILL.md`](./SKILL.md) directly into your workspace's `.agents/skills/sas-ram-integration/SKILL.md`).*

---

## 📖 REST API Documentation

- **Base URL**: `https://<sas-viya-host>/SASRetrievalAgentManager/api/v1/`
- **Authentication**: `Authorization: Bearer <access_token>` (OAuth 2.0 PKCE / SASLogon)
- **Official Specification**: [OpenAPI 3.0 YAML](./API_Docs/SASRetrievalAgentManager_openapi.yml) | [Machine-Readable JSON](./API_Docs/sas_ram_api_endpoints_complete.json)
- **Detailed Reference Manual**: [Complete 24-Endpoint Manual with Code & Response Samples](./API_Docs/SAS_RAM_API_Documentation_Scraped.md)

### Endpoints Reference Catalog (24 Endpoints)

| Category | Method | Endpoint | Description |
|---|:---:|---|---|
| **Discovery** | `GET` | `/` | List all public endpoints |
| **Query & Execution** | `POST` | `/query` | Execute an agent query (`synchronous=true/false`) |
| | `GET` | `/query` | List available queries and historical query states |
| | `GET` | `/querySessions` | List available query sessions and conversations |
| **Agent Observability** | `GET` | `/agents` | List all configured retrieval agents |
| | `GET` | `/retrievalCalls` | Inspect retrieval execution logs, chunks, and citations |
| | `GET` | `/toolCalls` | Inspect tool invocation records and execution outputs |
| | `GET` | `/llmCalls` | Inspect raw prompt and LLM completion records |
| | `GET` | `/llms` | List registered Large Language Model backends |
| | `GET` | `/collections` | List available vector document collections |
| **Knowledge Sources** | `GET` | `/sources` | List all registered document sources |
| | `POST` | `/sources` | Create a new knowledge source |
| | `GET` | `/sources/{sourceId}` | Get details of a specific source |
| | `DELETE` | `/sources/{sourceId}` | Delete a knowledge source |
| | `PUT` | `/sources/{sourceId}/triggerAutomation` | Trigger ingestion/automation pipeline for a source |
| **Source Files** | `GET` | `/sources/{sourceId}/files` | List indexed files within a source |
| | `POST` | `/sources/{sourceId}/files` | Upload/register a file in a source |
| | `GET` | `/sources/{sourceId}/files/{fileId}` | Retrieve metadata for a specific source file |
| | `DELETE` | `/sources/{sourceId}/files/{fileId}` | Remove a file from a knowledge source |
| | `PUT` | `/sources/{sourceId}/files/{fileId}/tags/{tagId}` | Tag a source file |
| | `DELETE` | `/sources/{sourceId}/files/{fileId}/tags/{tagId}` | Remove a tag from a source file |
| **Tag Management** | `GET` | `/tags` | List all source file tags |
| | `POST` | `/tags` | Create a new source file tag |
| | `DELETE` | `/tags/{tagId}` | Delete a source file tag |

---

### Quick Query Example (Async Execution Pattern)

Long-running agent queries should always run asynchronously (`synchronous=false`) to prevent gateway 504 timeouts.

#### JavaScript (Fetch)
```javascript
// 1. Submit Query
const submitRes = await fetch('https://<viya-host>/SASRetrievalAgentManager/api/v1/query?synchronous=false', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    query: "Summarize quarterly compliance risks",
    agentId: "risk-assessment-agent"
  })
});
const { id: queryId } = await submitRes.json();

// 2. Poll Status until completed
let result;
while (!result) {
  await new Promise(r => setTimeout(r, 2000));
  const pollRes = await fetch(`https://<viya-host>/SASRetrievalAgentManager/api/v1/query?filter=eq(id,'${queryId}')`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const data = await pollRes.json();
  const query = data.items?.[0];
  if (query && ['completed', 'failed'].includes(query.status)) {
    result = query;
  }
}
console.log("Agent Answer:", result.response);
```

#### Python (Requests / HTTPX)
```python
import time
import httpx

headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

# 1. Submit Query
payload = {"query": "Summarize quarterly compliance risks", "agentId": "risk-assessment-agent"}
resp = httpx.post(f"{BASE_URL}/query?synchronous=false", json=payload, headers=headers)
query_id = resp.json()["id"]

# 2. Poll for Completion
while True:
    time.sleep(2)
    poll_resp = httpx.get(f"{BASE_URL}/query?filter=eq(id,'{query_id}')", headers=headers).json()
    item = poll_resp.get("items", [{}])[0]
    if item.get("status") in ("completed", "failed"):
        print("Agent Response:", item.get("response"))
        break
```

---

## 🏗️ Architecture Decision Matrix

| Dimension | Method 1: Stateless BFF Proxy | Method 2: Stateful Application Gateway |
|---|---|---|
| **Best For** | Direct web apps, dashboards, micro-frontends | Multi-turn chat, mobile apps, enterprise auth |
| **Token Storage** | Client session / memory passed in headers | Server-side `HttpOnly` secure cookie sessions |
| **Polling Complexity** | Handled by frontend client | Automated in gateway (BFF exposes clean endpoint) |
| **Streaming & Traces** | Manual trace endpoint queries | Unified response with tool/retrieval call extractions |
| **Reference Code** | [`templates/typescript/`](./templates/typescript/) & [`templates/javascript/`](./templates/javascript/) | [`templates/python/ram_router.py`](./templates/python/ram_router.py) |

---

## ⚠️ 3 Golden Rules

1. **Intermediary Proxy Required**: Direct browser-to-RAM calls are blocked by CORS and SAS Viya security headers. All client calls must pass through a BFF proxy or gateway.
2. **Trap 302 Redirects**: SASLogon returns a `302 Found` redirecting to an HTML login page when tokens expire. Always configure HTTP clients with `redirect: "manual"` so 302s are trapped and converted to HTTP 401 instead of parsing HTML as JSON.
3. **504 Timeout Immunity**: Always dispatch queries using `synchronous=false` and poll `GET /query` until the job transitions to `completed`. Synchronous queries exceed 30–60 second gateway timeouts on complex multi-step agents.

---

## 📦 What's Inside

- **[`SKILL.md`](./SKILL.md)** — Master AI Agent Skill specification covering Method 1 & 2 architectures, PKCE device auth, session mutexes, and error-handling recipes.
- **[`API_Docs/`](./API_Docs/)** — Complete API documentation suite:
  - [`SAS_RAM_API_Documentation_Scraped.md`](./API_Docs/SAS_RAM_API_Documentation_Scraped.md): Full markdown reference for all 24 endpoints with Python, JS, and cURL samples.
  - [`SASRetrievalAgentManager_openapi.yml`](./API_Docs/SASRetrievalAgentManager_openapi.yml): OpenAPI 3.0 specification.
  - [`sas_ram_api_endpoints_complete.json`](./API_Docs/sas_ram_api_endpoints_complete.json): Structured JSON endpoint catalog.
- **[`templates/`](./templates/)** — Production-ready gateway & proxy code:
  - `python/ram_router.py`: Production FastAPI gateway with HttpOnly cookie sessions, token mutex, and async polling.
  - `typescript/` & `javascript/`: Stateless BFF proxies and client libraries.
- **[`references/`](./references/)** — Background guides on OAuth 2.0 PKCE, session management, and API concepts.
- **[`examples/curl-walkthrough.md`](./examples/curl-walkthrough.md)** — CLI cURL testing playbook.
- **[`SAS_RAM_Documentation_For_Developers.pdf`](./SAS_RAM_Documentation_For_Developers.pdf)** — Official SAS developer documentation.
