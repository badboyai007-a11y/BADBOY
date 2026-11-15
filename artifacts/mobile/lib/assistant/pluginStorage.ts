import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_AGENT_PLUGIN_IDS, isAgentPluginId, type AgentPluginId } from "./pluginCatalog";

const ENABLED_PLUGINS_KEY = "badboy-enabled-agent-plugins-v1";

/** Existing installations keep safe read-only adapters enabled unless the owner changes this setting. */
export async function loadEnabledPluginIds(): Promise<AgentPluginId[]> {
  const raw = await AsyncStorage.getItem(ENABLED_PLUGINS_KEY);
  if (!raw) return [...DEFAULT_AGENT_PLUGIN_IDS];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > DEFAULT_AGENT_PLUGIN_IDS.length
    || parsed.some((item) => !isAgentPluginId(item)) || new Set(parsed).size !== parsed.length) {
    throw new Error("Saved plugin settings are invalid.");
  }
  return [...parsed] as AgentPluginId[];
}

export async function setAgentPluginEnabled(id: AgentPluginId, enabled: boolean): Promise<AgentPluginId[]> {
  const current = await loadEnabledPluginIds();
  const next = enabled
    ? (current.includes(id) ? current : [...current, id])
    : current.filter((item) => item !== id);
  await AsyncStorage.setItem(ENABLED_PLUGINS_KEY, JSON.stringify(next));
  return next;
}
