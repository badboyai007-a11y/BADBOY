import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValidCalendarDraftInput, assertValidReminderInput } from './deviceControlPolicy';

test('reminder validation accepts future reminders and rejects invalid data', () => {
  const now = 1_000_000;
  assert.doesNotThrow(() => assertValidReminderInput('Call home', 'Tell family I arrived', now + 60_000, now));
  assert.throws(() => assertValidReminderInput(' ', '', now + 60_000, now));
  assert.throws(() => assertValidReminderInput('x'.repeat(81), '', now + 60_000, now));
  assert.throws(() => assertValidReminderInput('Call', 'x'.repeat(241), now + 60_000, now));
  assert.throws(() => assertValidReminderInput('Call', '', now, now));
  assert.throws(() => assertValidReminderInput('Call', '', Number.NaN, now));
});

test('calendar draft validation rejects invalid, past and overlong events', () => {
  const now = 1_000_000;
  assert.doesNotThrow(() => assertValidCalendarDraftInput('Project review', now + 60_000, now + 3_660_000, now));
  assert.throws(() => assertValidCalendarDraftInput('', now + 60_000, now + 3_660_000, now));
  assert.throws(() => assertValidCalendarDraftInput('Meeting', now - 1, now + 60_000, now));
  assert.throws(() => assertValidCalendarDraftInput('Meeting', now + 60_000, now + 90_000_000, now));
});
