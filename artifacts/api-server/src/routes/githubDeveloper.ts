import { Router } from "express";
import { createHash } from "node:crypto";
import {
  createDraftPullRequest,
  createRepositoryBranch,
  dispatchAllowlistedWorkflow,
  readRepositoryFile,
} from "../services/githubIntegration";
import {
  createGitHubOwnerSession,
  createOAuthState,
  deleteGitHubOwnerSession,
  githubDeveloperCookieOptions,
  githubDeveloperCookies,
  GitHubDeveloperSecurityError,
  GitHubOwnerRepositoryAccessVerifier,
  issueGitHubWriteApproval,
  PostgresGitHubApprovalVerifier,
  requireGitHubOwnerSession,
  verifyOAuthState,
  type GitHubDeveloperEnv,
  type GitHubDeveloperRequest,
} from "../services/githubDeveloperSecurity";

const router = Router();
const env: GitHubDeveloperEnv = process.env;

function clearStateCookie(res: import("express").Response) {
  res.clearCookie(githubDeveloperCookies.state, {
    ...githubDeveloperCookieOptions(env),
    maxAge: undefined,
  });
}

function oauthError(res: import("express").Response, error: unknown) {
  if (error instanceof GitHubDeveloperSecurityError) {
    res.status(error.statusCode).json({ code: error.code, error: error.message });
    return;
  }
  res.status(503).json({
    code: "GITHUB_OAUTH_UNAVAILABLE",
    error: "GitHub owner authentication is temporarily unavailable.",
  });
}

router.get("/oauth/start", (_req, res) => {
  try {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
    const callbackUrl = env.GITHUB_OAUTH_CALLBACK_URL?.trim();
    if (!clientId || !callbackUrl) {
      throw new GitHubDeveloperSecurityError(
        "GitHub OAuth client ID and callback URL must be configured.",
        503,
        "GITHUB_OAUTH_NOT_CONFIGURED",
      );
    }
    const state = createOAuthState(env);
    res.cookie(githubDeveloperCookies.state, state, {
      ...githubDeveloperCookieOptions(env),
      maxAge: 10 * 60 * 1000,
    });
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", callbackUrl);
    authorize.searchParams.set("scope", "read:user repo");
    authorize.searchParams.set("state", state);
    res.redirect(302, authorize.toString());
  } catch (error) {
    oauthError(res, error);
  }
});

router.get("/oauth/callback", async (req, res) => {
  try {
    const stateCookie = req.cookies?.[githubDeveloperCookies.state] as string | undefined;
    clearStateCookie(res);
    if (!verifyOAuthState(req.query.state as string | undefined, stateCookie, env)) {
      res.status(400).json({ code: "GITHUB_OAUTH_STATE_INVALID", error: "GitHub OAuth state validation failed." });
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code || code.length > 512) {
      res.status(400).json({ code: "GITHUB_OAUTH_CODE_INVALID", error: "GitHub did not return a valid authorization code." });
      return;
    }

    const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
    const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new GitHubDeveloperSecurityError("GitHub OAuth credentials are not configured.", 503, "GITHUB_OAUTH_NOT_CONFIGURED");
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error("OAuth token exchange failed.");
    const tokenPayload = await tokenResponse.json() as { access_token?: string; token_type?: string; scope?: string; error?: string };
    const grantedScopes = (tokenPayload.scope ?? "").split(/[ ,]/u).filter(Boolean);
    if (tokenPayload.error || tokenPayload.token_type?.toLowerCase() !== "bearer" || !tokenPayload.access_token || !grantedScopes.includes("repo") || !grantedScopes.includes("read:user")) {
      res.status(401).json({ code: "GITHUB_OAUTH_EXCHANGE_FAILED", error: "GitHub authorization could not be completed." });
      return;
    }

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!profileResponse.ok) throw new Error("GitHub profile lookup failed.");
    const profile = await profileResponse.json() as { id?: number; login?: string; name?: string | null };
    if (!Number.isSafeInteger(profile.id) || !profile.login) {
      res.status(401).json({ code: "GITHUB_PROFILE_INVALID", error: "GitHub did not return a valid owner identity." });
      return;
    }

    const sessionCookie = await createGitHubOwnerSession(
      { id: profile.id as number, login: profile.login, name: profile.name ?? null },
      tokenPayload.access_token,
      env,
    );
    res.cookie(githubDeveloperCookies.session, sessionCookie, githubDeveloperCookieOptions(env));
    const origin = env.APP_ORIGIN?.trim();
    if (!origin) throw new GitHubDeveloperSecurityError("APP_ORIGIN is not configured.", 503, "APP_ORIGIN_INVALID");
    res.redirect(302, new URL("/api/github/controls/owner-control", origin).toString());
  } catch (error) {
    oauthError(res, error);
  }
});

