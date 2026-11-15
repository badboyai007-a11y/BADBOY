import { createHash } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const REPOSITORY = "shomratofficial007-spec/Badboy-VS-Versel-Ai";
const BRANCH_PREFIX = "badboy/";
const DEFAULT_BASE_BRANCH = "main";
const ALLOWED_WORKFLOWS = new Set([
  "ci.yml",
  "mobile-checks.yml",
  "ai-sdk-validation.yml",
]);

export type GitHubWriteAction =
  | "create-branch"
  | "create-draft-pr"
  | "dispatch-workflow";

export interface GitHubApproval {
  /** A short-lived, single-use approval identifier issued by the owner-auth layer. */
  approvalId: string;
}

export interface GitHubApprovalVerifier {
  /** Must atomically consume the approval; reject expired, reused, mismatched or unowned approvals. */
  consume(input: {
    approvalId: string;
    action: GitHubWriteAction;
    resource: string;
    requestHash: string;
  }): Promise<boolean>;
}

export interface GitHubRequestOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface DraftPullRequestInput {
  head: string;
  title: string;
  body: string;
  approval: GitHubApproval;
}

export interface WorkflowDispatchInput {
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
  approval: GitHubApproval;
}

export class GitHubIntegrationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GitHubIntegrationError";
  }
}

function getToken(explicitToken?: string): string {
  const token = explicitToken?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new GitHubIntegrationError(
      "GitHub integration is not configured.",
      503,
      "GITHUB_NOT_CONFIGURED",
    );
  }
  return token;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

function assertSafeBranch(branch: string): void {
  if (
    typeof branch !== "string" ||
    !branch.startsWith(BRANCH_PREFIX) ||
    branch.length <= BRANCH_PREFIX.length ||
    branch.length > 240 ||
    branch.includes("..") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("//") ||
    /[~^:?*\\[\]\\s\\\\]/u.test(branch) ||
    branch.split("/").some((part) => part === "" || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new GitHubIntegrationError(
      "Only valid branch names beginning with badboy/ are allowed.",
      400,
      "INVALID_BADBOY_BRANCH",
    );
  }
}

function assertWorkflowAllowed(workflowId: string): void {
  if (!ALLOWED_WORKFLOWS.has(workflowId)) {
    throw new GitHubIntegrationError(
      "This GitHub Actions workflow is not allowlisted.",
      403,
      "WORKFLOW_NOT_ALLOWLISTED",
    );
  }
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function githubRequest<T>(
  path: string,
  init: RequestInit,
  options: GitHubRequestOptions = {},
): Promise<T> {
  const response = await getFetch(options.fetchImpl)(`${GITHUB_API}/repos/${REPOSITORY}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${getToken(options.token)}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502;
    throw new GitHubIntegrationError(
      "GitHub rejected the integration request.",
      status,
      "GITHUB_API_ERROR",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Repository reads are GET-only and never require a write approval. */
export async function readRepositoryFile(
  path: string,
  ref = DEFAULT_BASE_BRANCH,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "." || part === "..") ||
    /(^|\\/)(\.env|.*secret.*|.*credential.*)(\\/|$)/iu.test(path)
  ) {
    throw new GitHubIntegrationError(
      "The requested repository path is not allowed.",
      400,
      "INVALID_REPOSITORY_PATH",
    );
  }
  if (!ref || ref.length > 250 || /[\\r\\n]/u.test(ref)) {
    throw new GitHubIntegrationError("Invalid repository ref.", 400, "INVALID_REPOSITORY_REF");
  }
  return githubRequest(
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    { method: "GET" },
    options,
  );
}

/** Branch creation is a write and consumes its own one-time owner approval. */
export async function createBadboyBranch(
  branch: string,
  baseSha: string,
  approval: GitHubApproval,
  verifier: GitHubApprovalVerifier,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  assertSafeBranch(branch);
  if (!/^[a-f0-9]{40}$/iu.test(baseSha)) {
    throw new GitHubIntegrationError("A full base commit SHA is required.", 400, "INVALID_BASE_SHA");
  }
  const request = { branch, baseSha };
  const approved = await verifier.consume({
    approvalId: approval.approvalId,
    action: "create-branch",
    resource: branch,
    requestHash: canonicalHash(request),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  return githubRequest(
    "/git/refs",
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    },
    options,
  );
}

/** Creates Draft PRs only. There is deliberately no merge/ready-for-review API. */
export async function createDraftPullRequest(
  input: DraftPullRequestInput,
  verifier: GitHubApprovalVerifier,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  assertSafeBranch(input.head);
  if (!input.title.trim() || input.title.length > 256 || input.body.length > 20_000) {
    throw new GitHubIntegrationError("Invalid pull request title or body.", 400, "INVALID_PULL_REQUEST");
  }
  const request = {
    head: input.head,
    base: DEFAULT_BASE_BRANCH,
    title: input.title.trim(),
    body: input.body,
    draft: true,
  };
  const approved = await verifier.consume({
    approvalId: input.approval.approvalId,
    action: "create-draft-pr",
    resource: input.head,
    requestHash: canonicalHash(request),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  return githubRequest(
    "/pulls",
    { method: "POST", body: JSON.stringify(request) },
    options,
  );
}

/** Only explicitly allowlisted workflow files may be dispatched, each with its own approval. */
export async function dispatchAllowlistedWorkflow(
  input: WorkflowDispatchInput,
  verifier: GitHubApprovalVerifier,
  options: GitHubRequestOptions = {},
): Promise<void> {
  assertWorkflowAllowed(input.workflowId);
  assertSafeBranch(input.ref);
  const inputs = input.inputs ?? {};
  if (
    Object.keys(inputs).length > 20 ||
    Object.entries(inputs).some(([key, value]) =>
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(key) ||
      typeof value !== "string" ||
      value.length > 500
    )
  ) {
    throw new GitHubIntegrationError("Workflow inputs are invalid.", 400, "INVALID_WORKFLOW_INPUTS");
  }
  const request = { workflowId: input.workflowId, ref: input.ref, inputs };
  const approved = await verifier.consume({
    approvalId: input.approval.approvalId,
    action: "dispatch-workflow",
    resource: input.workflowId,
    requestHash: canonicalHash(request),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  await githubRequest(
    `/actions/workflows/${encodeURIComponent(input.workflowId)}/dispatches`,
    { method: "POST", body: JSON.stringify({ ref: input.ref, inputs }) },
    options,
  );
}
