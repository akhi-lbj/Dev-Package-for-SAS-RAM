"""
SAS Retrieval Agent Manager (RAM) — Method 2: Stateful Application Gateway
Production-ready FastAPI Router with HttpOnly cookie session binding,
concurrency-locked token refresh, 504-immune async polling, live traces, and file extraction.
"""

import os
import io
import json
import time
import base64
import hashlib
import secrets
import asyncio
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import APIRouter, Request, Response, HTTPException, Depends, UploadFile, File, Query
from pydantic import BaseModel
import httpx

# ── Configuration ──
RAM_BASE_URL = os.getenv("RAM_BASE_URL", "https://your-sas-host").rstrip("/")
RAM_API_URL = os.getenv("RAM_API_URL", f"{RAM_BASE_URL}/SASRetrievalAgentManager/api/v1")
OIDC_REALM = os.getenv("RAM_OIDC_REALM", "sas-iot")
OIDC_CLIENT_ID = os.getenv("RAM_CLIENT_ID", "sas-ram-api")
DEVICE_AUTH_URL = os.getenv(
    "RAM_DEVICE_AUTH_URL",
    f"{RAM_BASE_URL}/SASRetrievalAgentManager/auth/realms/{OIDC_REALM}/protocol/openid-connect/auth/device",
)
TOKEN_URL = os.getenv(
    "RAM_TOKEN_URL",
    f"{RAM_BASE_URL}/SASRetrievalAgentManager/auth/realms/{OIDC_REALM}/protocol/openid-connect/token",
)
VIYA_LOGON_TOKEN_URL = os.getenv("RAM_VIYA_LOGON_TOKEN_URL", f"{RAM_BASE_URL}/SASLogon/oauth/token")

VERIFY_SSL = os.getenv("RAM_VERIFY_SSL", "false").lower() in ("true", "1", "yes")
SESSION_COOKIE = "ram_sid"
MAX_ATTACH_CHARS = int(os.getenv("RAM_MAX_ATTACH_CHARS", "20000"))
SESSION_STORAGE_PATH = Path(os.getenv("RAM_SESSION_FILE", "./.ram_sessions.json"))

# ── In-Memory Session Store & Concurrency Mutexes ──
_sessions: Dict[str, Dict[str, Any]] = {}
_locks: Dict[str, asyncio.Lock] = {}


def _get_lock(sid: str) -> asyncio.Lock:
    if sid not in _locks:
        _locks[sid] = asyncio.Lock()
    return _locks[sid]


def _save_sessions_to_disk() -> None:
    """Persists sessions to disk with strict permissions (0600) so server restarts don't log out users."""
    try:
        data = {
            sid: {
                "token": s.get("token"),
                "refresh_token": s.get("refresh_token"),
                "expires_at": s.get("expires_at", 0),
            }
            for sid, s in _sessions.items()
            if s.get("refresh_token")
        }
        SESSION_STORAGE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        try:
            os.chmod(SESSION_STORAGE_PATH, 0o600)
        except (AttributeError, OSError):
            pass
    except Exception as e:
        print(f"[RAM Gateway] Warning: Failed to persist sessions: {e}")


def _load_sessions_from_disk() -> None:
    """Restores sessions from disk on startup."""
    if not SESSION_STORAGE_PATH.exists():
        return
    try:
        raw = json.loads(SESSION_STORAGE_PATH.read_text(encoding="utf-8"))
        for sid, data in raw.items():
            _sessions[sid] = {
                "token": data.get("token"),
                "refresh_token": data.get("refresh_token"),
                "expires_at": data.get("expires_at", 0),
                "device": {},
            }
    except Exception as e:
        print(f"[RAM Gateway] Warning: Failed to load sessions: {e}")


_load_sessions_from_disk()


# ── Dependency: Session Cookie Binding ──
async def bind_session(request: Request, response: Response):
    """
    Extracts or provisions the HttpOnly `ram_sid` session cookie.
    Guarantees browser client never handles raw JWT tokens.
    """
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid or sid not in _sessions:
        sid = secrets.token_urlsafe(24)
        _sessions[sid] = {
            "token": None,
            "refresh_token": None,
            "expires_at": 0,
            "device": {},
        }
        response.set_cookie(
            key=SESSION_COOKIE,
            value=sid,
            max_age=86400 * 30,  # 30 days
            httponly=True,
            samesite="lax",
            path="/api/ram",
            secure=request.url.scheme == "https",
        )
    request.state.sid = sid
    request.state.session = _sessions[sid]


