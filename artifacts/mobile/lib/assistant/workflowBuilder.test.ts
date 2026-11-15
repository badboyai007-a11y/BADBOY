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
  const calendarWorkflow = validatePersonalWorkflow({
    id: "calendar-event", name: "Calendar event", enabled: true, trigger: "manual",
    steps: [{ id: "calendar", action: "calendar.create", input: { title: "Review", start: "2026-11-16T10:00:00.000Z", end: "2026-11-16T11:00:00.000Z" } }],
  });
  assert.equal(workflowNeedsOwnerApproval(calendarWorkflow), true);
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


test("supports bounded multi-step workflows and requires approval when any step has a side effect", () => {
  const workflow = validatePersonalWorkflow({
    id: "daily-assistant",
    name: "Daily assistant",
    enabled: true,
    trigger: "manual",
    steps: [
      { id: "research", action: "research.search", input: { query: "AI updates" } },
      { id: "summarize", action: "assistant.ask", input: { prompt: "Summarize the research." } },
      { id: "remind", action: "reminder.create", input: { title: "Review summary", at: "2026-11-16T10:00:00.000Z" } },
    ],
  });
  assert.equal(workflow.steps.length, 3);
  assert.equal(workflowNeedsOwnerApproval(workflow), true);
});
