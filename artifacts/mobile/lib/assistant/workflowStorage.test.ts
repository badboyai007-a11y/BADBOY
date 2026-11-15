import assert from "node:assert/strict";
import { mock, test } from "node:test";

let stored: string | null = null;
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async () => stored,
    setItem: async (_key: string, value: string) => { stored = value; },
  },
});

const storage = await import("./workflowStorage.ts");

test("stores and reloads validated owner-local workflows", async () => {
  stored = null;
  const workflow = {
    id: "research-one", name: "Research one", enabled: true, trigger: "manual",
    steps: [{ id: "search", action: "research.search", input: { query: "AI" } }],
  };
  const saved = await storage.savePersonalWorkflow(workflow);
  assert.equal(saved.length, 1);
  assert.equal((await storage.loadPersonalWorkflows())[0].name, "Research one");
});

test("updates an existing workflow rather than duplicating it", async () => {
  stored = JSON.stringify([{
    id: "research-one", name: "Old", enabled: true, trigger: "manual",
    steps: [{ id: "search", action: "research.search", input: { query: "AI" } }],
  }]);
  const saved = await storage.savePersonalWorkflow({
    id: "research-one", name: "Updated", enabled: true, trigger: "manual",
    steps: [{ id: "search", action: "research.search", input: { query: "Cloudflare" } }],
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "Updated");
});

test("deletes only the requested workflow and rejects corrupt persisted data", async () => {
  stored = JSON.stringify([
    { id: "research-one", name: "One", enabled: true, trigger: "manual", steps: [{ id: "search", action: "research.search", input: {} }] },
    { id: "research-two", name: "Two", enabled: true, trigger: "manual", steps: [{ id: "search", action: "research.search", input: {} }] },
  ]);
  const next = await storage.deletePersonalWorkflow("research-one");
  assert.deepEqual(next.map((item) => item.id), ["research-two"]);
  stored = "{broken";
  await assert.rejects(storage.loadPersonalWorkflows(), SyntaxError);
});