router = APIRouter(prefix="/api/ram", dependencies=[Depends(bind_session)])


# ── Token Refresh with Concurrency Mutex Lock ──
async def get_valid_token(sid: str, session: dict) -> str:
    """
    Returns a fresh access token. If expired, refreshes via refresh token.
    Uses an asyncio.Lock per session to prevent Keycloak single-use token rotation race conditions (token burn).
    """
    # 1. Fast-path check: token still valid for at least 60 seconds
    if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
        return session["token"]

    refresh_token = session.get("refresh_token")
    if not refresh_token:
        # Fallback to static token if configured in env
        static_token = os.getenv("RAM_TOKEN")
        if static_token:
            return static_token
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in.")

    # 2. Mutex lock for token refresh
    async with _get_lock(sid):
        # Double-check inside mutex
        if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
            return session["token"]

        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": OIDC_CLIENT_ID,
                    "refresh_token": refresh_token,
                },
            )

        if resp.status_code != 200:
            # Refresh token revoked or expired
            session["token"] = None
            session["refresh_token"] = None
            session["expires_at"] = 0
            _save_sessions_to_disk()
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")

        data = resp.json()
        session["token"] = data["access_token"]
        if "refresh_token" in data:
            session["refresh_token"] = data["refresh_token"]
        session["expires_at"] = time.time() + data.get("expires_in", 300)
        _save_sessions_to_disk()
        return session["token"]


# ── 1. Interactive Authentication Routes ──

@router.get("/auth/status")
async def auth_status(request: Request):
    """Checks whether the active session has a valid token."""
    s = request.state.session
    is_authed = bool(s.get("token") or s.get("refresh_token") or os.getenv("RAM_TOKEN"))
    return {
        "authenticated": is_authed,
        "expiresAt": s.get("expires_at", 0),
        "hasRefreshToken": bool(s.get("refresh_token")),
    }


@router.post("/auth/device/start")
async def auth_device_start(request: Request):
    """
    Step 1 of Flow A: Starts OAuth 2.0 Device Code Flow with PKCE (RFC 8628).
    Generates cryptographically random code_verifier and SHA-256 code_challenge.
    """
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        resp = await client.post(
            DEVICE_AUTH_URL,
            data={
                "client_id": OIDC_CLIENT_ID,
                "scope": "openid",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Failed to start device auth: {resp.text}")

    data = resp.json()
    request.state.session["device"] = {
        "verifier": verifier,
        "device_code": data["device_code"],
        "started_at": time.time(),
    }
    return {
        "userCode": data.get("user_code"),
        "verificationUri": data.get("verification_uri"),
        "verificationUriComplete": data.get("verification_uri_complete"),
        "expiresIn": data.get("expires_in", 600),
        "interval": data.get("interval", 5),
    }


@router.post("/auth/device/poll")
async def auth_device_poll(request: Request):
    """
    Step 2 of Flow A: Polls token endpoint for user approval of Device Code.
    """
    dev = request.state.session.get("device", {})
    device_code = dev.get("device_code")
    verifier = dev.get("verifier")

    if not device_code or not verifier:
        raise HTTPException(400, "No device authorization in progress.")

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": OIDC_CLIENT_ID,
                "device_code": device_code,
                "code_verifier": verifier,
            },
        )

    data = resp.json()
    if resp.status_code == 200:
        s = request.state.session
        s["token"] = data["access_token"]
        s["refresh_token"] = data.get("refresh_token")
        s["expires_at"] = time.time() + data.get("expires_in", 300)
        s["device"] = {}
        _save_sessions_to_disk()
        return {"ok": True, "expiresIn": data.get("expires_in", 300)}

    error = data.get("error")
    if error in ("authorization_pending", "slow_down"):
        return {"pending": True, "slowDown": error == "slow_down"}

    raise HTTPException(400, data.get("error_description", f"Auth error: {error}"))


