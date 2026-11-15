import assert from "node:assert/strict";
import test from "node:test";
import { isValidGitBranchName, runAutonomousDeveloper, type AgentAdapter, type AutonomousAgentRole } from "./autonomousDeveloper.ts";

const roles: AutonomousAgentRole[] = ["architect", "developer", "tester", "security_reviewer"];
const context = {
  taskId: "task-1", prompt: "Implement a safe feature", repository: "owner/repo",
  branch: "feature/my-change", budget: { maxAgentCalls: 4, maxOutputCharacters: 12_000 },
};

function adapters(verdict: "pass" | "fail" | "blocked" = "pass"): Record<AutonomousAgentRole, AgentAdapter> {
  const adapter: AgentAdapter = {
    async run({ role: currentRole }) {
      return { summary: currentRole, verdict, findings: [], testEvidence: ["unit-test"] };
    },
  };
  return {
    architect: adapter,
    developer: adapter,
    tester: adapter,
    security_reviewer: adapter,
  };
}

test("accepts any valid branch without requiring a badboy prefix", () => {
  assert.equal(isValidGitBranchName("feature/my-change"), true);
  assert.equal(isValidGitBranchName("release/2026.11"), true);
  assert.equal(isValidGitBranchName("badboy/fix-login"), true);
});

test("rejects unsafe Git refs", () => {
  for (const branch of ["", "../main", "feature//x", "/main", "main.lock", "bad branch", "feature~1"]) {
    assert.equal(isValidGitBranchName(branch), false, branch);
  }
});

test("runs all four roles in order and never writes", async () => {
  const result = await runAutonomousDeveloper({ context, adapters: adapters() });
  assert.equal(result.state, "ready_for_owner_review");
  assert.deepEqual(result.completedRoles, roles);
  assert.equal(result.writesPerformed, false);
  assert.equal(result.nextAction, "owner_review_and_exact_write_approval");
});

test("stops when a required agent fails", async () => {
  const calls: string[] = [];
  const configured = adapters();
  for (const role of roles) {
    configured[role] = {
      async run() {
        calls.push(role);
        return { summary: role, verdict: role === "tester" ? "fail" : "pass", findings: [] };
      },
    };
  }
  const result = await runAutonomousDeveloper({ context, adapters: configured });
  assert.equal(result.state, "failed");
  assert.deepEqual(calls, ["architect", "developer", "tester"]);
  assert.equal(result.writesPerformed, false);
});

test("rejects insufficient or malformed execution budgets", async () => {
  await assert.rejects(runAutonomousDeveloper({
    context: { ...context, budget: { maxAgentCalls: 3, maxOutputCharacters: 12_000 } }, adapters: adapters(),
  }), /AUTONOMOUS_TASK_INVALID/);
  await assert.rejects(runAutonomousDeveloper({
    context: { ...context, budget: { maxAgentCalls: 4, maxOutputCharacters: Number.NaN } }, adapters: adapters(),
  }), /AUTONOMOUS_TASK_INVALID/);
});
