import * as SecureStore from 'expo-secure-store';

export type ProviderId =
  | 'gemini' | 'groq' | 'cerebras' | 'sambanova' | 'mistral'
  | 'openrouter' | 'cloudflare' | 'cohere' | 'nvidia' | 'omniroute' | 'custom';

export type FreeTierKind = 'free-tier' | 'trial' | 'quota' | 'account-dependent' | 'self-hosted';

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  freeTier: FreeTierKind;
  baseUrl: string;
  docsUrl: string;
  compatible: 'openai' | 'gemini' | 'custom';
}

export const PROVIDERS: ProviderDefinition[] = [
  { id: 'gemini', name: 'Google Gemini', description: 'Free-tier API', freeTier: 'free-tier', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', docsUrl: 'https://ai.google.dev/gemini-api/docs', compatible: 'gemini' },
  { id: 'groq', name: 'Groq', description: 'Free developer tier; rate limits apply', freeTier: 'free-tier', baseUrl: 'https://api.groq.com/openai/v1', docsUrl: 'https://console.groq.com/docs', compatible: 'openai' },
  { id: 'cerebras', name: 'Cerebras', description: 'Free/trial availability varies', freeTier: 'trial', baseUrl: 'https://api.cerebras.ai/v1', docsUrl: 'https://inference-docs.cerebras.ai/', compatible: 'openai' },
  { id: 'sambanova', name: 'SambaNova', description: 'Free developer access may vary', freeTier: 'free-tier', baseUrl: 'https://api.sambanova.ai/v1', docsUrl: 'https://docs.sambanova.ai/', compatible: 'openai' },
  { id: 'mistral', name: 'Mistral', description: 'Free experimentation limits may apply', freeTier: 'free-tier', baseUrl: 'https://api.mistral.ai/v1', docsUrl: 'https://docs.mistral.ai/', compatible: 'openai' },
  { id: 'openrouter', name: 'OpenRouter', description: 'Free models only when :free is selected', freeTier: 'free-tier', baseUrl: 'https://openrouter.ai/api/v1', docsUrl: 'https://openrouter.ai/docs', compatible: 'openai' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', description: 'Account quota / Neurons; usage limits apply', freeTier: 'quota', baseUrl: 'https://api.cloudflare.com/client/v4', docsUrl: 'https://developers.cloudflare.com/workers-ai/', compatible: 'custom' },
  { id: 'cohere', name: 'Cohere', description: 'Trial key limits; not unlimited free', freeTier: 'trial', baseUrl: 'https://api.cohere.com/v2', docsUrl: 'https://docs.cohere.com/', compatible: 'custom' },
  { id: 'nvidia', name: 'NVIDIA NIM', description: 'Access and credits depend on account', freeTier: 'account-dependent', baseUrl: 'https://integrate.api.nvidia.com/v1', docsUrl: 'https://docs.nvidia.com/nim/', compatible: 'openai' },
  { id: 'omniroute', name: 'OmniRoute', description: 'Local / self-hosted router', freeTier: 'self-hosted', baseUrl: 'http://127.0.0.1:20128/v1', docsUrl: 'https://github.com/Deep-orbit/OmniRoute', compatible: 'openai' },
];

const KEY_PREFIX = 'badboy.ai.provider-key.';
const CUSTOM_PROVIDERS_KEY = 'badboy.ai.custom-providers.v1';

export async function saveProviderKey(id: ProviderId, key: string): Promise<void> {
  const value = key.trim();
  if (!value) throw new Error('API Key ফাঁকা রাখা যাবে না।');
  await SecureStore.setItemAsync(KEY_PREFIX + id, value);
}

export async function getProviderKey(id: ProviderId): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_PREFIX + id);
}

export async function removeProviderKey(id: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_PREFIX + id);
}

export async function getConnectedProviderIds(): Promise<ProviderId[]> {
  const values = await Promise.all(PROVIDERS.map(async (provider) => ({
    id: provider.id,
    key: await getProviderKey(provider.id),
  })));
  return values.filter((item) => Boolean(item.key)).map((item) => item.id);
}

export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
