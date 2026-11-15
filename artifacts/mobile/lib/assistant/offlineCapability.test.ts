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

import { resolveOfflineCapabilityFromState } from "./offlineCapability.ts";

test("only a loaded local inference runtime is reported as offline AI ready", () => {
  assert.equal(resolveOfflineCapabilityFromState({ status: "ready" }).available, true);
  assert.equal(resolveOfflineCapabilityFromState({ status: "installed" }).available, false);
  assert.equal(resolveOfflineCapabilityFromState({ status: "not_installed" }).available, false);
  assert.equal(resolveOfflineCapabilityFromState({ status: "unavailable" }).mode, "unavailable");
});
