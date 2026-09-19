import { createHash, randomBytes } from "node:crypto";

/**
 * Generates a cryptographically random PKCE code verifier (32 bytes base64url)
 */
export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

/**
 * Generates the SHA-256 code challenge for a PKCE verifier
 */
export function generateCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Initiates the OAuth 2.0 Device Authorization flow with SAS RAM
 * @param {string} ramUrl - Base URL of SAS RAM instance (e.g. https://<your-sas-ram-host>)
 */
export async function initiateDeviceAuthorization(ramUrl) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const authUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/auth/device`;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: "sas-ram-api",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "openid",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Device authorization failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return {
    ...data,
    code_verifier: codeVerifier,
  };
}

/**
 * Polls the SAS RAM token endpoint for user authorization
 * @param {string} ramUrl - Base URL of SAS RAM instance
 * @param {string} deviceCode - The device_code from initiateDeviceAuthorization
 * @param {string} codeVerifier - The PKCE code verifier
 */
export async function pollDeviceToken(ramUrl, deviceCode, codeVerifier) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const tokenUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: "sas-ram-api",
      device_code: deviceCode,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData.error === "authorization_pending") {
      return { status: "pending" };
    }
    throw new Error(errorData.error_description || errorData.error || "Token exchange failed");
  }

  const tokens = await response.json();
  return { status: "ready", tokens };
}

/**
 * Refreshes an expired access token using the refresh_token
 * @param {string} ramUrl - Base URL of SAS RAM instance
 * @param {string} refreshToken - Refresh token string
 */
export async function refreshAccessToken(ramUrl, refreshToken) {
  const normalizedUrl = ramUrl.replace(/\/+$/, "");
  const tokenUrl = `${normalizedUrl}/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "sas-ram-api",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${err}`);
  }

  return response.json();
}
