import { createHash, randomBytes } from "node:crypto";
import { DeviceAuthResponse, TokenResponse } from "./types";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Initiates the OAuth 2.0 Device Authorization flow with SAS RAM
 */
export async function initiateDeviceAuthorization(ramUrl: string): Promise<DeviceAuthResponse> {
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
 * Polls the SAS RAM token endpoint for the user's authorization
 */
export async function pollDeviceToken(
  ramUrl: string,
  deviceCode: string,
  codeVerifier: string,
): Promise<{ status: "pending" | "ready"; tokens?: TokenResponse }> {
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

  const tokens: TokenResponse = await response.json();
  return { status: "ready", tokens };
}

/**
 * Refreshes an expired access token using the refresh_token
 */
export async function refreshAccessToken(
  ramUrl: string,
  refreshToken: string,
): Promise<TokenResponse> {
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
