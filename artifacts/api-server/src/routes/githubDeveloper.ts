import { Router } from "express";
import {
  createGitHubOwnerSession,
  createOAuthState,
  deleteGitHubOwnerSession,
  githubDeveloperCookieOptions,
  githubDeveloperCookies,
  GitHubDeveloperSecurityError,
  GitHubOwnerRepositoryAccessVerifier,
  issueGitHubWriteApproval,
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
    const tokenPayload = await tokenResponse.json() as { access_token?: string; token_type?: string; error?: string };
    if (tokenPayload.error || tokenPayload.token_type?.toLowerCase() !== "bearer" || !tokenPayload.access_token) {
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
    res.redirect(302, new URL("/", origin).toString());
  } catch (error) {
    oauthError(res, error);
  }
});

const requireOwner = requireGitHubOwnerSession(env);

router.get("/me", requireOwner, (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  res.json({ id: owner.identity.id, login: owner.identity.login, name: owner.identity.name });
});

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

router.post("/approvals", requireOwner, async (req, res) => {
  const owner = (req as GitHubDeveloperRequest).githubOwner;
  if (!owner) {
    res.status(401).json({ code: "GITHUB_OWNER_SESSION_REQUIRED", error: "Owner session is required." });
    return;
  }
  const { action, resource, requestHash } = req.body ?? {};
  const allowedActions = new Set(["create-branch", "create-draft-pr", "dispatch-workflow"]);
  if (
    typeof action !== "string" ||
    !allowedActions.has(action) ||
    typeof resource !== "string" ||
    !resource.trim() ||
    resource.length > 512 ||
    typeof requestHash !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(requestHash)
  ) {
    res.status(400).json({ code: "INVALID_APPROVAL_REQUEST", error: "A valid action, resource and SHA-256 request hash are required." });
    return;
  }
  try {
    const approvalId = await issueGitHubWriteApproval({
      ownerId: owner.identity.id,
      action: action as "create-branch" | "create-draft-pr" | "dispatch-workflow",
      resource,
      requestHash,
    });
    res.status(201).json({ approvalId, expiresInSeconds: 120, singleUse: true });
  } catch {
    res.status(503).json({ code: "APPROVAL_STORE_UNAVAILABLE", error: "Owner approval could not be stored." });
  }
});

router.post("/oauth/logout", async (req, res) => {
  try {
    await deleteGitHubOwnerSession(req.cookies?.[githubDeveloperCookies.session] as string | undefined, env);
    res.clearCookie(githubDeveloperCookies.session, githubDeveloperCookieOptions(env));
    res.status(204).end();
  } catch {
    res.status(503).json({ code: "GITHUB_LOGOUT_UNAVAILABLE", error: "GitHub session could not be revoked." });
  }
});

export default router;
