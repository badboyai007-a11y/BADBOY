import assert from "node:assert/strict";
import test from "node:test";
import { createLocalModelManager, type LocalInferenceRuntime, type LocalModelStorage } from "./localModelRuntime";

const manifest = {
  id: "badboy-small",
  version: "1.0.0",
  url: "https://models.example.com/badboy-small.gguf",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
  format: "gguf" as const,
};

function fixtures(digest = "a".repeat(64)) {
  const calls: string[] = [];
  const storage: LocalModelStorage = {
    async download() { calls.push("download"); return { localPath: "/models/badboy.gguf", sizeBytes: 1024 }; },
    async remove() { calls.push("remove"); },
  };
  const runtime: LocalInferenceRuntime = {
    async load() { calls.push("load"); },
    async generate(prompt, options) { calls.push("generate"); return prompt.slice(0, options.maxTokens); },
    async unload() { calls.push("unload"); },
  };
  const manager = createLocalModelManager({ storage, runtime, digestSha256: async () => digest });
  return { manager, calls };
}

test("does not claim a local model is ready without a native inference runtime", () => {
  const manager = createLocalModelManager({
    storage: { async download() { throw new Error("not used"); }, async remove() {} },
    digestSha256: async () => "a".repeat(64),
  });
  assert.equal(manager.getState().status, "unavailable");
});

test("installs only checksum-verified models and loads them before inference", async () => {
  const { manager, calls } = fixtures();
  await manager.install(manifest);
  assert.equal(manager.getState().status, "installed");
  await manager.load();
  assert.equal(manager.getState().status, "ready");
  assert.equal(await manager.generate("hello", 20), "hello");
  assert.deepEqual(calls, ["download", "load", "generate"]);
});

test("deletes a downloaded model when its checksum does not match", async () => {
  const { manager, calls } = fixtures("b".repeat(64));
  await assert.rejects(manager.install(manifest), /LOCAL_MODEL_CHECKSUM_MISMATCH/);
  assert.deepEqual(calls, ["download", "remove"]);
});

test("bounds model size, prompt length and generated token count", async () => {
  const { manager } = fixtures();
  await assert.rejects(manager.install({ ...manifest, sizeBytes: 2_000_000_000 }), /LOCAL_MODEL_MANIFEST_INVALID/);
  await manager.install(manifest);
  await manager.load();
  await assert.rejects(manager.generate("x".repeat(12_001)), /LOCAL_PROMPT_INVALID/);
});

test("uninstalls local model and unloads runtime", async () => {
  const { manager, calls } = fixtures();
  await manager.install(manifest);
  await manager.load();
  await manager.uninstall();
  assert.equal(manager.getState().status, "not_installed");
  assert.deepEqual(calls, ["download", "load", "unload", "remove"]);
});
