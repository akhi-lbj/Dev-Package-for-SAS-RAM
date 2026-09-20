# SAS Retrieval Agent Manager (RAM) — Dev Package & Skill

Plug-and-play AI Agent Skill (`sas-ram-integration`), API specifications, and drop-in code templates (TypeScript, JavaScript, Python/FastAPI) for **SAS Retrieval Agent Manager (RAM)** v1 REST APIs.

---

## ⚡ Quick Install

Clone into your project workspace to equip any coding agent (Antigravity, Cursor, Claude Code, Copilot):

```bash
git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git .agents/skills/sas-ram-integration
```

*(Or copy [`SKILL.md`](./SKILL.md) directly into `.agents/skills/sas-ram-integration/SKILL.md`).*

---

## 📦 What's Inside

- **[`SKILL.md`](./SKILL.md)** — Master specification covering Method 1 (Stateless BFF Proxy) and Method 2 (Stateful Gateway), OAuth 2.0 PKCE, SASLogon, async polling, and 302/504 error handling.
- **[`templates/`](./templates/)** — Drop-in production code:
  - `typescript/` & `javascript/`: Stateless BFF proxies, device auth flow, and query clients.
  - `python/ram_router.py`: Production FastAPI gateway with cookie sessions, token mutex, async polling, and live traces.
  - `javascript/gateway-client.js`: Frontend client for stateful gateways.
- **[`references/`](./references/)** & **[`API_Docs/`](./API_Docs/)** — Full OpenAPI 3.0 specs, scraped REST API reference, request/response samples (JavaScript/Python), and auth guides.
- **[`examples/curl-walkthrough.md`](./examples/curl-walkthrough.md)** — Direct terminal cURL testing playbook.
- **[`SAS_RAM_Documentation_For_Developers.pdf`](./SAS_RAM_Documentation_For_Developers.pdf)** — Official developer guide.

---

## ⚠️ 3 Golden Rules

1. **Intermediary Proxy Required**: Direct browser calls fail due to CORS. Use a BFF proxy or gateway.
2. **Trap 302 Redirects**: Set HTTP client `redirect: "manual"` to intercept HTML login traps as HTTP 401.
3. **504 Immunity**: Submit long agent queries with `synchronous=false` and poll `GET /query/{id}`.
