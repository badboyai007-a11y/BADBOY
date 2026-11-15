import { Platform, PermissionsAndroid } from 'react-native';
import { assertValidCalendarDraftInput, assertValidReminderInput } from './deviceControlPolicy';

export type AllowedAppId = 'youtube' | 'chrome' | 'gmail' | 'maps' | 'whatsapp' | 'telegram';
export type DeviceSettingsId = 'wifi' | 'bluetooth' | 'sound' | 'app' | 'notifications';

type NativeDeviceModule = {
  scheduleReminder(id: string, title: string, body: string, atMillis: number): Promise<{ id: string; scheduledAt: number; delivery: 'inexact' }>;
  cancelReminder(id: string): Promise<boolean>;
  openCalendarDraft(title: string, startMillis: number, endMillis: number): Promise<boolean>;
  openAllowedApp(appId: AllowedAppId): Promise<boolean>;
  openDeviceSettings(settingId: DeviceSettingsId): Promise<boolean>;
};

function getNativeDevice(): NativeDeviceModule {
  if (Platform.OS !== 'android') throw new Error('এই Device Control ফিচার Android-এ উপলভ্য।');
  // Lazy import keeps web and Node tests independent of Expo native runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-modules-core').requireNativeModule('BadboyDevice') as NativeDeviceModule;
}

async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const result = await PermissionsAndroid.request(permission, {
    title: 'Badboy Reminder Notifications',
    message: 'আপনার নির্ধারিত reminder দেখাতে notification permission প্রয়োজন।',
    buttonPositive: 'অনুমতি দিন',
    buttonNegative: 'এখন নয়',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Reminder চালাতে notification permission প্রয়োজন।');
  }
}

export async function scheduleLocalReminder(input: { title: string; body?: string; at: Date }): Promise<{ id: string; scheduledAt: number; delivery: 'inexact' }> {
  const title = input.title.trim();
  const body = input.body?.trim() ?? '';
  const atMillis = input.at.getTime();
  assertValidReminderInput(title, body, atMillis, Date.now());
  await requestNotificationPermission();
  const id = `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return getNativeDevice().scheduleReminder(id, title, body, atMillis);
}

export async function cancelLocalReminder(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Reminder ID invalid.');
  return getNativeDevice().cancelReminder(id);
}

export async function openCalendarDraft(input: { title: string; start: Date; end: Date }): Promise<boolean> {
  const title = input.title.trim();
  const start = input.start.getTime();
  const end = input.end.getTime();
  assertValidCalendarDraftInput(title, start, end, Date.now());
  return getNativeDevice().openCalendarDraft(title, start, end);
}

export async function openAllowedApp(appId: AllowedAppId): Promise<boolean> {
  return getNativeDevice().openAllowedApp(appId);
}

export async function openDeviceSettings(settingId: DeviceSettingsId): Promise<boolean> {
  return getNativeDevice().openDeviceSettings(settingId);
}
