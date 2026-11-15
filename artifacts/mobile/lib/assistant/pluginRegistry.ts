/**
 * Safe, runtime-neutral custom plugin registry.
 *
 * Plugins are adapters supplied by trusted application code. This registry never
 * evaluates downloaded code, loads arbitrary modules, or grants network/shell access.
 * Side-effecting capabilities require an explicit owner approval per invocation.
 */

export const PLUGIN_CAPABILITIES = [
  'web.read',
  'memory.read',
  'calendar.read',
  'calendar.write',
  'messaging.read',
  'messaging.send',
  'device.open_app',
] as const;

export type PluginCapability = typeof PLUGIN_CAPABILITIES[number];
export type PluginRisk = 'read_only' | 'side_effect';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
  risk: PluginRisk;
}

export interface PluginInvocationContext {
  ownerId: string;
  approved: boolean;
  requestId: string;
}

export interface PluginAdapter {
  execute(input: Record<string, unknown>, context: PluginInvocationContext): Promise<unknown>;
}

export interface PluginRecord {
  manifest: PluginManifest;
  enabled: boolean;
}

export type PluginResult =
  | { ok: true; pluginId: string; output: unknown }
  | { ok: false; pluginId: string; code: 'NOT_FOUND' | 'DISABLED' | 'CAPABILITY_DENIED' | 'OWNER_APPROVAL_REQUIRED' | 'INVALID_INPUT' | 'TIMEOUT' | 'EXECUTION_FAILED'; error: string };

const ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const MAX_INPUT_BYTES = 8 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function byteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validatePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plugin manifest must be an object.');
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) throw new Error('Plugin id is invalid.');
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('Plugin name is invalid.');
  if (typeof item.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(item.version)) throw new Error('Plugin version must use semantic x.y.z format.');
  if (typeof item.description !== 'string' || !item.description.trim() || item.description.length > 500) throw new Error('Plugin description is invalid.');
  if (!Array.isArray(item.capabilities) || item.capabilities.length < 1 || item.capabilities.length > 8) {
    throw new Error('Plugin must declare between one and eight capabilities.');
  }
  const capabilities = item.capabilities;
  if (capabilities.some((entry) => typeof entry !== 'string' || !PLUGIN_CAPABILITIES.includes(entry as PluginCapability))) {
    throw new Error('Plugin declares an unsupported capability.');
  }
  if (new Set(capabilities).size !== capabilities.length) throw new Error('Plugin capabilities must be unique.');
  if (item.risk !== 'read_only' && item.risk !== 'side_effect') throw new Error('Plugin risk classification is invalid.');
  const normalizedCapabilities = capabilities as PluginCapability[];
  const hasWrite = normalizedCapabilities.some((capability) => ['calendar.write', 'messaging.send', 'device.open_app'].includes(capability));
  if (hasWrite && item.risk !== 'side_effect') throw new Error('Write capabilities must be classified as side_effect.');
  return {
    id: item.id,
    name: item.name.trim(),
    version: item.version,
    description: item.description.trim(),
    capabilities: [...normalizedCapabilities],
    risk: item.risk,
  };
}

export class PluginRegistry {
  private readonly records = new Map<string, PluginRecord>();
  private readonly adapters = new Map<string, PluginAdapter>();

  register(manifestInput: unknown, adapter: PluginAdapter): PluginRecord {
    const manifest = validatePluginManifest(manifestInput);
    if (this.records.has(manifest.id)) throw new Error('A plugin with this id is already registered.');
    if (!adapter || typeof adapter.execute !== 'function') throw new Error('Plugin adapter must expose execute().');
    const record = { manifest, enabled: false };
    this.records.set(manifest.id, record);
    this.adapters.set(manifest.id, adapter);
    return { manifest: { ...manifest, capabilities: [...manifest.capabilities] }, enabled: false };
  }

  list(): PluginRecord[] {
    return [...this.records.values()].map((record) => ({
      manifest: { ...record.manifest, capabilities: [...record.manifest.capabilities] },
      enabled: record.enabled,
    }));
  }

  setEnabled(pluginId: string, enabled: boolean): boolean {
    const record = this.records.get(pluginId);
    if (!record) return false;
    record.enabled = enabled;
    return true;
  }

  async invoke(
    pluginId: string,
    capability: PluginCapability,
    input: Record<string, unknown>,
    context: PluginInvocationContext,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<PluginResult> {
    const record = this.records.get(pluginId);
    if (!record) return { ok: false, pluginId, code: 'NOT_FOUND', error: 'Plugin is not registered.' };
    if (!record.enabled) return { ok: false, pluginId, code: 'DISABLED', error: 'Plugin is disabled.' };
    if (!record.manifest.capabilities.includes(capability)) {
      return { ok: false, pluginId, code: 'CAPABILITY_DENIED', error: 'Plugin does not declare this capability.' };
    }
    if (record.manifest.risk === 'side_effect' && context.approved !== true) {
      return { ok: false, pluginId, code: 'OWNER_APPROVAL_REQUIRED', error: 'Owner approval is required for this action.' };
    }
    if (!context.ownerId.trim() || !context.requestId.trim() || !input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, pluginId, code: 'INVALID_INPUT', error: 'Owner, request id, and an input object are required.' };
    }
    let encodedInput: string;
    try { encodedInput = JSON.stringify(input); } catch {
      return { ok: false, pluginId, code: 'INVALID_INPUT', error: 'Plugin input must be JSON-serializable.' };
    }
    if (byteLength(encodedInput) > MAX_INPUT_BYTES) {
      return { ok: false, pluginId, code: 'INVALID_INPUT', error: 'Plugin input exceeds the 8 KiB limit.' };
    }
    const adapter = this.adapters.get(pluginId);
    if (!adapter) return { ok: false, pluginId, code: 'NOT_FOUND', error: 'Plugin adapter is unavailable.' };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        adapter.execute(JSON.parse(encodedInput) as Record<string, unknown>, context),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('PLUGIN_TIMEOUT')), Math.max(1, Math.min(timeoutMs, 30_000)));
        }),
      ]);
      const encodedOutput = JSON.stringify(output);
      if (typeof encodedOutput !== 'string' || byteLength(encodedOutput) > MAX_OUTPUT_BYTES) {
        return { ok: false, pluginId, code: 'EXECUTION_FAILED', error: 'Plugin output is not serializable or exceeds 16 KiB.' };
      }
      return { ok: true, pluginId, output: JSON.parse(encodedOutput) as unknown };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'PLUGIN_TIMEOUT';
      return {
        ok: false,
        pluginId,
        code: timedOut ? 'TIMEOUT' : 'EXECUTION_FAILED',
        error: timedOut ? 'Plugin execution timed out.' : 'Plugin execution failed.',
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
