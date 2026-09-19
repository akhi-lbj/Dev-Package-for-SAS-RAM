/**
 * Client Chat Service (JavaScript) for SAS Retrieval Agent Manager
 * Interfaces with the local BFF proxy (/api/ram-proxy)
 */

const PAGE_SIZE = 100;

export class SasRamClient {
  /**
   * @param {string} [proxyBaseUrl='/api/ram-proxy'] - Base URL of your local proxy
   * @param {() => string | null} [getToken] - Function returning the active Bearer access token
   */
  constructor(proxyBaseUrl = "/api/ram-proxy", getToken = () => null) {
    this.proxyBaseUrl = proxyBaseUrl;
    this.getToken = getToken;
  }

  async _request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const url = `${this.proxyBaseUrl}?endpoint=${encodeURIComponent(endpoint)}`;
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Fetch list of available document collections
   */
  async getCollections(limit = PAGE_SIZE, start = 0) {
    const data = await this._request(`/collections?limit=${limit}&start=${start}`);
    return (data.items || []).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetch list of available retrieval agents
   */
  async getAgents(limit = PAGE_SIZE, start = 0) {
    const data = await this._request(`/agents?limit=${limit}&start=${start}`);
    return (data.items || []).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetch list of chat sessions sorted by newest first
   */
  async getSessions() {
    const data = await this._request("/querySessions?sortBy=insertTimestamp:descending");
    return data.items || [];
  }

  /**
   * Fetch all question/response turns for a specific session ID
   * @param {string} sessionId
   */
  async getQuerySession(sessionId) {
    const data = await this._request(`/query?filter=eq(querySessionId,${sessionId})`);
    return data.items || [];
  }

  /**
   * Send a query/prompt to an agent or collection
   * @param {Object} params
   * @param {string} params.content - User prompt text
   * @param {string} [params.agentId] - Target agent UUID
   * @param {string} [params.querySessionId] - Existing session UUID to continue conversation
   */
  async sendQuery({ content, agentId, querySessionId }) {
    return this._request("/query?synchronous=true&persist=true", {
      method: "POST",
      body: JSON.stringify({
        content,
        agentId,
        querySessionId,
      }),
    });
  }
}
