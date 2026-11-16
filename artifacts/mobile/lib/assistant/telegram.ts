import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';

const TOKEN_KEY = 'oi-assistant-telegram-token';
const CHAT_ID_KEY = 'oi-assistant-telegram-chat-id';
const OWNER_CHAT_ID_KEY = 'oi-assistant-telegram-owner-chat-id';
const UPDATE_OFFSET_KEY = 'oi-assistant-telegram-offset';

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number; type?: string; first_name?: string; username?: string };
  };
}

async function telegramCall<T>(token: string, method: string, body?: object) {
  const response = await expoFetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = (await response.json().catch(() => null)) as
    | TelegramEnvelope<T>
    | null;
  if (!response.ok || !data?.ok || data.result === undefined) {
    throw new Error('Telegram could not complete this request. Check the bot connection and try again.');
  }
  return data.result;
}

export async function connectTelegramBot(token: string) {
  const bot = await telegramCall<{ id: number; username: string }>(token, 'getMe');
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return bot;
}

export async function hasTelegramBot() {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}

export async function getTelegramOwnerChatId(): Promise<number | null> {
  const value = await SecureStore.getItemAsync(OWNER_CHAT_ID_KEY);
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function bindTelegramOwnerChat(chatId: number): Promise<void> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0) throw new Error('Telegram private chat ID invalid.');
  await Promise.all([
    SecureStore.setItemAsync(OWNER_CHAT_ID_KEY, String(chatId)),
    SecureStore.setItemAsync(CHAT_ID_KEY, String(chatId)),
  ]);
}

export type TelegramOwnerCommand =
  | { kind: 'ask'; prompt: string }
  | { kind: 'youtube_search'; query: string };

/** Only explicitly prefixed, low-risk commands can be approved from Telegram. */
export function parseTelegramOwnerCommand(text: string): TelegramOwnerCommand | null {
  const match = /^\/badboy\s+(ask|youtube)\s+([\s\S]{1,1000})$/i.exec(text.trim());
  if (!match) return null;
  const value = match[2].trim();
  if (!value) return null;
  return match[1].toLowerCase() === 'ask'
    ? { kind: 'ask', prompt: value }
    : { kind: 'youtube_search', query: value };
}

export async function disconnectTelegramBot() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(CHAT_ID_KEY),
    SecureStore.deleteItemAsync(OWNER_CHAT_ID_KEY),
    SecureStore.deleteItemAsync(UPDATE_OFFSET_KEY),
  ]);
}

export async function checkTelegramMessages() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) throw new Error('Connect your bot first.');
  const rawOffset = (await SecureStore.getItemAsync(UPDATE_OFFSET_KEY)) ?? '0';
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) {
    throw new Error('Telegram update cursor is invalid. Disconnect and reconnect the bot to reset it.');
  }
  const offset = Number(rawOffset);
  const ownerChatId = await getTelegramOwnerChatId();
  const updates = await telegramCall<TelegramUpdate[]>(token, 'getUpdates', {
    offset,
    timeout: 0,
    allowed_updates: ['message'],
  });
  const messages = updates.flatMap((update) => {
    const message = update.message;
    // Only private chats can become an owner-approved command channel. Once
    // bound, discard every other private chat before exposing messages to UI.
    if (!message || message.chat.type !== 'private') return [];
    if (ownerChatId !== null && message.chat.id !== ownerChatId) return [];
    return [{
      id: update.update_id,
      chatId: message.chat.id,
      sender: message.chat.first_name || message.chat.username || 'Telegram user',
      text: message.text || '(non-text message)',
      date: message.date,
    }];
  });
  if (updates.length) {
    await SecureStore.setItemAsync(
      UPDATE_OFFSET_KEY,
      String(updates[updates.length - 1].update_id + 1),
    );
  }
  return messages;
}

export async function sendTelegramMessage(text: string) {
  const [token, chatId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(OWNER_CHAT_ID_KEY),
  ]);
  if (!token) throw new Error('Connect your bot first.');
  if (!chatId) throw new Error('Bind your owner chat before sending Telegram messages.');
  await telegramCall(token, 'sendMessage', { chat_id: chatId, text });
}
