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
  const disabled = await registry.invoke('sample-reader', 'memory.read', {}, { ownerId: 'owner', approved: true, requestId: 'r1' });
  assert.equal('code' in disabled ? disabled.code : null, 'DISABLED');
  registry.setEnabled('sample-reader', true);
  const denied = await registry.invoke('sample-reader', 'web.read', {}, { ownerId: 'owner', approved: true, requestId: 'r2' });
  assert.equal('code' in denied ? denied.code : null, 'CAPABILITY_DENIED');
  assert.deepEqual(await registry.invoke('sample-reader', 'memory.read', {}, { ownerId: 'owner', approved: false, requestId: 'r3' }), {
    ok: true, pluginId: 'sample-reader', output: { value: 'safe' },
  });
});

test('side-effect plugins require per-invocation owner approval', async () => {
  const registry = new PluginRegistry();
  registry.register(writeManifest, { execute: async (input) => ({ created: input.title }) });
  registry.setEnabled('sample-calendar', true);
  const denied = await registry.invoke('sample-calendar', 'calendar.write', { title: 'Test' }, {
    ownerId: 'owner', approved: false, requestId: 'r1',
  });
  assert.equal('code' in denied ? denied.code : null, 'OWNER_APPROVAL_REQUIRED');
  assert.deepEqual(await registry.invoke('sample-calendar', 'calendar.write', { title: 'Test' }, {
    ownerId: 'owner', approved: true, requestId: 'r2',
  }), { ok: true, pluginId: 'sample-calendar', output: { created: 'Test' } });
});

test('registry rejects oversized input and duplicate registration', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => 'ok' });
  assert.throws(() => registry.register(readManifest, { execute: async () => 'duplicate' }));
  registry.setEnabled('sample-reader', true);
  const result = await registry.invoke('sample-reader', 'memory.read', { value: 'x'.repeat(9000) }, {
    ownerId: 'owner', approved: true, requestId: 'r1',
  });
  assert.equal('code' in result ? result.code : null, 'INVALID_INPUT');
});

test('registry converts adapter exceptions to safe errors and enforces output limits', async () => {
  const registry = new PluginRegistry();
  registry.register(readManifest, { execute: async () => { throw new Error('secret internal detail'); } });
  registry.setEnabled('sample-reader', true);
  const result = await registry.invoke('sample-reader', 'memory.read', {}, {
    ownerId: 'owner', approved: true, requestId: 'r1',
  });
  assert.deepEqual(result, { ok: false, pluginId: 'sample-reader', code: 'EXECUTION_FAILED', error: 'Plugin execution failed.' });
});
