import { isValidGitBranchName } from "./autonomousDeveloper.ts";

export interface RollbackCandidate {
  repository: string;
  branch: string;
  expectedHeadSha: string;
  knownGoodSha: string;
  reason: string;
}

export interface RollbackPlan extends RollbackCandidate {
  strategy: "revert-commit-and-open-draft-pr";
  forcePush: false;
  requiresFreshOwnerApproval: true;
  approvalBinding: string;
}

/** A rollback is a reviewed revert proposal, never a force-reset of shared history. */
export function createRollbackPlan(candidate: RollbackCandidate): RollbackPlan {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u.test(candidate.repository) ||
      !isValidGitBranchName(candidate.branch) ||
      !/^[a-f0-9]{40}$/iu.test(candidate.expectedHeadSha) ||
      !/^[a-f0-9]{40}$/iu.test(candidate.knownGoodSha) ||
      candidate.expectedHeadSha.toLowerCase() === candidate.knownGoodSha.toLowerCase() ||
      !candidate.reason.trim() || candidate.reason.length > 1000) {
    throw new Error("ROLLBACK_CANDIDATE_INVALID");
  }
  const approvalBinding = [
    candidate.repository,
    candidate.branch,
    candidate.expectedHeadSha.toLowerCase(),
    candidate.knownGoodSha.toLowerCase(),
  ].join(":");
  return {
    ...candidate,
    expectedHeadSha: candidate.expectedHeadSha.toLowerCase(),
    knownGoodSha: candidate.knownGoodSha.toLowerCase(),
    strategy: "revert-commit-and-open-draft-pr",
    forcePush: false,
    requiresFreshOwnerApproval: true,
    approvalBinding,
  };
}

/** Approval must be minted by the existing authenticated Owner approval service.
 * This function validates binding only; it does not issue or consume approvals.
 */
export function isRollbackApprovalBound(
  plan: RollbackPlan,
  approval: { ownerId: number; approvalId: string; binding: string; expiresAt: number },
  input: { authenticatedOwnerId: number; now?: number },
): boolean {
  const now = input.now ?? Date.now();
  return Number.isSafeInteger(approval.ownerId) &&
    approval.ownerId === input.authenticatedOwnerId &&
    approval.ownerId > 0 &&
    typeof approval.approvalId === "string" && approval.approvalId.length >= 16 &&
    approval.binding === plan.approvalBinding &&
    Number.isFinite(approval.expiresAt) &&
    approval.expiresAt > now &&
    approval.expiresAt <= now + 120_000;
}
