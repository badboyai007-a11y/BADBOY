import { createHash } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const ALLOWED_WORKFLOWS = new Set([
  "ci.yml",
  "mobile-checks.yml",
  "ai-sdk-validation.yml",
]);

export type GitHubWriteAction =
  | "create-branch"
  | "create-draft-pr"
  | "dispatch-workflow";

export type GitHubRepositoryAccess = "read" | "write";

export interface GitHubRepository {
  /** GitHub repository in owner/name form. */
  fullName: string;
}

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

/**
 * Must be backed by the authenticated GitHub owner/session, not by request-supplied
 * identity. Implementations must fail closed when repository access is unknown.
 */
export interface GitHubRepositoryAccessVerifier {
  hasAccess(input: {
    repository: GitHubRepository;
    access: GitHubRepositoryAccess;
  }): Promise<boolean>;
}

export interface GitHubRequestOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface DraftPullRequestInput {
  head: string;
  base?: string;
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

function parseRepository(repository: GitHubRepository): { owner: string; name: string } {
  const fullName = repository?.fullName;
  if (
    typeof fullName !== "string" ||
    fullName.length > 200 ||
    fullName.split("/").length !== 2
  ) {
    throw new GitHubIntegrationError("A valid owner/name repository is required.", 400, "INVALID_REPOSITORY");
  }

  const [owner, name] = fullName.split("/");
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner) ||
    !/^[A-Za-z0-9._-]{1,100}$/u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new GitHubIntegrationError("A valid owner/name repository is required.", 400, "INVALID_REPOSITORY");
  }

  return { owner, name };
}

async function requireRepositoryAccess(
  repository: GitHubRepository,
  access: GitHubRepositoryAccess,
  verifier: GitHubRepositoryAccessVerifier,
): Promise<{ owner: string; name: string }> {
  const parsed = parseRepository(repository);
  const allowed = await verifier.hasAccess({ repository, access });
  if (!allowed) {
    throw new GitHubIntegrationError(
      "The authenticated owner does not have the required repository permission.",
      403,
      "REPOSITORY_ACCESS_DENIED",
    );
  }
  return parsed;
}

function assertSafeRef(ref: string): void {
  if (
    typeof ref !== "string" ||
    ref.length === 0 ||
    ref.length > 250 ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    Array.from(ref).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f || "~^:?*[]\\".includes(character);
    }) ||
    ref.split("/").some((part) =>
      part === "" || part.startsWith(".") || part.startsWith("-") || part.endsWith(".lock")
    )
  ) {
    throw new GitHubIntegrationError("A valid Git branch or ref is required.", 400, "INVALID_GIT_REF");
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
  owner: string,
  name: string,
  path: string,
  init: RequestInit,
  options: GitHubRequestOptions = {},
): Promise<T> {
  const token = options.token?.trim();
  if (!token) {
    throw new GitHubIntegrationError(
      "An authenticated GitHub owner session is required.",
      503,
      "GITHUB_OWNER_SESSION_REQUIRED",
    );
  }

  const response = await (options.fetchImpl ?? fetch)(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${path}`,
    {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
  );

  if (!response.ok) {
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
    throw new GitHubIntegrationError(
      "GitHub rejected the integration request.",
      status,
      "GITHUB_API_ERROR",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Repository reads are GET-only and require authenticated read access to that repository. */
export async function readRepositoryFile(
  repository: GitHubRepository,
  path: string,
  accessVerifier: GitHubRepositoryAccessVerifier,
  ref?: string,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  const { owner, name } = await requireRepositoryAccess(repository, "read", accessVerifier);
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\u0000") ||
    path.split("/").some((part) => part === "." || part === "..") ||
    /(^|\/)(\.env|[^/]*secret[^/]*|[^/]*credential[^/]*)(\/|$)/iu.test(path)
  ) {
    throw new GitHubIntegrationError(
      "The requested repository path is not allowed.",
      400,
      "INVALID_REPOSITORY_PATH",
    );
  }
  if (ref !== undefined) assertSafeRef(ref);

  const refQuery = ref === undefined ? "" : `?ref=${encodeURIComponent(ref)}`;
  return githubRequest(
    owner,
    name,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}${refQuery}`,
    { method: "GET" },
    options,
  );
}

