# SAS Retrieval Agent Manager (RAM) v1 REST API Overview

## Base URL Convention
All SAS Retrieval Agent Manager REST API endpoints are hosted under:
```
{RAM_API_URL} = {RAM_URL}/SASRetrievalAgentManager/api/v1
```
*(Example: `https://<your-sas-ram-host>/SASRetrievalAgentManager/api/v1`)*

> [!IMPORTANT]
> Always pass the OAuth 2.0 Bearer token in the `Authorization` header:
> `Authorization: Bearer <access_token>`
> `Content-Type: application/json`

---

## Endpoint Catalog Summary

| Category | Endpoint | Method | Purpose |
| :--- | :--- | :--- | :--- |
| **Collections** | `/collections` | `GET` | List available indexed knowledge base collections |
| **Collections** | `/collections/{id}` | `GET` | Retrieve metadata for a specific collection |
| **Agents** | `/agents` | `GET` | List available reasoning and retrieval agents |
| **Agents** | `/agents/{id}` | `GET` | Retrieve metadata for a specific agent |
| **Query** | `/query` | `POST` | Execute a synchronous or asynchronous agent query |
| **Query Status** | `/query/{id}` | `GET` | Poll completion status for an asynchronous query |
| **Sessions** | `/querySessions` | `GET` | List conversation history sessions |
| **Sessions** | `/querySessions/{id}` | `GET`, `DELETE` | Retrieve or delete a conversation session |
| **Session Turns**| `/query?filter=eq(querySessionId,{id})` | `GET` | Retrieve prior question/answer turns in a session |
| **Tool Traces** | `/toolCalls?filter=eq(parentQueryId,'{id}')` | `GET` | Tool inputs, arguments, outputs, execution duration |
| **Retrieval Traces**| `/retrievalCalls?filter=eq(parentQueryId,'{id}')` | `GET` | KB search queries, relevancy scores, chunk snippets |
| **LLM Traces** | `/llmCalls?filter=eq(parentQueryId,'{id}')` | `GET` | LLM token usage, system prompts, reasoning steps |

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

## 3. Query Execution (`/query`)

Submits a prompt to an agent or collection and retrieves the AI-generated answer.

### Query Parameters & Execution Modes
* `synchronous=true` (Synchronous Mode):
  Waits for the agent to complete before returning HTTP 200/201.
  *Warning*: Long queries may trigger HTTP 504 Gateway Timeouts on corporate reverse proxies if execution exceeds 30–60 seconds.
* `synchronous=false` (Asynchronous Mode - Recommended):
  Returns immediately with HTTP 200/201 containing query `id`. The client polls `GET /query/{id}` until status is `completed` or `failed`.
* `persistent=true` (or `persist=true`):
  Saves the question and AI answer to the session's persistent history in SAS RAM.

### Request Body Schema
```json
{
  "content": "Analyze the attached document for regulatory compliance.\n\n--- Attached document: audit.pdf ---\n[Extracted text...]\n--- End of attached document ---",
  "agentId": "60918895-0702-4c77-83c6-96fc52cd80a0",
  "collectionIds": ["optional-collection-uuid"],
  "querySessionId": "optional-existing-session-uuid"
}
```

### Initial Asynchronous Response (`synchronous=false`):
```json
{
  "id": "query-uuid-1234",
  "querySessionId": "session-uuid-5678",
  "status": "pending"
}
```

### Polling Status Endpoint (`GET /query/{id}`)
```json
{
  "id": "query-uuid-1234",
  "querySessionId": "session-uuid-5678",
  "status": "completed",
  "content": "Synthesized agent response...",
  "sources": [
    {
      "documentName": "audit.pdf",
      "page": 2,
      "snippet": "Compliance clause findings..."
    }
  ],
  "error": null
}
```

---

## 4. Live Execution Tracing (`/toolCalls`, `/retrievalCalls`, `/llmCalls`)

During or after query execution, detailed diagnostic traces can be retrieved using `filter=eq(parentQueryId,'{queryId}')`.

### 1. Tool Calls (`GET /toolCalls?filter=eq(parentQueryId,'{queryId}')`)
Returns tools invoked by the reasoning agent:
```json
{
  "items": [
    {
      "id": "tool-call-1",
      "parentQueryId": "query-uuid-1234",
      "name": "searchKnowledgeBase",
      "arguments": "{\"query\": \"family deductible dental\"}",
      "output": "Found 3 matching passages...",
      "duration": 0.42
    }
  ]
}
```

### 2. Retrieval Calls (`GET /retrievalCalls?filter=eq(parentQueryId,'{queryId}')`)
Returns vector search queries, similarity metrics, and extracted chunks:
```json
{
  "items": [
    {
      "id": "retrieval-call-1",
      "parentQueryId": "query-uuid-1234",
      "collectionId": "60918895-0702-4c77-83c6-96fc52cd80a0",
      "queryText": "family deductible dental",
      "score": 0.89,
      "documentName": "Benefits_2026.pdf",
      "snippet": "Annual deductible for family dental coverage is $1,500..."
    }
  ]
}
```

### 3. LLM Calls (`GET /llmCalls?filter=eq(parentQueryId,'{queryId}')`)
Returns underlying model prompts, reasoning steps, and token usage:
```json
{
  "items": [
    {
      "id": "llm-call-1",
      "parentQueryId": "query-uuid-1234",
      "promptTokens": 1420,
      "completionTokens": 185,
      "model": "gpt-4o",
      "reasoning": "Synthesizing retrieved chunks into answer..."
    }
  ]
}
```

---

## 5. Query Sessions & History (`/querySessions`)

### Endpoints
* **List Sessions**: `GET /querySessions?sortBy=insertTimestamp:descending&limit={limit}&start={start}`
* **Get Single Session**: `GET /querySessions/{sessionId}`
* **Delete Session**: `DELETE /querySessions/{sessionId}`
* **Retrieve Session Turns**: `GET /query?filter=eq(querySessionId,{sessionId})`
