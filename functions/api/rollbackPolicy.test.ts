import assert from "node:assert/strict";
import test from "node:test";
import { createRollbackPlan, isRollbackApprovalBound } from "./rollbackPolicy.ts";

const candidate = {
  repository: "owner/repo",
  branch: "release/stable",
  expectedHeadSha: "a".repeat(40),
  knownGoodSha: "b".repeat(40),
  reason: "Deployment health checks failed",
};

test("creates a non-force-push rollback proposal bound to exact commits and branch", () => {
  const plan = createRollbackPlan(candidate);
  assert.equal(plan.strategy, "revert-commit-and-open-draft-pr");
  assert.equal(plan.forcePush, false);
  assert.equal(plan.requiresFreshOwnerApproval, true);
  assert.match(plan.approvalBinding, /release\/stable/);
});

test("rejects invalid refs, identical commits and malformed SHAs", () => {
  assert.throws(() => createRollbackPlan({ ...candidate, branch: "../main" }), /ROLLBACK_CANDIDATE_INVALID/);
  assert.throws(() => createRollbackPlan({ ...candidate, knownGoodSha: candidate.expectedHeadSha }), /ROLLBACK_CANDIDATE_INVALID/);
  assert.throws(() => createRollbackPlan({ ...candidate, expectedHeadSha: "bad" }), /ROLLBACK_CANDIDATE_INVALID/);
});

test("requires a fresh approval from the authenticated owner bound to this exact rollback", () => {
  const plan = createRollbackPlan(candidate);
  const approval = { ownerId: 7, approvalId: "approval-identifier-123", binding: plan.approvalBinding, expiresAt: 110_000 };
  assert.equal(isRollbackApprovalBound(plan, approval, { authenticatedOwnerId: 7, now: 100_000 }), true);
  assert.equal(isRollbackApprovalBound(plan, approval, { authenticatedOwnerId: 8, now: 100_000 }), false);
  assert.equal(isRollbackApprovalBound(plan, { ...approval, binding: "other" }, { authenticatedOwnerId: 7, now: 100_000 }), false);
  assert.equal(isRollbackApprovalBound(plan, { ...approval, expiresAt: 99_999 }, { authenticatedOwnerId: 7, now: 100_000 }), false);
});
