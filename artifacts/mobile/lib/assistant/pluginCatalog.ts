export const BUILTIN_AGENT_PLUGINS = [
  { id: "web-research", name: "Web Research", description: "Search public web sources and return bounded HTTPS evidence.", tool: "web_research" },
  { id: "home-assistant", name: "Home Assistant", description: "Read configured smart-home entity states; no device control.", tool: "home_assistant_states" },
  { id: "slack-history", name: "Slack History", description: "Read recent messages from a selected Slack channel.", tool: "slack_history" },
  { id: "discord-history", name: "Discord History", description: "Read recent messages from a selected Discord channel.", tool: "discord_history" },
  { id: "google-calendar", name: "Google Calendar", description: "Read upcoming events from the primary calendar.", tool: "google_calendar_events" },
] as const;

export type AgentPluginId = typeof BUILTIN_AGENT_PLUGINS[number]["id"];
export const DEFAULT_AGENT_PLUGIN_IDS: AgentPluginId[] = BUILTIN_AGENT_PLUGINS.map((plugin) => plugin.id);
export function isAgentPluginId(value: unknown): value is AgentPluginId {
  return typeof value === "string" && BUILTIN_AGENT_PLUGINS.some((plugin) => plugin.id === value);
}
