import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request, RequestHandler } from "express";
import { pool } from "@workspace/db";
import type {
  GitHubApprovalVerifier,
  GitHubRepositoryAccessVerifier,
  GitHubRepository,
  GitHubRepositoryAccess,
  GitHubWriteAction,
} from "./githubIntegration";

const SESSION_COOKIE = "badboy_github_session";
const STATE_COOKIE = "badboy_github_oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVAL_TTL_MS = 2 * 60 * 1000;
const GITHUB_API = "https://api.github.com";

export interface GitHubOwnerIdentity {
  id: number;
  login: string;
  name: string | null;
}

export interface GitHubOwnerSession {
  id: string;
  identity: GitHubOwnerIdentity;
  accessToken: string;
}

export interface GitHubDeveloperEnv {
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CALLBACK_URL?: string;
  GITHUB_OWNER_IDS?: string;
  GITHUB_SESSION_SECRET?: string;
  GITHUB_TOKEN_ENCRYPTION_KEY?: string;
  APP_ORIGIN?: string;
}

export class GitHubDeveloperSecurityError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GitHubDeveloperSecurityError";
  }
}

function requiredEnv(value: string | undefined, name: string): string {
  const result = value?.trim();
  if (!result) {
    throw new GitHubDeveloperSecurityError(
      `${name} is not configured.`,
      503,
      "GITHUB_DEVELOPER_NOT_CONFIGURED",
    );
  }
  return result;
}

function sessionSecret(env: GitHubDeveloperEnv): string {
  const secret = requiredEnv(env.GITHUB_SESSION_SECRET, "GITHUB_SESSION_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new GitHubDeveloperSecurityError(
      "GITHUB_SESSION_SECRET must contain at least 32 bytes.",
      503,
      "GITHUB_SESSION_SECRET_INVALID",
    );
  }
  return secret;
}

function encryptionKey(env: GitHubDeveloperEnv): Buffer {
  const raw = requiredEnv(env.GITHUB_TOKEN_ENCRYPTION_KEY, "GITHUB_TOKEN_ENCRYPTION_KEY");
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/u, "") !== raw.replace(/=+$/u, "")) {
    throw new GitHubDeveloperSecurityError(
      "GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
      503,
      "GITHUB_ENCRYPTION_KEY_INVALID",
    );
  }
  return key;
}