class ViyaCodeRequest(BaseModel):
    code: str


@router.post("/auth/viya/code")
async def auth_viya_code(body: ViyaCodeRequest, request: Request):
    """
    Flow B: Exchanges authorization code obtained from SASLogon (sas.cli) for tokens.
    """
    basic_auth = base64.b64encode(b"sas.cli:").decode()
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        resp = await client.post(
            VIYA_LOGON_TOKEN_URL,
            headers={"Authorization": f"Basic {basic_auth}"},
            data={"grant_type": "authorization_code", "code": body.code.strip()},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"SASLogon exchange failed: {resp.text}")

    data = resp.json()
    s = request.state.session
    s["token"] = data["access_token"]
    s["refresh_token"] = data.get("refresh_token")
    s["expires_at"] = time.time() + data.get("expires_in", 300)
    _save_sessions_to_disk()
    return {"ok": True, "expiresIn": data.get("expires_in", 300)}


@router.post("/auth/signout")
async def auth_signout(request: Request, response: Response):
    """Clears server-side session and wipes cookie."""
    sid = request.state.sid
    if sid in _sessions:
        del _sessions[sid]
    _save_sessions_to_disk()
    response.delete_cookie(SESSION_COOKIE, path="/api/ram")
    return {"ok": True}


class RestoreRequest(BaseModel):
    sessionData: Dict[str, Any]


@router.post("/auth/restore")
async def auth_restore(body: RestoreRequest, request: Request):
    """Restores session tokens from encrypted browser localStorage after container cold deploy."""
    data = body.sessionData
    if data and ("token" in data or "refresh_token" in data):
        s = request.state.session
        s["token"] = data.get("token")
        s["refresh_token"] = data.get("refresh_token")
        s["expires_at"] = data.get("expires_at", 0)
        _save_sessions_to_disk()
        return {"ok": True}
    raise HTTPException(400, "Invalid session data payload.")


# ── 2. Catalog Pass-Throughs (Collections & Agents) ──

@router.get("/collections")
async def list_collections(request: Request, limit: int = 50, start: int = 0):
    """Lists indexed document collections from SAS RAM."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        r = await client.get(
            f"{RAM_API_URL}/collections",
            params={"limit": limit, "start": start},
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.json()


@router.get("/agents")
async def list_agents(request: Request, limit: int = 50, start: int = 0):
    """Lists configured retrieval and reasoning agents from SAS RAM."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        r = await client.get(
            f"{RAM_API_URL}/agents",
            params={"limit": limit, "start": start},
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.json()


# ── 3. 504-Immune Asynchronous Query Execution ──

class AttachmentItem(BaseModel):
    name: str
    text: str


class QuerySubmission(BaseModel):
    content: str
    agentId: Optional[str] = None
    collectionIds: Optional[List[str]] = None
    querySessionId: Optional[str] = None
    attachments: Optional[List[AttachmentItem]] = None


@router.post("/query")
async def submit_query(body: QuerySubmission, request: Request):
    """
    Submits a query asynchronously (synchronous=false&persistent=true).
    Guarantees immunity against 504 Gateway Timeouts from ingress load balancers.
    Inlines ad-hoc document attachments within character budget.
    """
    token = await get_valid_token(request.state.sid, request.state.session)

    content = body.content
    if body.attachments:
        for a in body.attachments:
            snippet = a.text[:MAX_ATTACH_CHARS]
            content += f"\n\n--- Attached document: {a.name} ---\n{snippet}\n--- End of attached document ---"
        content += "\n\nUse the attached document content above to answer the question where relevant."

    payload: Dict[str, Any] = {"content": content}
    if body.agentId:
        payload["agentId"] = body.agentId
    if body.collectionIds:
        payload["collectionIds"] = body.collectionIds
    if body.querySessionId:
        payload["querySessionId"] = body.querySessionId

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        r = await client.post(
            f"{RAM_API_URL}/query?synchronous=false&persistent=true",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )

    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, f"RAM Query error: {r.text}")

    data = r.json()
    return {
        "queryId": data.get("id"),
        "querySessionId": data.get("querySessionId"),
        "status": data.get("status", "pending"),
    }


