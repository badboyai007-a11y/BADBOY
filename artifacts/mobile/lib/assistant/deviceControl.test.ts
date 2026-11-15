import assert from 'node:assert/strict';
import { test } from 'node:test';

function validateReminder(title: string, body: string, atMillis: number, now: number): void {
  if (!title.trim() || title.trim().length > 80) throw new Error('Reminder title ১–৮০ অক্ষরের হতে হবে।');
  if (body.length > 240) throw new Error('Reminder description সর্বোচ্চ ২৪০ অক্ষর হতে পারবে।');
  if (!Number.isFinite(atMillis) || atMillis <= now + 5_000) throw new Error('Reminder-এর সময় ভবিষ্যতের অন্তত ৫ সেকেন্ড পরে হতে হবে।');
}

test('reminder validation accepts future reminders and rejects invalid data', () => {
  const now = 1_000_000;
  assert.doesNotThrow(() => validateReminder('Call home', 'Tell family I arrived', now + 60_000, now));
  assert.throws(() => validateReminder(' ', '', now + 60_000, now));
  assert.throws(() => validateReminder('x'.repeat(81), '', now + 60_000, now));
  assert.throws(() => validateReminder('Call', 'x'.repeat(241), now + 60_000, now));
  assert.throws(() => validateReminder('Call', '', now, now));
  assert.throws(() => validateReminder('Call', '', Number.NaN, now));
});
