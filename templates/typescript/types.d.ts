/**
 * SAS Retrieval Agent Manager (RAM) Type Definitions
 */

export interface Collection {
  id: string;
  name: string;
  description?: string;
  documentCount?: number;
  insertTimestamp?: string;
  updateTimestamp?: string;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

export interface QuerySession {
  id: string;
  title: string;
  insertTimestamp: string;
  updateTimestamp: string;
  [key: string]: unknown;
}

export interface ListQuerySessionsResponse {
  count: number;
  limit: number;
  name: string;
  start: number;
  items: QuerySession[];
}

export interface QuerySource {
  documentName?: string;
  documentId?: string;
  score?: number;
  snippet?: string;
  page?: number;
  [key: string]: unknown;
}

export interface Query {
  id: string;
  querySessionId: string;
  content: string;
  status: "completed" | "running" | "failed";
  sources?: QuerySource[];
  insertTimestamp: string;
  updateTimestamp?: string;
  [key: string]: unknown;
}

export interface QueryRequest {
  content: string;
  agentId?: string;
  collectionId?: string;
  querySessionId?: string;
}

export interface GetQuerySessionResponse {
  sessionId: string;
  items: Query[];
}

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
  code_verifier: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface AuthState {
  access_token: string | null;
  refresh_token: string | null;
}