/** Branch creation is a write and consumes its own one-time owner approval. */
export async function createRepositoryBranch(
  repository: GitHubRepository,
  branch: string,
  baseSha: string,
  approval: GitHubApproval,
  verifier: GitHubApprovalVerifier,
  accessVerifier: GitHubRepositoryAccessVerifier,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  const { owner, name } = await requireRepositoryAccess(repository, "write", accessVerifier);
  assertSafeRef(branch);
  if (!/^[a-f0-9]{40}$/iu.test(baseSha)) {
    throw new GitHubIntegrationError("A full base commit SHA is required.", 400, "INVALID_BASE_SHA");
  }
  const request = { repository: repository.fullName, branch, baseSha };
  const approved = await verifier.consume({
    approvalId: approval.approvalId,
    action: "create-branch",
    resource: `${repository.fullName}:${branch}`,
    requestHash: canonicalHash(request),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  return githubRequest(
    owner,
    name,
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
  repository: GitHubRepository,
  input: DraftPullRequestInput,
  verifier: GitHubApprovalVerifier,
  accessVerifier: GitHubRepositoryAccessVerifier,
  options: GitHubRequestOptions = {},
): Promise<unknown> {
  const { owner, name } = await requireRepositoryAccess(repository, "write", accessVerifier);
  const repositoryMetadata = input.base
    ? undefined
    : await githubRequest<{ default_branch?: string }>(owner, name, "", { method: "GET" }, options);
  const base = input.base ?? repositoryMetadata?.default_branch;
  if (!base) {
    throw new GitHubIntegrationError("The repository default branch could not be determined.", 502, "DEFAULT_BRANCH_UNAVAILABLE");
  }
  assertSafeRef(input.head);
  assertSafeRef(base);
  if (
    !input.title.trim() ||
    input.title.length > 256 ||
    typeof input.body !== "string" ||
    input.body.length > 20_000
  ) {
    throw new GitHubIntegrationError("Invalid pull request title or body.", 400, "INVALID_PULL_REQUEST");
  }
  const request = {
    head: input.head,
    base,
    title: input.title.trim(),
    body: input.body,
    draft: true,
  };
  const approved = await verifier.consume({
    approvalId: input.approval.approvalId,
    action: "create-draft-pr",
    resource: `${repository.fullName}:${input.head}->${base}`,
    requestHash: canonicalHash({ repository: repository.fullName, ...request }),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  return githubRequest(
    owner,
    name,
    "/pulls",
    { method: "POST", body: JSON.stringify(request) },
    options,
  );
}

/** Only explicitly allowlisted workflow files may be dispatched, each with its own approval. */
export async function dispatchAllowlistedWorkflow(
  repository: GitHubRepository,
  input: WorkflowDispatchInput,
  verifier: GitHubApprovalVerifier,
  accessVerifier: GitHubRepositoryAccessVerifier,
  options: GitHubRequestOptions = {},
): Promise<void> {
  const { owner, name } = await requireRepositoryAccess(repository, "write", accessVerifier);
  assertWorkflowAllowed(input.workflowId);
  assertSafeRef(input.ref);
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
  const request = { repository: repository.fullName, workflowId: input.workflowId, ref: input.ref, inputs };
  const approved = await verifier.consume({
    approvalId: input.approval.approvalId,
    action: "dispatch-workflow",
    resource: `${repository.fullName}:${input.workflowId}@${input.ref}`,
    requestHash: canonicalHash(request),
  });
  if (!approved) {
    throw new GitHubIntegrationError("A separate valid approval is required.", 403, "APPROVAL_REQUIRED");
  }
  await githubRequest(
    owner,
    name,
    `/actions/workflows/${encodeURIComponent(input.workflowId)}/dispatches`,
    { method: "POST", body: JSON.stringify({ ref: input.ref, inputs }) },
    options,
  );
}
