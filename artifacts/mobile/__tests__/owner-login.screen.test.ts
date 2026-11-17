import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const pressHandlers: Array<() => void> = [];
const signInCalls: string[] = [];
const hookState: unknown[] = [];
let hookIndex = 0;
let rejectSignIn = false;
let holdSignIn = false;
let resolvePendingSignIn: (() => void) | null = null;

mock.module('react', {
  defaultExport: React,
  namedExports: {
    useState: (initial: unknown) => {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = initial;
      return [
        hookState[index],
        (next: unknown) => {
          hookState[index] = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(hookState[index])
            : next;
        },
      ];
    },
  },
});

function renderOwnerLogin(Screen: React.ComponentType) {
  hookIndex = 0;
  return renderToStaticMarkup(React.createElement(Screen));
}

const host = (tag: string) => function Host({ children, accessibilityLabel, placeholder, disabled, onPress }: any) {
  if (tag === 'button' && typeof onPress === 'function') pressHandlers.push(onPress);
  return React.createElement(tag, {
    ...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(typeof disabled === 'boolean' ? { disabled } : {}),
  }, children);
};

mock.module('react-native', {
  namedExports: {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    KeyboardAvoidingView: host('main'),
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default ?? options.ios },
    ScrollView: host('main'),
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Pressable: host('button'),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host('span'),
    TextInput: host('input'),
    View: host('section'),
  },
});
mock.module('@expo/vector-icons', { namedExports: { Feather: () => null } });
mock.module('expo-linear-gradient', { namedExports: { LinearGradient: ({ children }: any) => React.createElement('div', null, children) } });
mock.module('react-native-svg', { namedExports: {
  default: ({ children }: any) => React.createElement('svg', null, children),
  Circle: 'circle', Defs: 'defs', Ellipse: 'ellipse', LinearGradient: 'linearGradient', Path: 'path', Stop: 'stop',
} });
mock.module('react-native-safe-area-context', { namedExports: { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) } });
mock.module('../context/OwnerAuthContext.tsx', {
  namedExports: { useOwnerAuth: () => ({ signIn: async (token: string) => {
    signInCalls.push(token);
    if (holdSignIn) await new Promise<void>((resolve) => { resolvePendingSignIn = resolve; });
    if (rejectSignIn) throw new Error('invalid owner token');
  } }) },
});

const ownerLoginScreenPromise = import('../app/owner-login');

test('Owner Login starts with a disabled secure-token action and explains local data privacy', async () => {
  const { default: OwnerLoginScreen } = await ownerLoginScreenPromise;
  hookState.length = 0;
  const html = renderOwnerLogin(OwnerLoginScreen);
  assert.match(html, /BADBOY/);
  assert.match(html, /Owner Login/);
  assert.match(html, /Paste Owner Token/);
  assert.match(html, /Secure Sign In/);
  assert.match(html, /disabled/);
  assert.match(html, /SecureStore/);
  assert.match(html, /Chat History ও সাধারণ Memory ফোনেই থাকবে/);
  assert.match(html, /Developer Agent-এর Project Memory ও Tasks Owner Token-সুরক্ষিত Cloudflare D1-এ সংরক্ষিত হয়/);
});

test('Owner Login submit handler delegates to owner auth and safely handles rejection', async () => {
  const { default: OwnerLoginScreen } = await ownerLoginScreenPromise;
  pressHandlers.length = 0;
  signInCalls.length = 0;
  rejectSignIn = true;
  hookState.length = 0;
  renderOwnerLogin(OwnerLoginScreen);
  assert.equal(pressHandlers.length, 1);
  await pressHandlers[0]();
  assert.deepEqual(signInCalls, ['']);
  rejectSignIn = false;
});

test('Owner Login submit handler completes after successful owner authentication', async () => {
  const { default: OwnerLoginScreen } = await ownerLoginScreenPromise;
  pressHandlers.length = 0;
  signInCalls.length = 0;
  rejectSignIn = false;
  hookState.length = 0;
  pressHandlers.length = 0;
  renderOwnerLogin(OwnerLoginScreen);
  await pressHandlers[0]();
  assert.deepEqual(signInCalls, ['']);
});

test('Owner Login ignores a second submit while an authentication request is pending', async () => {
  const { default: OwnerLoginScreen } = await ownerLoginScreenPromise;
  hookState.length = 0;
  signInCalls.length = 0;
  rejectSignIn = false;
  holdSignIn = true;
  pressHandlers.length = 0;

  renderOwnerLogin(OwnerLoginScreen);
  const firstSubmit = pressHandlers[0]();
  assert.equal(typeof resolvePendingSignIn, 'function');

  pressHandlers.length = 0;
  renderOwnerLogin(OwnerLoginScreen);
  assert.equal(pressHandlers.length, 1);
  await pressHandlers[0]();
  assert.deepEqual(signInCalls, ['']);

  resolvePendingSignIn?.();
  await firstSubmit;
  holdSignIn = false;
  resolvePendingSignIn = null;
});