const requireOwner = requireGitHubOwnerSession(env);

function requireSameOrigin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  try {
    const expectedOrigin = new URL(env.APP_ORIGIN ?? "").origin;
    const requestOrigin = req.get("origin");
    if (!requestOrigin || requestOrigin !== expectedOrigin) {
      res.status(403).json({ code: "CROSS_ORIGIN_REQUEST_BLOCKED", error: "This action must originate from the configured owner application." });
      return;
    }
    next();
  } catch {
    res.status(503).json({ code: "APP_ORIGIN_INVALID", error: "Owner application origin is not configured." });
  }
}



router.get("/me", requireOwner, (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  res.json({ id: owner.identity.id, login: owner.identity.login, name: owner.identity.name });
});


function repositoryFromParams(req: import("express").Request) {
  return { fullName: `${req.params.owner}/${req.params.repo}` };
}

function ownerVerifier(owner: NonNullable<GitHubDeveloperRequest["githubOwner"]>) {
  return new GitHubOwnerRepositoryAccessVerifier(owner.accessToken);
}

router.get("/repositories/:owner/:repo/access", requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  try {
    const repository = { fullName: `${req.params.owner}/${req.params.repo}` };
    const verifier = new GitHubOwnerRepositoryAccessVerifier(owner.accessToken);
    const [read, write] = await Promise.all([
      verifier.hasAccess({ repository, access: "read" }),
      verifier.hasAccess({ repository, access: "write" }),
    ]);
    res.json({ repository: repository.fullName, read, write });
  } catch {
    res.status(502).json({ code: "GITHUB_PERMISSION_CHECK_FAILED", error: "GitHub repository permission could not be verified." });
  }
});


router.get("/repositories/:owner/:repo/contents", requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const path = typeof req.query.path === "string" ? req.query.path : "";
  const ref = typeof req.query.ref === "string" ? req.query.ref : undefined;
  try {
    const result = await readRepositoryFile(
      repositoryFromParams(req),
      path,
      ownerVerifier(owner),
      ref,
      { token: owner.accessToken },
    );
    res.json(result);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 502;
    res.status(status >= 400 && status <= 599 ? status : 502).json({
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "GITHUB_REPOSITORY_READ_FAILED",
      error: "GitHub repository content could not be read.",
    });
  }
});

router.post("/repositories/:owner/:repo/branches", requireSameOrigin, requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const { branch, baseSha, approvalId } = req.body ?? {};
  const repository = repositoryFromParams(req);
  if (typeof branch !== "string" || typeof baseSha !== "string" || typeof approvalId !== "string") {
    res.status(400).json({ code: "INVALID_BRANCH_REQUEST", error: "Branch, base SHA and approval ID are required." });
    return;
  }
  try {
    const result = await createRepositoryBranch(
      repository,
      branch,
      baseSha,
      { approvalId },
      new PostgresGitHubApprovalVerifier(owner.identity.id),
      ownerVerifier(owner),
      { token: owner.accessToken },
    );
    res.status(201).json(result);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 502;
    res.status(status >= 400 && status <= 599 ? status : 502).json({
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "GITHUB_BRANCH_CREATE_FAILED",
      error: "GitHub branch could not be created.",
    });
  }
});

router.post("/repositories/:owner/:repo/pull-requests/draft", requireSameOrigin, requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const { head, base, title, body, approvalId } = req.body ?? {};
  const repository = repositoryFromParams(req);
  if ([head, base, title, body, approvalId].some((value) => typeof value !== "string")) {
    res.status(400).json({ code: "INVALID_DRAFT_PR_REQUEST", error: "Head, base, title, body and approval ID are required." });
    return;
  }
  try {
    const result = await createDraftPullRequest(
      repository,
      { head, base, title, body, approval: { approvalId } },
      new PostgresGitHubApprovalVerifier(owner.identity.id),
      ownerVerifier(owner),
      { token: owner.accessToken },
    );
    res.status(201).json(result);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 502;
    res.status(status >= 400 && status <= 599 ? status : 502).json({
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "GITHUB_DRAFT_PR_CREATE_FAILED",
      error: "Draft pull request could not be created.",
    });
  }
});

