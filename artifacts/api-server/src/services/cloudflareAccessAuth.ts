import { createPublicKey, verify as verifySignature } from "node:crypto";

export interface CloudflareAccessAuthEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
}

export interface CloudflareAccessIdentity {
  /** Stable subject from the cryptographically verified Access JWT. */
  ownerId: string;
  /** Normalized email from the verified JWT, checked against the server allowlist. */
  email: string;
}

export type CloudflareAccessAuthResult =
  | { ok: true; identity: CloudflareAccessIdentity }
  | {
      ok: false;
      statusCode: 401 | 403 | 503;
      code: string;
      error: string;
    };

interface AccessJwtHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface AccessJwtClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  email?: unknown;
}

interface AccessJwk {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
}

interface AccessJwks {
  keys?: AccessJwk[];
}

function failure(
  statusCode: 401 | 403 | 503,
  code: string,
  error: string,
): CloudflareAccessAuthResult {
  return { ok: false, statusCode, code, error };
}

function decodeBase64Url(segment: string): Buffer {
  if (!segment || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error("Invalid base64url segment.");
  }
  return Buffer.from(segment.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
}

function decodeJsonSegment<T>(segment: string): T {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
    decodeBase64Url(segment),
  );
  return JSON.parse(decoded) as T;
}

function resolveTeamDomain(value: string): { origin: string; issuer: string } | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return { origin: url.origin, issuer: `${url.origin}/` };
  } catch {
    return null;
  }
}

function audienceMatches(claim: unknown, expected: string): boolean {
  return typeof claim === "string"
    ? claim === expected
    : Array.isArray(claim) && claim.some((value) => value === expected);
}

/**
 * Verifies a Cloudflare Access service token assertion for the API server.
 *
 * The caller must pass only the Cf-Access-Jwt-Assertion request header.
 * Identity supplied in a body, query string, or ordinary Authorization header
 * is deliberately not accepted. Configuration and all verification failures
 * fail closed.
 */
export async function authenticateCloudflareAccess(
  tokenValue: string | undefined,
  env: CloudflareAccessAuthEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<CloudflareAccessAuthResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  const allowedEmails = (env.CF_ACCESS_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!teamDomain || !audience || allowedEmails.length === 0) {
    return failure(
      503,
      "ACCESS_AUTH_NOT_CONFIGURED",
      "Cloudflare Access authentication is not configured.",
    );
  }

  const domain = resolveTeamDomain(teamDomain);
  if (!domain || audience.length > 512 || !Number.isFinite(nowSeconds)) {
    return failure(
      503,
      "ACCESS_AUTH_MISCONFIGURED",
      "Cloudflare Access issuer configuration is invalid.",
    );
  }

  const token = tokenValue?.trim();
  if (!token || token.length > 16_384) {
    return failure(
      401,
      "ACCESS_TOKEN_REQUIRED",
      "A valid Cloudflare Access identity token is required.",
    );
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return failure(401, "ACCESS_TOKEN_INVALID", "Access token is invalid.");
  }

  try {
    const header = decodeJsonSegment<AccessJwtHeader>(segments[0]);
    const claims = decodeJsonSegment<AccessJwtClaims>(segments[1]);

    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      !header.kid ||
      header.kid.length > 256
    ) {
      throw new Error("Unsupported JWT header.");
    }

    if (
      claims.iss !== domain.issuer ||
      !audienceMatches(claims.aud, audience) ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= nowSeconds ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== "number" ||
          !Number.isFinite(claims.nbf) ||
          claims.nbf > nowSeconds)) ||
      typeof claims.sub !== "string" ||
      !claims.sub.trim() ||
      claims.sub.length > 256 ||
      typeof claims.email !== "string" ||
      !claims.email.trim() ||
      claims.email.length > 320
    ) {
      throw new Error("JWT claims validation failed.");
    }

    const jwksResponse = await fetch(`${domain.origin}/cdn-cgi/access/certs`, {
      headers: { Accept: "application/json" },
    });
    if (!jwksResponse.ok) {
      return failure(
        503,
        "ACCESS_SIGNING_KEYS_UNAVAILABLE",
        "Cloudflare Access signing keys are temporarily unavailable.",
      );
    }

    const jwks = (await jwksResponse.json()) as AccessJwks;
    const jwk = jwks.keys?.find(
      (key) =>
        key.kid === header.kid &&
        key.kty === "RSA" &&
        (!key.alg || key.alg === "RS256") &&
        (!key.use || key.use === "sig") &&
        (!key.key_ops || key.key_ops.includes("verify")),
    );
    if (!jwk) {
      throw new Error("Matching Access signing key not found.");
    }

    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    const signatureValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${segments[0]}.${segments[1]}`, "utf8"),
      publicKey,
      decodeBase64Url(segments[2]),
    );
    if (!signatureValid) {
      throw new Error("JWT signature is invalid.");
    }

    const email = claims.email.trim().toLowerCase();
    if (!allowedEmails.includes(email)) {
      return failure(
        403,
        "ACCESS_IDENTITY_NOT_ALLOWED",
        "This Cloudflare Access identity is not authorized.",
      );
    }

    return {
      ok: true,
      identity: { ownerId: claims.sub.trim(), email },
    };
  } catch {
    // Never return token contents, signing keys, or provider details to clients.
    return failure(401, "ACCESS_TOKEN_INVALID", "Access token is invalid or expired.");
  }
}
