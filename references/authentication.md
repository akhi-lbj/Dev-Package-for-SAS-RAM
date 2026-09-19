# Authentication with SAS Retrieval Agent Manager

SAS Retrieval Agent Manager provides OAuth 2.0 OpenID Connect authentication endpoints under:
```
{RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect
```

---

## The Standard Approach: OAuth 2.0 Device Code Flow (RFC 8628) with PKCE

### Why Device Code Flow is the Standard for Custom Applications:
1. **Zero Administrator Setup Required**: The `sas-ram-api` client is pre-configured and enabled on every SAS RAM installation.
2. **Works Across Any Host/Port**: Does not depend on strict browser redirect whitelist configurations, so it runs seamlessly on `localhost`, staging, or production environments.
3. **Maximum Security (PKCE)**: The custom application never sees or handles the user's password. Users log in directly on SAS's secure domain, and the client application exchanges the authorization grant using a one-time cryptographic Proof Key for Code Exchange (PKCE).

---

### Implementation Steps

#### Step 1: Generate PKCE Parameters
Generate a cryptographically random `code_verifier` (32 bytes base64url) and its SHA-256 hash `code_challenge`:
```ts
import { randomBytes, createHash } from "node:crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
```

#### Step 2: Request Device Authorization
* **Endpoint**: `POST {RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/auth/device`
* **Content-Type**: `application/x-www-form-urlencoded`
* **Body**:
  ```
  client_id=sas-ram-api
  code_challenge={code_challenge}
  code_challenge_method=S256
  scope=openid
  ```
* **Response**:
  ```json
  {
    "device_code": "S4xr2S0nWakUEZoOQ...",
    "user_code": "STDC-OFPE",
    "verification_uri": "https://<host>/SASRetrievalAgentManager/auth/realms/sas-iot/device",
    "verification_uri_complete": "https://<host>/SASRetrievalAgentManager/auth/realms/sas-iot/device?user_code=STDC-OFPE",
    "expires_in": 600,
    "interval": 5
  }
  ```

#### Step 3: Prompt the User
Display the `user_code` and `verification_uri` in your application interface.
When the user opens the verification link, SAS prompts them to approve the request (or recognizes their active SAS session) and grants access.

#### Step 4: Poll for the Access Token
While the user authorizes in the browser, poll the token endpoint at the recommended `interval` (every 5 seconds):
* **Endpoint**: `POST {RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`
* **Content-Type**: `application/x-www-form-urlencoded`
* **Body**:
  ```
  grant_type=urn:ietf:params:oauth:grant-type:device_code
  client_id=sas-ram-api
  device_code={device_code}
  code_verifier={code_verifier}
  ```
* **Pending Status (`400 Bad Request`)**:
  `{"error": "authorization_pending"}` &rarr; Continue polling.
* **Success Status (`200 OK`)**:
  ```json
  {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 300,
    "refresh_expires_in": 1800,
    "token_type": "Bearer"
  }
  ```

#### Step 5: Refreshing Expired Tokens
When the `access_token` expires:
* **Endpoint**: `POST {RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`
* **Body**:
  ```
  grant_type=refresh_token
  client_id=sas-ram-api
  refresh_token={refresh_token}
  ```
