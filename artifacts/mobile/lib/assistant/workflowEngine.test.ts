import assert from "node:assert/strict";
import test from "node:test";
import { executePersonalWorkflow, type WorkflowAdapters } from "./workflowEngine";

const adapters: WorkflowAdapters = {
  "assistant.ask": async (input) => ({ answer: input.prompt }),
  "research.search": async (input) => ({ sources: [input.query] }),
  "reminder.create": async (input) => ({ scheduled: input.title }),
  "telegram.send": async (input) => ({ sent: input.text }),
};

const definition = {
  id: "morning-brief",
  name: "Morning brief",
  enabled: true,
  trigger: "manual",
  steps: [
    { id: "ask", action: "assistant.ask", input: { prompt: "summarize my day" } },
    { id: "research", action: "research.search", input: { query: "weather" } },
  ],
};

test("executes validated read-only workflow steps in order", async () => {
  const order: string[] = [];
  const result = await executePersonalWorkflow(definition, {
    ...adapters,
    "assistant.ask": async () => { order.push("ask"); return { answer: "brief" }; },
    "research.search": async () => { order.push("research"); return { sources: [] }; },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["ask", "research"]);
  assert.deepEqual(result.status === "completed" ? result.results.map((item) => item.stepId) : [], ["ask", "research"]);
});

test("requires approval bound to each side-effecting step", async () => {
  let sends = 0;
  const workflow = {
    ...definition,
    steps: [{ id: "send", action: "telegram.send", input: { text: "hello" } }],
  };
  const blocked = await executePersonalWorkflow(workflow, {
    ...adapters,
    "telegram.send": async () => { sends += 1; return { sent: true }; },
  });
  assert.equal(blocked.status, "approval_required");
  assert.equal(sends, 0);
  const approved = await executePersonalWorkflow(workflow, adapters, { approvedStepIds: ["send"] });
  assert.equal(approved.status, "completed");
});

test("stops after a failed step and never runs later actions", async () => {
  let laterRan = false;
  const result = await executePersonalWorkflow(definition, {
    ...adapters,
    "assistant.ask": async () => { throw new Error("provider offline"); },
    "research.search": async () => { laterRan = true; return {}; },
  });
  assert.equal(result.status, "failed");
  assert.equal(laterRan, false);
  assert.deepEqual(result.completedSteps, []);
});

test("rejects oversized or non-serializable adapter output", async () => {
  const result = await executePersonalWorkflow(definition, {
    ...adapters,
    "assistant.ask": async () => ({ text: "x".repeat(20_000) }),
  });
  assert.equal(result.status, "failed");
  assert.match(result.status === "failed" ? result.error : "", /16 KiB/);
});

test("enforces a timeout and aborts the active adapter", async () => {
  let aborted = false;
  const result = await executePersonalWorkflow(definition, {
    ...adapters,
    "assistant.ask": async (_input, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }),
  }, { timeoutMs: 2 });
  assert.equal(result.status, "failed");
  assert.match(result.status === "failed" ? result.error : "", /timed out/);
  assert.equal(aborted, true);
});
