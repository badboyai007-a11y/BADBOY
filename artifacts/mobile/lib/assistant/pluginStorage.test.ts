import assert from "node:assert/strict";
import { mock, test } from "node:test";

let stored: string | null = null;
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async () => stored,
    setItem: async (_key: string, value: string) => { stored = value; },
  },
});

const storagePromise = import("./pluginStorage");

test("defaults to safe read-only plugins and persists owner toggles", async () => {
  const storage = await storagePromise;
  stored = null;
  const defaults = await storage.loadEnabledPluginIds();
  assert.ok(defaults.includes("web-research"));
  const next = await storage.setAgentPluginEnabled("slack-history", false);
  assert.equal(next.includes("slack-history"), false);
  assert.equal((await storage.loadEnabledPluginIds()).includes("slack-history"), false);
  await storage.setAgentPluginEnabled("slack-history", true);
  assert.equal((await storage.loadEnabledPluginIds()).includes("slack-history"), true);
});

test("rejects corrupt or unknown persisted plugin IDs", async () => {
  const storage = await storagePromise;
  stored = "{broken";
  await assert.rejects(storage.loadEnabledPluginIds(), SyntaxError);
  stored = JSON.stringify(["run-shell"]);
  await assert.rejects(storage.loadEnabledPluginIds(), /invalid/);
});
