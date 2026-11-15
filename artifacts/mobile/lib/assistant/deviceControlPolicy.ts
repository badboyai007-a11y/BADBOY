export function assertValidReminderInput(
  title: string,
  body: string,
  atMillis: number,
  now: number,
): void {
  if (!title.trim() || title.trim().length > 80) throw new Error('Reminder title ১–৮০ অক্ষরের হতে হবে।');
  if (body.length > 240) throw new Error('Reminder description সর্বোচ্চ ২৪০ অক্ষর হতে পারবে।');
  if (!Number.isFinite(atMillis) || atMillis <= now + 5_000) throw new Error('Reminder-এর সময় ভবিষ্যতের অন্তত ৫ সেকেন্ড পরে হতে হবে।');
}

export function assertValidCalendarDraftInput(
  title: string,
  startMillis: number,
  endMillis: number,
  now: number,
): void {
  if (!title.trim() || title.trim().length > 120 || !Number.isFinite(startMillis) ||
    !Number.isFinite(endMillis) || startMillis <= now || endMillis <= startMillis ||
    endMillis - startMillis > 86_400_000) {
    throw new Error('Calendar event-এর নাম ও সময় যাচাই করুন (সময় ভবিষ্যতে এবং সর্বোচ্চ ২৪ ঘণ্টা)।');
  }
}
