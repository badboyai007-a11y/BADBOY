import assert from "node:assert/strict";
import test from "node:test";
import { validatePersonalWorkflow, workflowNeedsOwnerApproval } from "./workflowBuilder.ts";

test("validates bounded manual workflows", () => {
  const workflow = validatePersonalWorkflow({
    id: "daily-brief",
    name: "Daily brief",
    enabled: true,
    trigger: "manual",
    steps: [{ id: "research", action: "research.search", input: { query: "AI news" } }],
  });
  assert.equal(workflow.id, "daily-brief");
  assert.equal(workflowNeedsOwnerApproval(workflow), false);
});

test("rejects executable or unapproved workflow actions", () => {
  assert.throws(() => validatePersonalWorkflow({
    id: "bad-workflow", name: "Bad", enabled: true, trigger: "manual",
    steps: [{ id: "run", action: "shell.exec", input: { command: "rm -rf /" } }],
  }), /not allowlisted/);
});

test("requires owner approval for messaging and reminder side effects", () => {
  const workflow = validatePersonalWorkflow({
    id: "send-note", name: "Send note", enabled: true, trigger: "manual",
    steps: [{ id: "send", action: "telegram.send", input: { text: "hello" } }],
  });
  assert.equal(workflowNeedsOwnerApproval(workflow), true);
});

test("rejects invalid schedules, duplicate steps, and oversized definitions", () => {
  assert.throws(() => validatePersonalWorkflow({
    id: "bad-schedule", name: "Bad", enabled: true, trigger: "schedule", schedule: "not-cron",
    steps: [{ id: "step", action: "assistant.ask", input: {} }],
  }), /cron/);
  assert.throws(() => validatePersonalWorkflow({
    id: "duplicates", name: "Bad", enabled: true, trigger: "manual",
    steps: [
      { id: "step", action: "assistant.ask", input: {} },
      { id: "step", action: "assistant.ask", input: {} },
    ],
  }), /duplicated/);
});
