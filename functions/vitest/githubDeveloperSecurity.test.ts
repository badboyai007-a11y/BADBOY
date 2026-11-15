import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

let security: typeof import("../../artifacts/api-server/src/services/githubDeveloperSecurity");
let integration: typeof import("../../artifacts/api-server/src/services/githubIntegration");

beforeAll(async () => {
  security = await import("../../artifacts/api-server/src/services/githubDeveloperSecurity");
  integration = await import("../../artifacts/api-server/src/services/githubIntegration");
});

const env = {
  GITHUB_SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
  GITHUB_OWNER_IDS: "12345,67890",
};

describe("GitHub owner identity security", () => {
  it("allows only explicitly allowlisted numeric GitHub account IDs", () => {
    expect(security.isGitHubOwnerAllowed(12345, env)).toBe(true);
    expect(security.isGitHubOwnerAllowed(67890, env)).toBe(true);
    expect(security.isGitHubOwnerAllowed(99999, env)).toBe(false);
    expect(security.isGitHubOwnerAllowed(Number.NaN, env)).toBe(false);
  });

  it("accepts a matching signed OAuth state and rejects mismatches", () => {
    const state = security.createOAuthState(env);
    expect(security.verifyOAuthState(state, state, env)).toBe(true);
    expect(security.verifyOAuthState(`${state}x`, state, env)).toBe(false);
    expect(security.verifyOAuthState(state, undefined, env)).toBe(false);
  });

  it("checks repository pull and push permissions separately", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ permissions: { pull: true, push: false } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const verifier = new security.GitHubOwnerRepositoryAccessVerifier("owner-token", fetchImpl);
    const repository = { fullName: "owner/private-repo" };
    expect(await verifier.hasAccess({ repository, access: "read" })).toBe(true);
    expect(await verifier.hasAccess({ repository, access: "write" })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/private-repo",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer owner-token" }),
      }),
    );
  });
});

describe("GitHub write approval guardrails", () => {
  const repository = { fullName: "owner/repo" };
  const accessVerifier = { hasAccess: vi.fn(async () => true) };
  const approvalVerifier = { consume: vi.fn(async () => true) };
  const baseSha = "a".repeat(40);

  it("accepts arbitrary valid branch prefixes when a matching approval is consumed", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ ref: "refs/heads/feature/my-change" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    await integration.createRepositoryBranch(
      repository,
      "feature/my-change",
      baseSha,
      { approvalId: "approval-1" },
      approvalVerifier,
      accessVerifier,
      { token: "owner-token", fetchImpl },
    );
    expect(approvalVerifier.consume).toHaveBeenCalledWith(expect.objectContaining({
      action: "create-branch",
      resource: "owner/repo:feature/my-change",
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe branch before any GitHub write", async () => {
    const fetchImpl = vi.fn();
    await expect(integration.createRepositoryBranch(
      repository,
      "../main",
      baseSha,
      { approvalId: "approval-2" },
      approvalVerifier,
      accessVerifier,
      { token: "owner-token", fetchImpl },
    )).rejects.toMatchObject({ code: "INVALID_GIT_REF" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates draft pull requests only", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ draft: true, base: "main" });
      return new Response(JSON.stringify({ number: 42, draft: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await integration.createDraftPullRequest(
      repository,
      {
        head: "feature/secure-work",
        base: "main",
        title: "Secure owner-scoped changes",
        body: "Draft only",
        approval: { approvalId: "approval-3" },
      },
      approvalVerifier,
      accessVerifier,
      { token: "owner-token", fetchImpl },
    );
    expect(result).toMatchObject({ number: 42, draft: true });
  });

  it("fails closed when the owner does not have write permission", async () => {
    const denied = { hasAccess: vi.fn(async () => false) };
    const fetchImpl = vi.fn();
    await expect(integration.createRepositoryBranch(
      repository,
      "feature/no-access",
      baseSha,
      { approvalId: "approval-4" },
      approvalVerifier,
      denied,
      { token: "owner-token", fetchImpl },
    )).rejects.toMatchObject({ code: "REPOSITORY_ACCESS_DENIED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe("Owner permission SQL guard", () => {
  it("uses literal prefix matching rather than SQL LIKE wildcards", () => {
    const migration = readFileSync(
      new URL("../../lib/db/migrations/0002_github_developer_permissions.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      "starts_with(branch_ref, left(p.branch_pattern, length(p.branch_pattern) - 1))",
    );
    expect(migration).not.toMatch(/branch_ref\s+LIKE/i);
  });

  it("preserves workflow refs containing an at-sign after the workflow separator", () => {
    const migration = readFileSync(
      new URL("../../lib/db/migrations/0002_github_developer_permissions.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(
      "substring(branch_ref from position('@' in branch_ref) + 1)",
    );
  });
});
