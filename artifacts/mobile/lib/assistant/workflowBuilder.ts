/**
 * Declarative personal workflow definitions. No JavaScript, shell, or remote
 * code is accepted. Execution is deliberately separate from validation.
 */
export const WORKFLOW_ACTIONS = [
  "assistant.ask",
  "research.search",
  "reminder.create",
  "telegram.send",
] as const;
export type WorkflowAction = typeof WORKFLOW_ACTIONS[number];
export interface WorkflowStep {
  id: string;
  action: WorkflowAction;
  input: Record<string, string>;
}
export interface PersonalWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "manual" | "schedule";
  schedule?: string;
  steps: WorkflowStep[];
}
const ID = /^[a-z][a-z0-9-]{1,47}$/;
const SCHEDULE = /^(?:\*|[0-5]?\d) (?:\*|[01]?\d|2[0-3]) (?:\*|[1-9]|[12]\d|3[01]) (?:\*|[1-9]|1[0-2]) (?:\*|[0-6])$/;
const MAX_STEPS = 8;

export function validatePersonalWorkflow(value: unknown): PersonalWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workflow must be an object.");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !ID.test(item.id)) throw new Error("Workflow id is invalid.");
  if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80) throw new Error("Workflow name is invalid.");
  if (typeof item.enabled !== "boolean") throw new Error("Workflow enabled must be a boolean.");
  if (item.trigger !== "manual" && item.trigger !== "schedule") throw new Error("Workflow trigger is invalid.");
  if (item.trigger === "schedule" && (typeof item.schedule !== "string" || !SCHEDULE.test(item.schedule))) {
    throw new Error("Scheduled workflows need a valid five-field cron expression.");
  }
  if (item.trigger === "manual" && item.schedule !== undefined) throw new Error("Manual workflows cannot define a schedule.");
  if (!Array.isArray(item.steps) || item.steps.length < 1 || item.steps.length > MAX_STEPS) throw new Error("Workflow must contain 1–8 steps.");
  const seen = new Set<string>();
  const steps = item.steps.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Workflow step must be an object.");
    const step = raw as Record<string, unknown>;
    if (typeof step.id !== "string" || !ID.test(step.id) || seen.has(step.id)) throw new Error("Workflow step id is invalid or duplicated.");
    seen.add(step.id);
    if (typeof step.action !== "string" || !WORKFLOW_ACTIONS.includes(step.action as WorkflowAction)) throw new Error("Workflow action is not allowlisted.");
    if (!step.input || typeof step.input !== "object" || Array.isArray(step.input)) throw new Error("Workflow step input must be an object.");
    const input = step.input as Record<string, unknown>;
    if (Object.keys(input).length > 12 || Object.values(input).some((entry) => typeof entry !== "string" || entry.length > 1000)) {
      throw new Error("Workflow step input must contain at most 12 bounded string fields.");
    }
    return { id: step.id, action: step.action as WorkflowAction, input: { ...input } as Record<string, string> };
  });
  return {
    id: item.id,
    name: item.name.trim(),
    enabled: item.enabled,
    trigger: item.trigger,
    ...(item.trigger === "schedule" ? { schedule: item.schedule as string } : {}),
    steps,
  };
}

export function workflowNeedsOwnerApproval(workflow: PersonalWorkflow): boolean {
  return workflow.steps.some((step) => step.action === "reminder.create" || step.action === "telegram.send");
}
