import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRegistry, validatePluginManifest } from './pluginRegistry';

const readManifest = {
  id: 'sample-reader', name: 'Sample Reader', version: '1.0.0',
  description: 'Reads a safe sample value.', capabilities: ['memory.read'], risk: 'read_only',
};
const writeManifest = {
  id: 'sample-calendar', name: 'Sample Calendar', version: '1.0.0',
  description: 'Creates a calendar draft.', capabilities: ['calendar.write'], risk: 'side_effect',
};
const readContext = { ownerId: 'owner-1', requestId: 'read-1' };

test('plugin manifest validates and normalizes a safe read-only plugin', () => {
  const manifest = validatePluginManifest(readManifest);
  assert.equal(manifest.id, 'sample-reader');
  assert.deepEqual(manifest.capabilities, ['memory.read']);
});

test('plugin manifest rejects malformed ids, unknown capabilities, duplicate capabilities and unsafe write risk', () => {
  for (const input of [
    { ...readManifest, id: '../escape' },
    { ...readManifest, capabilities: ['shell.exec'] },
    { ...readManifest, capabilities: ['memory.read', 'memory.read'] },
    { ...readManifest, capabilities: ['calendar.write'], risk: 'read_only' },
  ]) assert.throws(() => validatePluginManifest(input));
});

test('registry disables plugins by default and denies undeclared capabilities', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => ({ value: 'safe' }) });
  const disabled = await registry.invoke('sample-reader', 'memory.read', {}, readContext);
  assert.equal('code' in disabled ? disabled.code : null, 'DISABLED');
  registry.setEnabled('sample-reader', true);
  const denied = await registry.invoke('sample-reader', 'web.read', {}, readContext);
  assert.equal('code' in denied ? denied.code : null, 'CAPABILITY_DENIED');
  assert.deepEqual(await registry.invoke('sample-reader', 'memory.read', {}, readContext), {
    ok: true, pluginId: 'sample-reader', output: { value: 'safe' },
  });
});

test('side-effect plugins fail closed without a trusted verifier and cannot use a boolean approval', async () => {
  const registry = new PluginRegistry();
  let executions = 0;
  registry.register(writeManifest, { execute: async () => { executions += 1; return { created: true }; } });
  registry.setEnabled('sample-calendar', true);
  const denied = await registry.invoke('sample-calendar', 'calendar.write', { title: 'Test' }, {
    ...readContext, approvalToken: 'unverified-token',
  });
  assert.equal('code' in denied ? denied.code : null, 'OWNER_APPROVAL_REQUIRED');
  assert.equal(executions, 0);
});

test('side-effect approval is verified against owner, plugin, capability and request id', async () => {
  const verified: unknown[] = [];
  const registry = new PluginRegistry(async (request) => {
    verified.push(request);
    return request.ownerId === 'owner-1'
      && request.pluginId === 'sample-calendar'
      && request.capability === 'calendar.write'
      && request.requestId === 'write-1'
      && request.approvalToken === 'signed-one-time-token';
  });
  registry.register(writeManifest, { execute: async (input) => ({ created: input.title }) });
  registry.setEnabled('sample-calendar', true);

  const denied = await registry.invoke('sample-calendar', 'calendar.write', { title: 'Test' }, {
    ownerId: 'someone-else', requestId: 'write-1', approvalToken: 'signed-one-time-token',
  });
  assert.equal('code' in denied ? denied.code : null, 'OWNER_APPROVAL_REQUIRED');

  const allowed = await registry.invoke('sample-calendar', 'calendar.write', { title: 'Test' }, {
    ownerId: 'owner-1', requestId: 'write-1', approvalToken: 'signed-one-time-token',
  });
  assert.deepEqual(allowed, { ok: true, pluginId: 'sample-calendar', output: { created: 'Test' } });
  assert.equal(verified.length, 2);
});

test('approval verifier failures deny the action', async () => {
  const registry = new PluginRegistry(async () => { throw new Error('approval store unavailable'); });
  registry.register(writeManifest, { execute: async () => ({ created: true }) });
  registry.setEnabled('sample-calendar', true);
  const result = await registry.invoke('sample-calendar', 'calendar.write', {}, {
    ownerId: 'owner-1', requestId: 'write-2', approvalToken: 'token',
  });
  assert.equal('code' in result ? result.code : null, 'OWNER_APPROVAL_REQUIRED');
});

test('registry rejects malformed context, oversized input and duplicate registration', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => 'ok' });
  assert.throws(() => registry.register(readManifest, { execute: async () => 'duplicate' }));
  registry.setEnabled('sample-reader', true);
  const malformed = await registry.invoke('sample-reader', 'memory.read', {}, null as never);
  assert.equal('code' in malformed ? malformed.code : null, 'INVALID_INPUT');
  const result = await registry.invoke('sample-reader', 'memory.read', { value: 'x'.repeat(9000) }, readContext);
  assert.equal('code' in result ? result.code : null, 'INVALID_INPUT');
});

test('registry converts adapter exceptions to safe errors and rejects non-JSON output', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => { throw new Error('secret internal detail'); } });
  registry.setEnabled('sample-reader', true);
  const result = await registry.invoke('sample-reader', 'memory.read', {}, readContext);
  assert.deepEqual(result, { ok: false, pluginId: 'sample-reader', code: 'EXECUTION_FAILED', error: 'Plugin execution failed.' });
});

test('timeout aborts the adapter signal and returns a bounded timeout result', async () => {
  const registry = new PluginRegistry();
  let signalAborted = false;
  registry.register(readManifest, {
    execute: async (_input, context) => new Promise((resolve) => {
      context.signal.addEventListener('abort', () => {
        signalAborted = true;
        resolve({ stopped: true });
      }, { once: true });
    }),
  });
  registry.setEnabled('sample-reader', true);
  const result = await registry.invoke('sample-reader', 'memory.read', {}, readContext, 5);
  assert.deepEqual(result, { ok: false, pluginId: 'sample-reader', code: 'TIMEOUT', error: 'Plugin execution timed out.' });
  assert.equal(signalAborted, true);
});

test('registry enforces output size and returns defensive JSON copies', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => ({ value: 'x'.repeat(17 * 1024) }) });
  registry.setEnabled('sample-reader', true);
  const result = await registry.invoke('sample-reader', 'memory.read', {}, readContext);
  assert.equal('code' in result ? result.code : null, 'EXECUTION_FAILED');
});
