import assert from "node:assert/strict";
import test from "node:test";
import { resolveOfflineCapability } from "./offlineCapability.ts";

test("does not claim offline LLM availability without a bundled model and runtime", () => {
  const result = resolveOfflineCapability({ platform: "android", modelInstalled: false, runtimeReady: false });
  assert.equal(result.available, false);
  assert.equal(result.mode, "cached_assistance");
});

test("requires a native mobile platform and both model/runtime readiness", () => {
  assert.equal(resolveOfflineCapability({ platform: "web", modelInstalled: true, runtimeReady: true }).available, false);
  assert.equal(resolveOfflineCapability({ platform: "ios", modelInstalled: true, runtimeReady: false }).available, false);
  assert.equal(resolveOfflineCapability({ platform: "android", modelInstalled: true, runtimeReady: true }).available, true);
});
