# SAS Retrieval Agent Manager (RAM) v1 REST API Overview

## Base URL Convention
All SAS Retrieval Agent Manager REST API endpoints are hosted under:
```
{RAM_URL}/SASRetrievalAgentManager/api/v1
```
*(Example: `https://<your-sas-ram-host>/SASRetrievalAgentManager/api/v1`)*

> [!IMPORTANT]
> Always pass the OAuth 2.0 Bearer token in the `Authorization` header:
> `Authorization: Bearer <access_token>`
> `Content-Type: application/json`

---

## 1. Document Collections (`/collections`)
Collections represent curated sets of private documents, embeddings, and vector stores managed in SAS RAM.

### Endpoints
* **List Collections**: `GET /collections?limit={limit}&start={start}`
* **Get Collection Details**: `GET /collections/{collectionId}`

### Query Parameters
* `limit` (integer, default: 50, min: 1, max: 100): Maximum records to return.
* `start` (integer, default: 0, min: 0): Zero-based offset for pagination.
* `filter` (string, optional): Filtering expression (e.g. `eq(name,"HR-Policies")`).
* `sortBy` (string, optional): Sort criteria (e.g. `name:ascending`, `insertTimestamp:descending`).

### Response Schema (`application/json`)
```json
{
  "count": 5,
  "limit": 50,
  "name": "collections",
  "start": 0,
  "items": [
    {
      "id": "60918895-0702-4c77-83c6-96fc52cd80a0",
      "name": "Employee Health Benefits",
      "description": "2026 Insurance and Wellness Plans",
      "documentCount": 42,
      "insertTimestamp": "2026-01-15T10:30:00Z",
      "updateTimestamp": "2026-03-01T14:22:00Z"
    }
  ]
}
```

---

## 2. Agents (`/agents`)
Agents represent specialized retrieval or reasoning agents configured in SAS RAM.

### Endpoints
* **List Agents**: `GET /agents?limit={limit}&start={start}`
* **Get Agent Details**: `GET /agents/{agentId}`

### Response Schema (`application/json`)
```json
{
  "count": 2,
  "limit": 50,
  "name": "agents",
  "start": 0,
  "items": [
    {
      "id": "60918895-0702-4c77-83c6-96fc52cd80a0",
      "name": "Default Retrieval Agent",
      "description": "General RAG agent for document synthesis",
      "status": "ready"
    }
  ]
}
```

---

## 3. Query Sessions (`/querySessions`)
Sessions group multiple back-and-forth query/response turns into a conversation thread.

### Endpoints
* **List Sessions**: `GET /querySessions?sortBy=insertTimestamp:descending&limit={limit}&start={start}`
* **Get Single Session**: `GET /querySessions/{sessionId}`
* **Delete Session**: `DELETE /querySessions/{sessionId}`

### Response Schema
```json
{
  "count": 12,
  "limit": 50,
  "name": "querySessions",
  "start": 0,
  "items": [
    {
      "id": "9bac5f0f-456a-44e1-b854-e43c2df0f01e",
      "title": "Diabetes Data occurrence in men",
      "insertTimestamp": "2026-09-19T11:00:00Z",
      "updateTimestamp": "2026-09-19T11:05:00Z"
    }
  ]
}
```

---

## 4. Query Execution (`/query`)
Submits a prompt to an agent or collection and retrieves the AI-generated answer.

### Endpoint
`POST /query?synchronous=true&persist=true`

### Query Flags
* `synchronous=true`: Waits for the model completion and returns the final answer directly in the HTTP response. If `false`, returns an execution ID to poll asynchronously.
* `persist=true`: Saves the question and AI answer to the session's persistent history in SAS RAM.

### Request Body Schema
```json
{
  "content": "What is the deductible for the family dental plan?",
  "agentId": "60918895-0702-4c77-83c6-96fc52cd80a0",
  "querySessionId": "9bac5f0f-456a-44e1-b854-e43c2df0f01e"
}
```
*(Note: If `querySessionId` is omitted, SAS RAM will automatically generate a new session ID).*

### Response Schema (`201 Created` or `200 OK`)
```json
{
  "id": "query-uuid-1234",
  "querySessionId": "9bac5f0f-456a-44e1-b854-e43c2df0f01e",
  "content": "According to the 2026 Benefits Guide, the annual family deductible is $1,500.",
  "status": "completed",
  "sources": [
    {
      "documentName": "Benefits_2026.pdf",
      "page": 14,
      "snippet": "...annual deductible for family coverage is fixed at $1,500..."
    }
  ],
  "insertTimestamp": "2026-09-19T11:00:05Z"
}
```

---

## 5. Fetching Conversation History
To fetch all past turns for a specific session:
```
GET /query?filter=eq(querySessionId,{sessionId})
```
Returns all previous question/response pairs associated with that session in chronological order.
