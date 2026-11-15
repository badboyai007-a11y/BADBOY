import { validatePersonalWorkflow, workflowNeedsOwnerApproval, type PersonalWorkflow, type WorkflowAction, type WorkflowStep } from "./workflowBuilder";

export interface WorkflowStepContext {
  workflowId: string;
  stepId: string;
  signal: AbortSignal;
}
export interface WorkflowAdapters {
  "assistant.ask": (input: Record<string, string>, context: WorkflowStepContext) => Promise<unknown>;
  "research.search": (input: Record<string, string>, context: WorkflowStepContext) => Promise<unknown>;
  "reminder.create": (input: Record<string, string>, context: WorkflowStepContext) => Promise<unknown>;
  "telegram.send": (input: Record<string, string>, context: WorkflowStepContext) => Promise<unknown>;
}
export interface WorkflowRunOptions {
  /** Explicitly approved step ids from the owner's confirmation UI. */
  approvedStepIds?: string[];
  timeoutMs?: number;
}
export type WorkflowRunResult =
  | { status: "completed"; workflowId: string; results: Array<{ stepId: string; action: WorkflowAction; output: unknown }> }
  | { status: "disabled" | "approval_required" | "failed"; workflowId: string; stepId?: string; error: string; completedSteps: string[] };

const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024;

function jsonByteLength(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") throw new Error("Workflow step output must be JSON-serializable.");
  return new TextEncoder().encode(encoded).byteLength;
}

async function runStep(
  step: WorkflowStep,
  workflowId: string,
  adapter: WorkflowAdapters[WorkflowAction],
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(new Error("Workflow step timed out."));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => adapter({ ...step.input }, {
        workflowId,
        stepId: step.id,
        signal: controller.signal,
      })),
      deadline,
    ]);
    if (jsonByteLength(result) > MAX_OUTPUT_BYTES) throw new Error("Workflow step output exceeds 16 KiB.");
    return JSON.parse(JSON.stringify(result)) as unknown;
  } catch (error) {
    if (expired) throw new Error("Workflow step timed out.");
    throw error instanceof Error ? error : new Error("Workflow step failed.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Execute only validated adapter actions; no user-supplied code is evaluated. */
export async function executePersonalWorkflow(
  definition: unknown,
  adapters: WorkflowAdapters,
  options: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  let workflow: PersonalWorkflow;
  try {
    workflow = validatePersonalWorkflow(definition);
  } catch (error) {
    return { status: "failed", workflowId: "invalid", error: error instanceof Error ? error.message : "Invalid workflow.", completedSteps: [] };
  }
  if (!workflow.enabled) return { status: "disabled", workflowId: workflow.id, error: "Workflow is disabled.", completedSteps: [] };
  if (workflow.trigger === "schedule") {
    return { status: "failed", workflowId: workflow.id, error: "Scheduled execution is not enabled in this runtime; run this workflow manually.", completedSteps: [] };
  }
  const approved = new Set(options.approvedStepIds ?? []);
  const completedSteps: string[] = [];
  const results: Array<{ stepId: string; action: WorkflowAction; output: unknown }> = [];
  const timeoutMs = Math.max(1, Math.min(
    Number.isFinite(options.timeoutMs) ? Math.trunc(options.timeoutMs ?? 10_000) : 10_000,
    MAX_TIMEOUT_MS,
  ));

  for (const step of workflow.steps) {
    if ((step.action === "reminder.create" || step.action === "telegram.send") && !approved.has(step.id)) {
      return {
        status: "approval_required",
        workflowId: workflow.id,
        stepId: step.id,
        error: "Owner approval is required for this side-effecting workflow step.",
        completedSteps,
      };
    }
    try {
      const output = await runStep(step, workflow.id, adapters[step.action], timeoutMs);
      results.push({ stepId: step.id, action: step.action, output });
      completedSteps.push(step.id);
    } catch (error) {
      return {
        status: "failed",
        workflowId: workflow.id,
        stepId: step.id,
        error: error instanceof Error ? error.message.slice(0, 300) : "Workflow step failed.",
        completedSteps,
      };
    }
  }
  return { status: "completed", workflowId: workflow.id, results };
}