export function isGitHubOwnerAllowed(ownerId: number, env: GitHubDeveloperEnv): boolean {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return false;
  const allowed = (env.GITHUB_OWNER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/u.test(value));
  return allowed.includes(String(ownerId));
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOAuthState(env: GitHubDeveloperEnv): string {
  const state = randomBytes(32).toString("base64url");
  return `${state}.${sign(state, sessionSecret(env))}`;
}

export function verifyOAuthState(value: string | undefined, expected: string | undefined, env: GitHubDeveloperEnv): boolean {
  if (!value || !expected || value.length > 256 || expected.length > 256) return false;
  const [state, signature, extra] = value.split(".");
  const [expectedState, expectedSignature, expectedExtra] = expected.split(".");
  if (extra || expectedExtra || !state || !signature || !expectedState || !expectedSignature) return false;
  const secret = sessionSecret(env);
  return safeEqual(state, expectedState) &&
    safeEqual(signature, sign(state, secret)) &&
    safeEqual(expectedSignature, sign(expectedState, secret));
}

function encryptToken(token: string, env: GitHubDeveloperEnv) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptToken(row: { token_ciphertext: string; token_iv: string; token_tag: string }, env: GitHubDeveloperEnv): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(row.token_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.token_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function createSessionCookie(sessionId: string, env: GitHubDeveloperEnv): string {
  return `${sessionId}.${sign(sessionId, sessionSecret(env))}`;
}

function readSessionCookie(value: string | undefined, env: GitHubDeveloperEnv): string | null {
  if (!value || value.length > 256) return null;
  const [sessionId, signature, extra] = value.split(".");
  if (extra || !sessionId || !signature || !/^[a-f0-9-]{36}$/iu.test(sessionId)) return null;
  return safeEqual(signature, sign(sessionId, sessionSecret(env))) ? sessionId : null;
}

export async function createGitHubOwnerSession(
  identity: GitHubOwnerIdentity,
  accessToken: string,
  env: GitHubDeveloperEnv,
): Promise<string> {
  if (!isGitHubOwnerAllowed(identity.id, env)) {
    throw new GitHubDeveloperSecurityError("This GitHub account is not on the owner allowlist.", 403, "GITHUB_OWNER_NOT_ALLOWED");
  }
  if (!accessToken || accessToken.length > 8192) {
    throw new GitHubDeveloperSecurityError("GitHub OAuth did not return a valid access token.", 401, "GITHUB_OAUTH_TOKEN_INVALID");
  }
  const id = randomUUID();
  const encrypted = encryptToken(accessToken, env);
  await pool.query(
    `INSERT INTO github_developer_sessions
      (id, owner_id, owner_login, owner_name, token_ciphertext, token_iv, token_tag, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '7 days')`,
    [id, String(identity.id), identity.login, identity.name, encrypted.tokenCiphertext, encrypted.tokenIv, encrypted.tokenTag],
  );
  return createSessionCookie(id, env);
}

export async function getGitHubOwnerSession(
  cookieValue: string | undefined,
  env: GitHubDeveloperEnv,
): Promise<GitHubOwnerSession | null> {
  const id = readSessionCookie(cookieValue, env);
  if (!id) return null;
  const result = await pool.query<{
    owner_id: string;
    owner_login: string;
    owner_name: string | null;
    token_ciphertext: string;
    token_iv: string;
    token_tag: string;
  }>(
    `SELECT owner_id, owner_login, owner_name, token_ciphertext, token_iv, token_tag
       FROM github_developer_sessions
      WHERE id = $1 AND expires_at > NOW()`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const ownerId = Number(row.owner_id);
  if (!isGitHubOwnerAllowed(ownerId, env)) return null;
  return {
    id,
    identity: { id: ownerId, login: row.owner_login, name: row.owner_name },
    accessToken: decryptToken(row, env),
  };
}

export async function deleteGitHubOwnerSession(cookieValue: string | undefined, env: GitHubDeveloperEnv): Promise<void> {
  const id = readSessionCookie(cookieValue, env);
  if (id) await pool.query("DELETE FROM github_developer_sessions WHERE id = $1", [id]);
}

export interface GitHubDeveloperRequest extends Request {
  githubOwner?: GitHubOwnerSession;
}

export function requireGitHubOwnerSession(env: GitHubDeveloperEnv): RequestHandler {
  return async (req, res, next) => {
    try {
      const session = await getGitHubOwnerSession(req.cookies?.[SESSION_COOKIE], env);
      if (!session) {
        res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Connect the owner GitHub account first." });
        return;
      }
      (req as GitHubDeveloperRequest).githubOwner = session;
      next();
    } catch {
      res.status(503).json({ code: "GITHUB_OWNER_SESSION_UNAVAILABLE", error: "Owner authentication is temporarily unavailable." });
    }
  };
}

export class GitHubOwnerRepositoryAccessVerifier implements GitHubRepositoryAccessVerifier {
  constructor(private readonly accessToken: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async hasAccess(input: { repository: GitHubRepository; access: GitHubRepositoryAccess }): Promise<boolean> {
    const parts = input.repository.fullName.split("/");
    if (parts.length !== 2 || parts.some((part) => !part)) return false;
    const response = await this.fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) return false;
    const repo = await response.json() as { permissions?: { pull?: boolean; push?: boolean; maintain?: boolean; admin?: boolean } };
    return input.access === "read"
      ? repo.permissions?.pull === true || repo.permissions?.push === true || repo.permissions?.maintain === true || repo.permissions?.admin === true
      : repo.permissions?.push === true || repo.permissions?.maintain === true || repo.permissions?.admin === true;
  }
}

export class PostgresGitHubApprovalVerifier implements GitHubApprovalVerifier {
  constructor(private readonly ownerId: number) {}

  async consume(input: {
    approvalId: string;
    action: GitHubWriteAction;
    resource: string;
    requestHash: string;
  }): Promise<boolean> {
    const result = await pool.query(
      `UPDATE github_developer_approvals
          SET consumed_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND action = $3
          AND resource = $4
          AND request_hash = $5
          AND consumed_at IS NULL
          AND expires_at > NOW()
      RETURNING id`,
      [input.approvalId, String(this.ownerId), input.action, input.resource, input.requestHash],
    );
    const consumed = result.rowCount === 1;
    await pool.query(
      `INSERT INTO github_developer_audit_logs (owner_id, action, resource, approval_id, outcome)
       VALUES ($1, $2, $3, $4, $5)`,
      [String(this.ownerId), input.action, input.resource, input.approvalId, consumed ? "approved-write-consumed" : "approval-rejected"],
    );
    return consumed;
  }
}

export async function issueGitHubWriteApproval(input: {
  ownerId: number;
  action: GitHubWriteAction;
  resource: string;
  requestHash: string;
}): Promise<string> {
  const id = randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO github_developer_approvals
      (id, owner_id, action, resource, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 millisecond'))`,
    [id, String(input.ownerId), input.action, input.resource, input.requestHash, APPROVAL_TTL_MS],
  );
  await pool.query(
    `INSERT INTO github_developer_audit_logs (owner_id, action, resource, approval_id, outcome)
     VALUES ($1, $2, $3, $4, 'approval-issued')`,
    [String(input.ownerId), input.action, input.resource, id],
  );
  return id;
}

export const githubDeveloperCookies = {
  session: SESSION_COOKIE,
  state: STATE_COOKIE,
  sessionMaxAge: SESSION_TTL_MS,
};

export function githubDeveloperCookieOptions(env: GitHubDeveloperEnv) {
  const appOrigin = requiredEnv(env.APP_ORIGIN, "APP_ORIGIN");
  const parsed = new URL(appOrigin);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new GitHubDeveloperSecurityError("APP_ORIGIN must use HTTPS.", 503, "APP_ORIGIN_INVALID");
  }
  return { httpOnly: true, secure: parsed.protocol === "https:", sameSite: "lax" as const, path: "/api/github", maxAge: SESSION_TTL_MS };
}
