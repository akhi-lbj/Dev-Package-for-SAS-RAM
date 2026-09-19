# SAS RAM End-to-End cURL Walkthrough

You can test and verify your SAS Retrieval Agent Manager instance from any terminal using these `curl` commands.

Set your environment variables first:
```bash
export RAM_URL="https://<your-sas-ram-host>"
```

---

## 1. Initiate Device Code Authentication
Request a device code and verification URL from the SAS RAM Auth service:

```bash
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/auth/device" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=sas-ram-api" \
  --data-urlencode "scope=openid" \
  --data-urlencode "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" \
  --data-urlencode "code_challenge_method=S256"
```

**Expected Response**:
```json
{
  "device_code": "S4xr2S0nWakUEZoO...",
  "user_code": "STDC-OFPE",
  "verification_uri": "https://.../SASRetrievalAgentManager/auth/realms/sas-iot/device",
  "verification_uri_complete": "https://.../device?user_code=STDC-OFPE",
  "expires_in": 600,
  "interval": 5
}
```
*Action: Open `verification_uri` in your browser, enter `user_code`, and click "Yes, grant privileges".*

---

## 2. Poll for Access Token
Once approved in the browser, exchange the `device_code` for the JWT access token:

```bash
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  --data-urlencode "client_id=sas-ram-api" \
  --data-urlencode "device_code=PASTE_DEVICE_CODE_HERE" \
  --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**Save the returned `access_token`**:
```bash
export ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIs..."
```

---

## 3. List Document Collections
```bash
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/collections?limit=10&start=0" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json"
```

---

## 4. List Retrieval Agents
```bash
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/agents?limit=10&start=0" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json"
```

---

## 5. Submit a Synchronous Query to an Agent
Submit a question to an agent and receive an immediate AI response:

```bash
curl -k -X POST "${RAM_URL}/SASRetrievalAgentManager/api/v1/query?synchronous=true&persist=true" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hi, summarize the key findings from our health data documents.",
    "agentId": "PASTE_AGENT_ID_HERE"
  }'
```

---

## 6. List Chat Sessions and History
List past sessions:
```bash
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/querySessions?sortBy=insertTimestamp:descending" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

Get messages inside a specific session:
```bash
curl -k -X GET "${RAM_URL}/SASRetrievalAgentManager/api/v1/query?filter=eq(querySessionId,PASTE_SESSION_ID_HERE)" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```
