import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const secure = new Map<string, string>();
let fetchHandler: (...args: any[]) => Promise<any> = async () => {
  throw new Error('Unexpected Telegram API request');
};
mock.module('expo-secure-store', {
  namedExports: {
    setItemAsync: async (key: string, value: string) => { secure.set(key, value); },
    getItemAsync: async (key: string) => secure.get(key) ?? null,
    deleteItemAsync: async (key: string) => { secure.delete(key); },
  },
});
mock.module('expo/fetch', {
  namedExports: { fetch: (...args: any[]) => fetchHandler(...args) },
});
const telegramPromise = import('./telegram');

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function reset() { secure.clear(); }

test('connectTelegramBot verifies bot identity before saving token', async () => {
  const { connectTelegramBot, hasTelegramBot } = await telegramPromise;
  reset();
  fetchHandler = async (url, init) => {
    assert.equal(String(url), 'https://api.telegram.org/bot123:secret/getMe');
    assert.equal(init.method, 'GET');
    return response({ ok: true, result: { id: 42, username: 'badboy_helper' } });
  };
  assert.deepEqual(await connectTelegramBot('123:secret'), { id: 42, username: 'badboy_helper' });
  assert.equal(secure.get('oi-assistant-telegram-token'), '123:secret');
  assert.equal(await hasTelegramBot(), true);
});

test('connectTelegramBot does not persist invalid bot credentials', async () => {
  const { connectTelegramBot, hasTelegramBot } = await telegramPromise;
  reset();
  fetchHandler = async () => response({ ok: false, description: 'invalid token' }, 401);
  await assert.rejects(connectTelegramBot('bad-token'), /Telegram could not complete/);
  assert.equal(await hasTelegramBot(), false);
});

test('disconnectTelegramBot clears token, chat and update cursor', async () => {
  const { disconnectTelegramBot, hasTelegramBot } = await telegramPromise;
  reset();
  secure.set('oi-assistant-telegram-token', 'token');
  secure.set('oi-assistant-telegram-chat-id', '99');
  secure.set('oi-assistant-telegram-owner-chat-id', '99');
  secure.set('oi-assistant-telegram-offset', '100');
  await disconnectTelegramBot();
  assert.equal(await hasTelegramBot(), false);
  assert.deepEqual([...secure.keys()], []);
});

test('checkTelegramMessages requires a connected bot and maps text and non-text updates', async () => {
  const { checkTelegramMessages } = await telegramPromise;
  reset();
  await assert.rejects(checkTelegramMessages(), /Connect your bot first/);
  secure.set('oi-assistant-telegram-token', 'bot-token');
  fetchHandler = async (url, init) => {
    assert.equal(String(url), 'https://api.telegram.org/botbot-token/getUpdates');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), {
      offset: 0, timeout: 0, allowed_updates: ['message'],
    });
    return response({ ok: true, result: [
      { update_id: 10, message: { message_id: 1, date: 100, text: 'হ্যালো', chat: { id: 77, type: 'private', first_name: 'Bad Boy' } } },
      { update_id: 11, message: { message_id: 2, date: 101, chat: { id: 88, type: 'group', username: 'helper' } } },
      { update_id: 12 },
    ] });
  };
  const messages = await checkTelegramMessages();
  assert.deepEqual(messages, [
    { id: 10, chatId: 77, sender: 'Bad Boy', text: 'হ্যালো', date: 100 },
  ]);
  assert.equal(secure.has('oi-assistant-telegram-chat-id'), false);
  assert.equal(secure.get('oi-assistant-telegram-offset'), '13');
});

test('checkTelegramMessages skips cursor writes when there are no messages and advances an existing offset', async () => {
  const { checkTelegramMessages } = await telegramPromise;
  reset();
  secure.set('oi-assistant-telegram-token', 'bot-token');
  secure.set('oi-assistant-telegram-offset', '20');
  fetchHandler = async (_url, init) => {
    assert.equal(JSON.parse(String(init.body)).offset, 20);
    return response({ ok: true, result: [{ update_id: 20 }, { update_id: 21 }] });
  };
  assert.deepEqual(await checkTelegramMessages(), []);
  assert.equal(secure.has('oi-assistant-telegram-chat-id'), false);
  assert.equal(secure.get('oi-assistant-telegram-offset'), '22');
});


