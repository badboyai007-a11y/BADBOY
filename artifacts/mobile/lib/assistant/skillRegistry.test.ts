import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillRegistry, validateSkillDefinition } from './skillRegistry';

const sample = {
  id: 'meeting-prep', name: 'Meeting Prep', description: 'Prepare concise meeting notes.',
  instructions: 'Summarize the agenda and list open questions.', tools: ['count_words'],
};

test('custom skill validates bounded instructions and allowlisted tools', () => {
  const skill = validateSkillDefinition(sample);
  assert.equal(skill.id, 'meeting-prep');
  assert.deepEqual(skill.tools, ['count_words']);
});

test('custom skill rejects invalid ids, arbitrary tools, duplicate tools and oversized instructions', () => {
  for (const value of [
    { ...sample, id: '../unsafe' },
    { ...sample, tools: ['shell.exec'] },
    { ...sample, tools: ['count_words', 'count_words'] },
    { ...sample, instructions: 'x'.repeat(4001) },
  ]) assert.throws(() => validateSkillDefinition(value));
});

test('registry supports create list remove and returns defensive copies', () => {
  const registry = new SkillRegistry();
  const created = registry.register(sample);
  created.tools.push('calculator');
  assert.deepEqual(registry.list()[0].tools, ['count_words']);
  assert.match(registry.buildContext('meeting-prep') ?? '', /untrusted task guidance/);
  assert.equal(registry.remove('meeting-prep'), true);
  assert.equal(registry.buildContext('meeting-prep'), null);
});

test('registry rejects duplicate skill ids', () => {
  const registry = new SkillRegistry();
  registry.register(sample);
  assert.throws(() => registry.register(sample), /already registered/);
});
