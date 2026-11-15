export type AutonomousAgentRole = "architect" | "developer" | "tester" | "security_reviewer";
export type AgentVerdict = "pass" | "fail" | "blocked";

export interface AgentWorkResult {
  summary: string;
  verdict: AgentVerdict;
  findings: string[];
  proposedChanges?: Array<{ path: string; unifiedDiff: string }>;
  testEvidence?: string[];
}

export interface AgentTaskContext {
  taskId: string;
  prompt: string;
  repository: string;
  branch: string;
  budget: { maxAgentCalls: number; maxOutputCharacters: number };
}

export interface AgentAdapter {
  run(input: {
    role: AutonomousAgentRole;
    context: AgentTaskContext;
    priorResults: Partial<Record<AutonomousAgentRole, AgentWorkResult>>;
    signal?: AbortSignal;
  }): Promise<AgentWorkResult>;
}

export interface AutonomousRunResult {
  taskId: string;
  state: "ready_for_owner_review" | "blocked" | "failed";
  completedRoles: AutonomousAgentRole[];
  results: Partial<Record<AutonomousAgentRole, AgentWorkResult>>;
  totalOutputCharacters: number;
  writesPerformed: false;
  nextAction: "owner_review_and_exact_write_approval" | "revise_task";
}

const ROLE_ORDER: readonly AutonomousAgentRole[] = [
  "architect", "developer", "tester", "security_reviewer",
];

export function isValidGitBranchName(branch: string): boolean {
  if (!branch || branch.length > 250 || branch.startsWith("/") || branch.endsWith("/") ||
      branch.endsWith(".") || branch.includes("..") || branch.includes("//") ||
      branch.includes("@{")) return false;
  if (/[\u0000-\u0020\u007f~^:?*\[\]\\]/u.test(branch)) return false;
  return branch.split("/").every((part) =>
    part.length > 0 && !part.startsWith(".") && !part.startsWith("-") &&
    !part.endsWith(".lock")
  );
}

/** Sequential, bounded multi-agent proposal pipeline. It never writes to GitHub or a workspace. */
export async function runAutonomousDeveloper(input: {
  context: AgentTaskContext;
  adapters: Record<AutonomousAgentRole, AgentAdapter>;
  signal?: AbortSignal;
}): Promise<AutonomousRunResult> {
  const { context, adapters, signal } = input;
  const budget = context.budget;
  if (!context.taskId || context.taskId.length > 128 ||
      !context.prompt.trim() || context.prompt.length > 8000 ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u.test(context.repository) ||
      !isValidGitBranchName(context.branch) ||
      !Number.isSafeInteger(budget.maxAgentCalls) || budget.maxAgentCalls < ROLE_ORDER.length ||
      !Number.isSafeInteger(budget.maxOutputCharacters) || budget.maxOutputCharacters < 1000) {
    throw new Error("AUTONOMOUS_TASK_INVALID");
  }
  const maxOutput = Math.min(48_000, budget.maxOutputCharacters);
  const results: Partial<Record<AutonomousAgentRole, AgentWorkResult>> = {};
  const completedRoles: AutonomousAgentRole[] = [];
  let totalOutputCharacters = 0;

  for (const role of ROLE_ORDER) {
    if (signal?.aborted) {
      return { taskId: context.taskId, state: "blocked", completedRoles, results,
        totalOutputCharacters, writesPerformed: false, nextAction: "revise_task" };
    }
    const result = await adapters[role].run({ role, context, priorResults: results, signal });
    if (!result || typeof result.summary !== "string" ||
        !Array.isArray(result.findings) || result.findings.some((item) => typeof item !== "string") ||
        !["pass", "fail", "blocked"].includes(result.verdict) ||
        (result.proposedChanges !== undefined && (!Array.isArray(result.proposedChanges) ||
          result.proposedChanges.some((change) => !change || typeof change.path !== "string" ||
            typeof change.unifiedDiff !== "string"))) ||
        (result.testEvidence !== undefined && (!Array.isArray(result.testEvidence) ||
          result.testEvidence.some((item) => typeof item !== "string")))) {
      throw new Error("AGENT_RESULT_INVALID");
    }
    const outputSize = result.summary.length + result.findings.join("").length +
      (result.proposedChanges ?? []).reduce((sum, change) => sum + change.path.length + change.unifiedDiff.length, 0) +
      (result.testEvidence ?? []).join("").length;
    totalOutputCharacters += outputSize;
    if (totalOutputCharacters > maxOutput) {
      return { taskId: context.taskId, state: "blocked", completedRoles, results,
        totalOutputCharacters, writesPerformed: false, nextAction: "revise_task" };
    }
    results[role] = result;
    completedRoles.push(role);
    if (result.verdict !== "pass") {
      return { taskId: context.taskId, state: result.verdict === "fail" ? "failed" : "blocked",
        completedRoles, results, totalOutputCharacters, writesPerformed: false, nextAction: "revise_task" };
    }
  }

  return { taskId: context.taskId, state: "ready_for_owner_review", completedRoles, results,
    totalOutputCharacters, writesPerformed: false, nextAction: "owner_review_and_exact_write_approval" };
}