test('checkTelegramMessages exposes only the explicitly bound owner private chat', async () => {
  const { bindTelegramOwnerChat, checkTelegramMessages } = await telegramPromise;
  reset();
  secure.set('oi-assistant-telegram-token', 'bot-token');
  await bindTelegramOwnerChat(12345);
  fetchHandler = async (_url, init) => {
    assert.equal(JSON.parse(String(init.body)).offset, 0);
    return response({ ok: true, result: [
      { update_id: 1, message: { message_id: 1, date: 100, text: '/badboy ask owner', chat: { id: 12345, type: 'private', first_name: 'Owner' } } },
      { update_id: 2, message: { message_id: 2, date: 101, text: '/badboy ask stranger', chat: { id: 67890, type: 'private', first_name: 'Stranger' } } },
      { update_id: 3, message: { message_id: 3, date: 102, text: '/badboy ask group', chat: { id: -100, type: 'supergroup' } } },
    ] });
  };
  assert.deepEqual(await checkTelegramMessages(), [
    { id: 1, chatId: 12345, sender: 'Owner', text: '/badboy ask owner', date: 100 },
  ]);
  assert.equal(secure.get('oi-assistant-telegram-offset'), '4');
});

test('checkTelegramMessages rejects a corrupt update cursor instead of sending NaN to Telegram', async () => {
  const { checkTelegramMessages } = await telegramPromise;
  reset();
  secure.set('oi-assistant-telegram-token', 'bot-token');
  secure.set('oi-assistant-telegram-offset', 'not-a-number');
  fetchHandler = async () => {
    throw new Error('Telegram must not be called with a corrupt cursor');
  };
  await assert.rejects(checkTelegramMessages(), /Telegram update cursor is invalid/);
});

test('sendTelegramMessage validates bot and chat setup before sending', async () => {
  const { sendTelegramMessage } = await telegramPromise;
  reset();
  await assert.rejects(sendTelegramMessage('hello'), /Connect your bot first/);
  secure.set('oi-assistant-telegram-token', 'bot-token');
  await assert.rejects(sendTelegramMessage('hello'), /bind your owner chat/i);
});

test('sendTelegramMessage targets only the explicitly bound owner chat and propagates API failures', async () => {
  const { sendTelegramMessage } = await telegramPromise;
  reset();
  secure.set('oi-assistant-telegram-token', 'bot-token');
  secure.set('oi-assistant-telegram-chat-id', '99999');
  secure.set('oi-assistant-telegram-owner-chat-id', '12345');
  fetchHandler = async (url, init) => {
    assert.equal(String(url), 'https://api.telegram.org/botbot-token/sendMessage');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), { chat_id: '12345', text: 'Badboy online' });
    return response({ ok: true, result: { message_id: 1 } });
  };
  await sendTelegramMessage('Badboy online');
  fetchHandler = async () => response({ ok: false }, 500);
  await assert.rejects(sendTelegramMessage('hello'), /Telegram could not complete/);
});

test('Telegram owner chat must be explicitly bound and only private chat commands are accepted', async () => {
  const { bindTelegramOwnerChat, getTelegramOwnerChatId, parseTelegramOwnerCommand } = await telegramPromise;
  reset();
  assert.equal(await getTelegramOwnerChatId(), null);
  await assert.rejects(bindTelegramOwnerChat(-1), /invalid/);
  await bindTelegramOwnerChat(12345);
  assert.equal(await getTelegramOwnerChatId(), 12345);
  assert.equal(secure.get('oi-assistant-telegram-chat-id'), '12345');
  assert.deepEqual(parseTelegramOwnerCommand('/badboy ask আজকের কাজগুলো সাজিয়ে দাও'), {
    kind: 'ask', prompt: 'আজকের কাজগুলো সাজিয়ে দাও',
  });
  assert.deepEqual(parseTelegramOwnerCommand('/badboy youtube বাংলা গান'), {
    kind: 'youtube_search', query: 'বাংলা গান',
  });
  assert.equal(parseTelegramOwnerCommand('/badboy send email now'), null);
  assert.equal(parseTelegramOwnerCommand('please delete all files'), null);
});