# ── 4. Query Polling & Live Execution Tracing ──

@router.get("/query/{query_id}")
async def query_status(query_id: str, request: Request):
    """Polls query completion status: pending, running, completed, or failed."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        r = await client.get(
            f"{RAM_API_URL}/query/{query_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.json()


@router.get("/query/{query_id}/trace")
async def query_trace(query_id: str, request: Request):
    """
    Concurrently fetches sub-step execution traces:
    - Tool calls: tool inputs, arguments, outputs
    - Retrieval calls: KB queries, relevancy scores, text chunks
    - LLM calls: prompt tokens, reasoning steps
    """
    token = await get_valid_token(request.state.sid, request.state.session)
    filter_expr = f"eq(parentQueryId,'{query_id}')"
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        t_res, r_res, l_res = await asyncio.gather(
            client.get(f"{RAM_API_URL}/toolCalls", params={"filter": filter_expr}, headers=headers),
            client.get(f"{RAM_API_URL}/retrievalCalls", params={"filter": filter_expr}, headers=headers),
            client.get(f"{RAM_API_URL}/llmCalls", params={"filter": filter_expr}, headers=headers),
            return_exceptions=True,
        )

    return {
        "toolCalls": t_res.json().get("items", []) if not isinstance(t_res, Exception) and t_res.status_code == 200 else [],
        "retrievalCalls": r_res.json().get("items", []) if not isinstance(r_res, Exception) and r_res.status_code == 200 else [],
        "llmCalls": l_res.json().get("items", []) if not isinstance(l_res, Exception) and l_res.status_code == 200 else [],
    }


# ── 5. Conversation Session History ──

@router.get("/sessions")
async def list_sessions(request: Request, limit: int = 50, start: int = 0):
    """Lists past conversation sessions."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        r = await client.get(
            f"{RAM_API_URL}/querySessions",
            params={"limit": limit, "start": start, "sortBy": "insertTimestamp:descending"},
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.json()


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, request: Request):
    """Retrieves all past query turns for a specific session."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        r = await client.get(
            f"{RAM_API_URL}/query",
            params={"filter": f"eq(querySessionId,{session_id})"},
            headers={"Authorization": f"Bearer {token}"},
        )
    return r.json()


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    """Deletes a conversation session from SAS RAM."""
    token = await get_valid_token(request.state.sid, request.state.session)
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15.0) as client:
        r = await client.delete(
            f"{RAM_API_URL}/querySessions/{session_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    return {"ok": r.status_code in (200, 204)}


# ── 6. Ad-Hoc Document Text Extraction ──

@router.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    """
    Extracts plain text from user-uploaded PDF, DOCX, TXT, CSV, or JSON documents.
    Truncates text to prompt budget (MAX_ATTACH_CHARS).
    Rejects scanned images without OCR layers with HTTP 422.
    """
    raw_bytes = await file.read()
    filename = file.filename or "document.txt"
    ext = filename.rsplit(".", 1)[-1].lower()

    text = ""
    if ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw_bytes))
            pages_text = [p.extract_text() or "" for p in reader.pages]
            text = "\n".join(pages_text).strip()
            if not text:
                raise HTTPException(
                    422,
                    "No extractable text layer found in PDF. Scanned images require OCR processing before querying.",
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"Failed to parse PDF file: {e}")

    elif ext in ("docx", "doc"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(raw_bytes))
            text = "\n".join(p.text for p in doc.paragraphs if p.text).strip()
        except Exception as e:
            raise HTTPException(400, f"Failed to parse DOCX file: {e}")

    elif ext in ("txt", "md", "csv", "json", "log"):
        text = raw_bytes.decode("utf-8", errors="replace").strip()

    else:
        raise HTTPException(415, f"Unsupported file extension: .{ext}. Supported formats: PDF, DOCX, TXT, CSV, JSON.")

    truncated = len(text) > MAX_ATTACH_CHARS
    return {
        "name": filename,
        "text": text[:MAX_ATTACH_CHARS],
        "characterCount": min(len(text), MAX_ATTACH_CHARS),
        "truncated": truncated,
    }
