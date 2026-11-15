import assert from "node:assert/strict";
import { mock, test } from "node:test";

let stored: string | null = null;
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async () => stored,
    setItem: async (_key: string, value: string) => { stored = value; },
  },
});

const storagePromise = import("./skillStorage");

const skill = {
  id: "custom-planner",
  name: "Project Planner",
  description: "Break a project into safe steps.",
  instructions: "Plan tasks in small, testable increments.",
  tools: ["calculator", "web_research"],
};

test("creates, reloads, and updates persistent custom skills", async () => {
  const storage = await storagePromise;
  stored = null;
  assert.equal((await storage.saveCustomSkill(skill)).length, 1);
  assert.equal((await storage.loadCustomSkills())[0].name, "Project Planner");
  const updated = await storage.saveCustomSkill({ ...skill, name: "Updated Planner" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, "Updated Planner");
});

test("activates one skill and builds untrusted context without granting new tools", async () => {
  const storage = await storagePromise;
  stored = null;
  await storage.saveCustomSkill(skill);
  await storage.setActiveCustomSkill("custom-planner");
  assert.equal(await storage.getActiveCustomSkillId(), "custom-planner");
  const context = await storage.getActiveCustomSkillContext();
  assert.match(context ?? "", /untrusted task guidance/);
  assert.match(context ?? "", /Allowed tool hints: calculator, web_research/);
  await assert.rejects(storage.setActiveCustomSkill("missing-skill"), /not found/);
});

test("deleting the active skill clears activation and corrupt storage is rejected", async () => {
  const storage = await storagePromise;
  stored = null;
  await storage.saveCustomSkill(skill);
  await storage.setActiveCustomSkill("custom-planner");
  assert.deepEqual(await storage.deleteCustomSkill("custom-planner"), []);
  assert.equal(await storage.getActiveCustomSkillId(), null);
  stored = "{broken";
  await assert.rejects(storage.loadCustomSkills(), SyntaxError);
});

test("custom skill storage rejects invalid manifests", async () => {
  const storage = await storagePromise;
  stored = null;
  await assert.rejects(storage.saveCustomSkill({ ...skill, tools: ["run_shell"] }), /unsupported tool/);
});
