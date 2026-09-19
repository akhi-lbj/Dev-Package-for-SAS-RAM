# SAS Retrieval Agent Manager (RAM) — Developer & Agent Package

> **A ready-to-use Agent Skill (`sas-ram-integration`), pre-built code templates (TypeScript/JavaScript), and architecture guides for integrating frontend and full-stack web applications with SAS Retrieval Agent Manager (RAM).**

---

## ⚡ What is this?

This repository provides everything participants need to build custom web applications, chat interfaces, and tools powered by **SAS Retrieval Agent Manager (RAM)**:

1. **AI Agent Skill (`SKILL.md`)**: Plug this directly into your AI assistant (Google Antigravity, Cursor, Claude Code, Gemini, Copilot) so it immediately understands SAS RAM APIs, OAuth 2.0 Device Code flows, BFF proxy patterns, and error handling.
2. **Ready-to-Use Code Templates (`templates/`)**: Copy-paste production code in TypeScript and JavaScript for authentication, BFF API proxying, and streaming queries.
3. **Architecture & Reference Guides (`references/` & `examples/`)**: OpenAPI specifications, cURL testing walkthroughs, and troubleshooting playbooks.

---

## 🚀 How to Use the Skill with Your AI Assistant

You can equip your AI coding assistant with this skill in **under 30 seconds** using either of the two methods below:

### Option 1: One-Line Git Clone (Recommended)

Run this command inside the root of your project workspace:

**Bash / macOS / Linux / Git Bash:**
```bash
git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git .agents/skills/sas-ram-integration
```

**Windows PowerShell:**
```powershell
git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git .agents/skills/sas-ram-integration
```

> **Using Global Antigravity / Gemini Agent Config?**  
> Clone it into your global skills directory instead:  
> - **Linux/macOS**: `git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git ~/.gemini/config/skills/sas-ram-integration`  
> - **Windows**: `git clone https://github.com/akhi-lbj/Dev-Package-for-SAS-RAM.git "$HOME\.gemini\config\skills\sas-ram-integration"`

---

### Option 2: Direct Download / Copy `SKILL.md` (No Git Needed)

If you just want the skill without cloning the whole repository:

1. Click on [**SKILL.md**](./SKILL.md) in this repo on GitHub.
2. Click **Download raw file** (or copy its entire text).
3. In your project, create the folder `.agents/skills/sas-ram-integration/` and save the file as:
   ```
   .agents/skills/sas-ram-integration/SKILL.md
   ```

---

### 📚 In-Depth Developer Documentation

Participants can also refer to [**SAS_RAM_Documentation_For_Developers.pdf**](./SAS_RAM_Documentation_For_Developers.pdf) located directly in the root of this repository for more detailed architectural overviews, technical background, and complete SAS RAM specifications.

---

## 🤖 How to Prompt Your AI Assistant

Once installed in your project, your AI assistant will automatically activate the `sas-ram-integration` skill. You can prompt it with tasks like:

- *"Set up SAS RAM authentication using the Device Code Flow."*
- *"Create a Next.js App Router BFF proxy handler for SAS RAM API calls."*
- *"Write a chat UI that connects to SAS RAM collection `<collection-id>`."*
- *"Show me how to authenticate and run queries against SAS RAM using cURL."*
- *"Help me fix a 302 redirect error when calling SAS RAM endpoints."*

---

## 📂 Repository Contents

```
├── SKILL.md                          # Master AI agent instructions & API contracts
├── SAS_RAM_Documentation_For_Developers.pdf # Detailed developer guide & documentation
├── templates/
│   ├── .env.example                  # Environment variables template (RAM_URL)
│   ├── typescript/
│   │   ├── auth-device-flow.ts       # OAuth 2.0 Device Flow with PKCE implementation
│   │   ├── api-proxy-route.ts        # Next.js / Express BFF proxy handler
│   │   ├── chat-service.ts           # Query execution and session management
│   │   └── types.d.ts                # TypeScript type definitions for SAS RAM
│   └── javascript/
│       ├── auth-device-flow.js       # JavaScript equivalent for Device Flow
│       ├── api-proxy-route.js        # JavaScript equivalent for BFF proxy
│       └── chat-service.js           # JavaScript equivalent for chat queries
├── references/
│   ├── api-overview.md               # Summary of REST endpoints & schemas
│   ├── authentication.md             # In-depth guide to RFC 8628 Device Flow
│   ├── bff-proxy-pattern.md          # Architectural rationale for the BFF proxy
│   └── openapi-v1.yml                # Full OpenAPI v1 specification for SAS RAM
└── examples/
    └── curl-walkthrough.md           # Step-by-step cURL verification playbook
```

---

## ⚠️ 3 Golden Rules for SAS RAM Development

When building apps that integrate with SAS RAM, keep these essentials in mind:

1. **Always Use a BFF Proxy (Never call SAS RAM directly from the browser)**:  
   SAS RAM does not enable browser CORS by default. All requests from your frontend must route through a backend proxy (such as Next.js API Route Handlers, Express, or FastAPI).
2. **Beware of the "302 Redirect Trap"**:  
   When tokens expire or credentials fail, the SAS ingress gateway returns an **HTTP 302 redirect** to an HTML login page rather than an HTTP 401. Your BFF proxy must detect and convert this into a proper JSON error. (See [`templates/typescript/api-proxy-route.ts`](./templates/typescript/api-proxy-route.ts) for the pre-built fix).
3. **Configure Environment Variables**:  
   Copy `templates/.env.example` to `.env` in your project and specify your instance URL:
   ```bash
   RAM_URL=https://<your-sas-ram-host>
   ```

---

## 📖 Useful Links & Reference

- **[SKILL.md](./SKILL.md)** — Comprehensive architecture, API contracts, and troubleshooting guide.
- **[cURL Walkthrough](./examples/curl-walkthrough.md)** — Test endpoints immediately from the command line.
- **[Code Templates](./templates/)** — Drop-in code for your backend and frontend services.
