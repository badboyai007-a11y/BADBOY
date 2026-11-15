export interface OfflineCapability {
  available: boolean;
  mode: "on_device_model" | "cached_assistance" | "unavailable";
  reason: string;
}

/**
 * Never label deterministic local helpers as an offline LLM. A real bundled
 * model/runtime must be detected by the native layer before this returns ready.
 */
export function resolveOfflineCapability(input: {
  platform: string;
  modelInstalled: boolean;
  runtimeReady: boolean;
}): OfflineCapability {
  if (input.platform !== "android" && input.platform !== "ios") {
    return { available: false, mode: "unavailable", reason: "On-device AI is supported only by a validated native mobile runtime." };
  }
  if (input.modelInstalled && input.runtimeReady) {
    return { available: true, mode: "on_device_model", reason: "A compatible local model and runtime are available." };
  }
  return {
    available: false,
    mode: "cached_assistance",
    reason: "No verified on-device model is bundled. Only saved notes and deterministic offline utilities can work without a network.",
  };
}

/** Derive capability from the LocalModelManager state instead of optimistic UI flags. */
export function resolveOfflineCapabilityFromState(state: {
  status: "unavailable" | "not_installed" | "installed" | "ready";
  reason?: string;
}): OfflineCapability {
  if (state.status === "ready") {
    return { available: true, mode: "on_device_model", reason: "A verified local model is loaded in the native inference runtime." };
  }
  if (state.status === "unavailable") {
    return { available: false, mode: "unavailable", reason: state.reason ?? "A native local inference runtime is unavailable." };
  }
  return { available: false, mode: "cached_assistance", reason: "A local model is not loaded; only cached assistance and deterministic offline utilities are available." };
}