router.post("/repositories/:owner/:repo/workflows/dispatch", requireSameOrigin, requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const { workflowId, ref, inputs, approvalId } = req.body ?? {};
  const repository = repositoryFromParams(req);
  if (typeof workflowId !== "string" || typeof ref !== "string" || typeof approvalId !== "string") {
    res.status(400).json({ code: "INVALID_WORKFLOW_DISPATCH_REQUEST", error: "Workflow ID, ref and approval ID are required." });
    return;
  }
  try {
    await dispatchAllowlistedWorkflow(
      repository,
      { workflowId, ref, inputs, approval: { approvalId } },
      new PostgresGitHubApprovalVerifier(owner.identity.id),
      ownerVerifier(owner),
      { token: owner.accessToken },
    );
    res.status(202).json({ dispatched: true });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 502;
    res.status(status >= 400 && status <= 599 ? status : 502).json({
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "GITHUB_WORKFLOW_DISPATCH_FAILED",
      error: "GitHub workflow could not be dispatched.",
    });
  }
});

router.post("/approvals", requireSameOrigin, requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const { action, request } = req.body ?? {};
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    res.status(400).json({ code: "INVALID_APPROVAL_REQUEST", error: "The exact proposed write request is required." });
    return;
  }

  const repository = (request as { repository?: unknown }).repository;
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})\/[A-Za-z0-9._-]{1,100}$/u.test(repository)
  ) {
    res.status(400).json({ code: "INVALID_APPROVAL_REPOSITORY", error: "A valid owner/name repository is required." });
    return;
  }

  let resource = "";
  let canonicalRequest: Record<string, unknown>;
  if (action === "create-branch") {
    const { branch, baseSha } = request as { branch?: unknown; baseSha?: unknown };
    if (typeof branch !== "string" || typeof baseSha !== "string" || !/^[a-f0-9]{40}$/iu.test(baseSha)) {
      res.status(400).json({ code: "INVALID_APPROVAL_REQUEST", error: "A branch name and full base commit SHA are required." });
      return;
    }
    resource = `${repository}:${branch}`;
    canonicalRequest = { repository, branch, baseSha };
  } else if (action === "create-draft-pr") {
    const { head, base, title, body } = request as { head?: unknown; base?: unknown; title?: unknown; body?: unknown };
    if ([head, base, title, body].some((value) => typeof value !== "string") || !(title as string).trim()) {
      res.status(400).json({ code: "INVALID_APPROVAL_REQUEST", error: "Head, base, title and body are required for a Draft PR." });
      return;
    }
    resource = `${repository}:${head}->${base}`;
    canonicalRequest = { repository, head, base, title: (title as string).trim(), body, draft: true };
  } else if (action === "dispatch-workflow") {
    const { workflowId, ref, inputs } = request as { workflowId?: unknown; ref?: unknown; inputs?: unknown };
    if (typeof workflowId !== "string" || typeof ref !== "string" || (inputs !== undefined && (!inputs || typeof inputs !== "object" || Array.isArray(inputs)))) {
      res.status(400).json({ code: "INVALID_APPROVAL_REQUEST", error: "Workflow ID, ref and optional object inputs are required." });
      return;
    }
    const safeInputs = (inputs ?? {}) as Record<string, string>;
    resource = `${repository}:${workflowId}@${ref}`;
    canonicalRequest = { repository, workflowId, ref, inputs: safeInputs };
  } else {
    res.status(400).json({ code: "INVALID_APPROVAL_ACTION", error: "This write action cannot be approved." });
    return;
  }

  const requestHash = createHash("sha256").update(JSON.stringify(canonicalRequest)).digest("hex");
  try {
    const approvalId = await issueGitHubWriteApproval({
      ownerId: owner.identity.id,
      action,
      resource,
      requestHash,
    });
    res.status(201).json({
      approvalId,
      action,
      resource,
      requestHash,
      expiresInSeconds: 120,
      singleUse: true,
    });
  } catch {
    res.status(503).json({ code: "APPROVAL_STORE_UNAVAILABLE", error: "Owner approval could not be stored." });
  }
});

router.post("/oauth/logout", requireSameOrigin, async (req, res) => {
  try {
    await deleteGitHubOwnerSession(req.cookies?.[githubDeveloperCookies.session] as string | undefined, env);
    res.clearCookie(githubDeveloperCookies.session, githubDeveloperCookieOptions(env));
    res.status(204).end();
  } catch {
    res.status(503).json({ code: "GITHUB_LOGOUT_UNAVAILABLE", error: "GitHub session could not be revoked." });
  }
});

export default router;
