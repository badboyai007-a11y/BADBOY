import { randomBytes, randomUUID } from "node:crypto";
import { githubOwnerControlPage } from "./githubOwnerControlPage";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  requireGitHubOwnerSession,
  type GitHubDeveloperEnv,
  type GitHubDeveloperRequest,
} from "../services/githubDeveloperSecurity";

const router = Router();
const env: GitHubDeveloperEnv = process.env;
const requireOwner = requireGitHubOwnerSession(env);
const ACTIONS = new Set(["create-branch", "create-draft-pr", "dispatch-workflow"]);

function ownerId(req: Request): number | null {
  return (req as GitHubDeveloperRequest).githubOwner?.identity.id ?? null;
}

function sameOrigin(req: Request, res: Response, next: NextFunction) {
  try {
    const expected = new URL(env.APP_ORIGIN ?? "").origin;
    if (!req.get("origin") || req.get("origin") !== expected) {
      res.status(403).json({ code: "CROSS_ORIGIN_REQUEST_BLOCKED" });
      return;
    }
    next();
  } catch {
    res.status(503).json({ code: "APP_ORIGIN_INVALID" });
  }
}

function validRepository(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u.test(value);
}

function validBranchPattern(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 250) return false;
  if (value === "*") return true;
  const branch = value.endsWith("/*") ? value.slice(0, -2) : value;
  return branch.length > 0 &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !/[\u0000-\u0020~^:?\[\]\\]/u.test(branch);
}


router.get("/owner-control", (_req, res) => {
  const nonce = randomBytes(18).toString("base64");
  res.set({
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.type("html").send(githubOwnerControlPage.replace("__NONCE__", nonce));
});

router.get("/lockdown", requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  try {
    const result = await pool.query(
      `SELECT reason, locked_at AS "lockedAt" FROM github_developer_lockdowns WHERE owner_id = $1`,
      [String(id)],
    );
    res.json({ locked: result.rowCount === 1, ...(result.rows[0] ?? {}) });
  } catch {
    res.status(503).json({ code: "LOCKDOWN_STATUS_UNAVAILABLE" });
  }
});

router.get("/permissions", requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  try {
    const result = await pool.query(
      `SELECT id, repository, branch_pattern AS "branchPattern", actions,
              expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
         FROM github_developer_permissions
        WHERE owner_id = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [String(id)],
    );
    res.json({ permissions: result.rows });
  } catch {
    res.status(503).json({ code: "PERMISSION_STORE_UNAVAILABLE" });
  }
});

router.post("/permissions", sameOrigin, requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  const { repository, branchPattern, actions, expiresInSeconds } = req.body ?? {};
  if (!validRepository(repository) || !validBranchPattern(branchPattern) ||
      !Array.isArray(actions) || actions.length === 0 ||
      actions.some((action: unknown) => typeof action !== "string" || !ACTIONS.has(action)) ||
      new Set(actions).size !== actions.length ||
      !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 30 * 24 * 60 * 60) {
    return res.status(400).json({ code: "INVALID_PERMISSION_GRANT" });
  }

  try {
    const permissionId = randomUUID();
    const result = await pool.query(
      `INSERT INTO github_developer_permissions
        (id, owner_id, repository, branch_pattern, actions, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW() + ($6 * INTERVAL '1 second'))
       RETURNING id, repository, branch_pattern AS "branchPattern", actions, expires_at AS "expiresAt"`,
      [permissionId, String(id), repository, branchPattern, JSON.stringify(actions), expiresInSeconds],
    );
    await pool.query(
      `INSERT INTO github_developer_audit_logs (owner_id, action, resource, outcome)
       VALUES ($1, 'permission-grant', $2, 'owner-granted')`,
      [String(id), `${repository}:${branchPattern}:${actions.join(",")}`],
    );
    res.status(201).json({ permission: result.rows[0] });
  } catch {
    res.status(503).json({ code: "PERMISSION_GRANT_FAILED" });
  }
});

router.delete("/permissions/:permissionId", sameOrigin, requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  try {
    const result = await pool.query(
      `UPDATE github_developer_permissions
          SET revoked_at = NOW()
        WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL
        RETURNING repository, branch_pattern`,
      [req.params.permissionId, String(id)],
    );
    if (result.rowCount !== 1) return res.status(404).json({ code: "PERMISSION_NOT_FOUND" });
    await pool.query(
      `INSERT INTO github_developer_audit_logs (owner_id, action, resource, outcome)
       VALUES ($1, 'permission-revoke', $2, 'owner-revoked')`,
      [String(id), `${result.rows[0].repository}:${result.rows[0].branch_pattern}`],
    );
    res.status(204).end();
  } catch {
    res.status(503).json({ code: "PERMISSION_REVOKE_FAILED" });
  }
});

router.post("/lockdown", sameOrigin, requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "Owner emergency lockdown";
  try {
    await pool.query(
      `INSERT INTO github_developer_lockdowns (owner_id, reason)
       VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET reason = EXCLUDED.reason, locked_at = NOW()`,
      [String(id), reason],
    );
    await pool.query(
      `INSERT INTO github_developer_audit_logs (owner_id, action, resource, outcome)
       VALUES ($1, 'emergency-lockdown', 'all-repositories', 'owner-locked')`,
      [String(id)],
    );
    res.status(200).json({ locked: true });
  } catch {
    res.status(503).json({ code: "LOCKDOWN_FAILED" });
  }
});

router.delete("/lockdown", sameOrigin, requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  try {
    await pool.query("DELETE FROM github_developer_lockdowns WHERE owner_id = $1", [String(id)]);
    await pool.query(
      `INSERT INTO github_developer_audit_logs (owner_id, action, resource, outcome)
       VALUES ($1, 'emergency-lockdown-release', 'all-repositories', 'owner-unlocked')`,
      [String(id)],
    );
    res.status(200).json({ locked: false });
  } catch {
    res.status(503).json({ code: "LOCKDOWN_RELEASE_FAILED" });
  }
});

router.get("/audit", requireOwner, async (req, res) => {
  const id = ownerId(req);
  if (!id) return res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED" });
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 100;
  try {
    const result = await pool.query(
      `SELECT id, action, resource, approval_id AS "approvalId",
              outcome, created_at AS "createdAt"
         FROM github_developer_audit_logs
        WHERE owner_id = $1
        ORDER BY id DESC
        LIMIT $2`,
      [String(id), limit],
    );
    res.json({ entries: result.rows });
  } catch {
    res.status(503).json({ code: "AUDIT_LOG_UNAVAILABLE" });
  }
});

export default router;
