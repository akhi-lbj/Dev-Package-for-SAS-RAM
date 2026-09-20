# Authentication with SAS Retrieval Agent Manager

SAS Retrieval Agent Manager provides OAuth 2.0 and OpenID Connect authentication endpoints. Depending on your environment architecture, three authentication flows are supported:

```
Detection Probe: GET {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/.well-known/openid-configuration
If HTTP 200 -> Flow A (Device Code Flow with PKCE)
If HTTP 404/Redirect -> Flow B (SAS Viya SASLogon Auth Code)
```

---

## Flow A: OAuth 2.0 Device Code Flow (RFC 8628) with PKCE
The standard, zero-friction authentication flow for standalone SAS RAM or Keycloak OIDC realms (`sas-iot`).

### Key Properties:
1. **Zero Administrator Setup**: Uses the built-in public client `sas-ram-api`. No redirect URI whitelisting or client secrets needed.
2. **Domain Independent**: Works identically on `localhost`, staging, cloud containers, or production domains.
3. **Maximum Security (PKCE)**: Client generates a one-time cryptographic Proof Key for Code Exchange (`code_verifier` and `code_challenge`).

### Step-by-Step Implementation

#### 1. Generate PKCE Parameters
```ts
import { randomBytes, createHash } from "node:crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
```

#### 2. Request Device Authorization
* **Endpoint**: `POST {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/protocol/openid-connect/auth/device`
* **Content-Type**: `application/x-www-form-urlencoded`
* **Body**:
  ```
  client_id=sas-ram-api
  scope=openid
  code_challenge={code_challenge}
  code_challenge_method=S256
  ```
* **Response**:
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

#### 3. User Approves Code
The user visits `verification_uri` in a browser, enters `user_code`, and approves access.

#### 4. Poll for Token
Poll every `interval` seconds (default 5s):
* **Endpoint**: `POST {RAM_BASE}/SASRetrievalAgentManager/auth/realms/{realm}/protocol/openid-connect/token`
* **Content-Type**: `application/x-www-form-urlencoded`
* **Body**:
  ```
  grant_type=urn:ietf:params:oauth:grant-type:device_code
  client_id=sas-ram-api
  device_code={device_code}
  code_verifier={code_verifier}
  ```
* **Responses**:
  * `HTTP 400` with `{"error": "authorization_pending"}` &rarr; Continue polling.
  * `HTTP 400` with `{"error": "slow_down"}` &rarr; Increase interval by 5 seconds.
  * `HTTP 200 OK` &rarr; Success! Returns `access_token` and `refresh_token`.

---

## Flow B: SAS Viya SASLogon Authorization Code Flow
Used in enterprise SAS Viya environments with centralized SASLogon.

1. **User Opens Login URL**:
   User opens `{VIYA_HOST}/SASLogon/oauth/authorize?client_id=sas.cli&response_type=code` in browser and logs in.
2. **Obtains Authorization Code**:
   SASLogon displays a one-time authorization code.
3. **Exchanges Code for Tokens**:
   * **Endpoint**: `POST {VIYA_HOST}/SASLogon/oauth/token`
   * **Headers**: `Authorization: Basic c2FzLmNsaTo=` (Base64 of `sas.cli:`), `Content-Type: application/x-www-form-urlencoded`
   * **Body**: `grant_type=authorization_code&code={pasted_code}`
   * **Response**: Returns `access_token` and `refresh_token`.

---

## Flow C: Service Accounts & Automated Pipelines
* **Static Bearer Token**: Set `RAM_TOKEN=<token>` in environment variables for headless CI/CD runs.
* **Client Credentials Grant**:
  * `POST {VIYA_HOST}/SASLogon/oauth/token`
  * Body: `grant_type=client_credentials&client_id={id}&client_secret={secret}`

---

## Critical Requirement: Concurrency-Locked Token Refresh

Many OIDC identity providers (including Keycloak and SASLogon) enforce **single-use refresh token rotation**. When a refresh token is used, it is invalidated and replaced with a new one.

> [!CAUTION]
> If two incoming client requests trigger a token refresh simultaneously, the second request will use an already-revoked refresh token. The auth server flags this as a replay attack (`invalid_grant`) and immediately revokes the entire user session.

### Resolution: Per-Session Mutex Lock
Always serialize token refresh operations using an asynchronous or sync mutex lock:

```python
_locks: dict[str, asyncio.Lock] = {}

def get_lock(sid: str) -> asyncio.Lock:
    if sid not in _locks:
        _locks[sid] = asyncio.Lock()
    return _locks[sid]

async def get_valid_token(sid: str, session: dict) -> str:
    # 1. Fast path: token still valid for > 60s
    if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
        return session["token"]

    # 2. Serialize refresh under mutex
    async with get_lock(sid):
        # Double check after lock acquisition
        if session.get("token") and session.get("expires_at", 0) > time.time() + 60:
            return session["token"]

        new_tokens = await execute_refresh(session["refresh_token"])
        session["token"] = new_tokens["access_token"]
        session["refresh_token"] = new_tokens.get("refresh_token")
        session["expires_at"] = time.time() + new_tokens.get("expires_in", 300)
        return session["token"]
```
