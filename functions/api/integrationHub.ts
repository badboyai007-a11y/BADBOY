/**
 * Owner-authenticated, server-side integration adapters.
 *
 * Provider credentials are read only from Worker secrets. The mobile app never
 * receives provider tokens. All adapters are read-only in this slice; write
 * operations remain disabled until one-time owner approval is implemented.
 */
export interface IntegrationEnv {
  TAVILY_API_KEY?: string;
  HOME_ASSISTANT_URL?: string;
  HOME_ASSISTANT_TOKEN?: string;
  SLACK_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
}

type Fetcher = typeof fetch;
const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "Content-Type must be application/json." }, 415);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ code: "REQUEST_TOO_LARGE", error: "Request body exceeds 8 KiB." }, 413);
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    return json({ code: "INVALID_JSON", error: "Request body must be valid JSON." }, 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return json({ code: "INVALID_REQUEST", error: "Request body must be a JSON object." }, 400);
  }
  return value as Record<string, unknown>;
}

function configuredUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

async function fetchWithTimeout(fetcher: Fetcher, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function getIntegrationStatus(env: IntegrationEnv) {
  return {
    research: { configured: Boolean(env.TAVILY_API_KEY?.trim()), mode: "read_only" },
    homeAssistant: {
      configured: Boolean(configuredUrl(env.HOME_ASSISTANT_URL) && env.HOME_ASSISTANT_TOKEN?.trim()),
      mode: "read_only",
    },
    slack: { configured: Boolean(env.SLACK_BOT_TOKEN?.trim()), mode: "read_only" },
    discord: { configured: Boolean(env.DISCORD_BOT_TOKEN?.trim()), mode: "read_only" },
    telegram: { configured: false, mode: "mobile_secure_store" },
    writesRequireOwnerApproval: true,
    providerSecretsStayServerSide: true,
  };
}

export async function handleIntegrationRequest(
  request: Request,
  pathname: string,
  env: IntegrationEnv,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  if (pathname === "/api/integrations/status" && request.method === "GET") {
    return json({ integrations: getIntegrationStatus(env) });
  }

  if (pathname === "/api/research/search" && request.method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (Object.keys(body).some((key) => key !== "query" && key !== "maxResults")) {
      return json({ code: "INVALID_RESEARCH_REQUEST", error: "Unsupported research request fields." }, 400);
    }
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500) {
      return json({ code: "INVALID_RESEARCH_QUERY", error: "query must contain 1–500 characters." }, 400);
    }
    const maxResults = body.maxResults === undefined ? 5 : body.maxResults;
    if (typeof maxResults !== "number" || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 5) {
      return json({ code: "INVALID_RESEARCH_LIMIT", error: "maxResults must be an integer from 1 to 5." }, 400);
    }
    const apiKey = env.TAVILY_API_KEY?.trim();
    if (!apiKey) return json({ code: "RESEARCH_NOT_CONFIGURED", error: "Web research provider is not configured on the server." }, 503);
    try {
      const response = await fetchWithTimeout(fetcher, "https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: body.query.trim(), search_depth: "basic", max_results: maxResults, include_answer: true }),
      });
      if (!response.ok) return json({ code: "RESEARCH_PROVIDER_ERROR", error: "Web research provider returned an error.", providerStatus: response.status }, 502);
      const payload = await response.json() as {
        answer?: unknown;
        results?: Array<{ title?: unknown; url?: unknown; content?: unknown; score?: unknown }>;
      };
      const results = (Array.isArray(payload.results) ? payload.results : []).flatMap((item) => {
        if (typeof item.url !== "string" || typeof item.title !== "string") return [];
        try {
          const url = new URL(item.url);
          if (url.protocol !== "https:") return [];
          return [{
            title: item.title.slice(0, 240),
            url: url.toString(),
            content: typeof item.content === "string" ? item.content.slice(0, 2000) : "",
            score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : null,
          }];
        } catch { return []; }
      }).slice(0, maxResults);
      return json({
        query: body.query.trim(),
        answer: typeof payload.answer === "string" ? payload.answer.slice(0, 4000) : null,
        results,
        sourceCount: results.length,
        retrievedAt: new Date().toISOString(),
      });
    } catch {
      return json({ code: "RESEARCH_UNAVAILABLE", error: "Web research request timed out or could not reach the provider." }, 502);
    }
  }

  if (pathname === "/api/integrations/home-assistant/states" && request.method === "GET") {
    const base = configuredUrl(env.HOME_ASSISTANT_URL);
    const token = env.HOME_ASSISTANT_TOKEN?.trim();
    if (!base || !token) return json({ code: "HOME_ASSISTANT_NOT_CONFIGURED", error: "Home Assistant requires a server-side HTTPS URL and token." }, 503);
    try {
      const response = await fetchWithTimeout(fetcher, new URL("/api/states", base), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!response.ok) return json({ code: "HOME_ASSISTANT_ERROR", error: "Home Assistant could not return entity states.", providerStatus: response.status }, 502);
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) return json({ code: "HOME_ASSISTANT_INVALID_RESPONSE", error: "Home Assistant returned an invalid state list." }, 502);
      const states = payload.slice(0, 100).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item.entity_id !== "string" || typeof item.state !== "string") return [];
        const attributes = item.attributes && typeof item.attributes === "object" ? item.attributes as Record<string, unknown> : {};
        return [{
          entityId: item.entity_id.slice(0, 160),
          state: item.state.slice(0, 160),
          friendlyName: typeof attributes.friendly_name === "string" ? attributes.friendly_name.slice(0, 120) : null,
        }];
      });
      return json({ states, count: states.length, truncated: payload.length > states.length });
    } catch {
      return json({ code: "HOME_ASSISTANT_UNAVAILABLE", error: "Home Assistant request timed out or could not connect." }, 502);
    }
  }

  if (pathname === "/api/integrations/slack/history" && request.method === "GET") {
    const token = env.SLACK_BOT_TOKEN?.trim();
    const channel = new URL(request.url).searchParams.get("channel")?.trim() ?? "";
    if (!token) return json({ code: "SLACK_NOT_CONFIGURED", error: "Slack is not configured on the server." }, 503);
    if (!/^[A-Z0-9]{6,32}$/.test(channel)) return json({ code: "INVALID_SLACK_CHANNEL", error: "A valid Slack channel id is required." }, 400);
    try {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", channel);
      url.searchParams.set("limit", "20");
      const response = await fetchWithTimeout(fetcher, url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!response.ok) return json({ code: "SLACK_PROVIDER_ERROR", error: "Slack history request failed." }, 502);
      const payload = await response.json() as { ok?: boolean; messages?: Array<{ ts?: string; user?: string; text?: string }> };
      if (payload.ok !== true) return json({ code: "SLACK_API_ERROR", error: "Slack did not authorize the history request." }, 502);
      const messages = (payload.messages ?? []).slice(0, 20).map((item) => ({
        timestamp: typeof item.ts === "string" ? item.ts : "",
        user: typeof item.user === "string" ? item.user.slice(0, 80) : "",
        text: typeof item.text === "string" ? item.text.slice(0, 2000) : "",
      }));
      return json({ channel, messages, count: messages.length });
    } catch {
      return json({ code: "SLACK_UNAVAILABLE", error: "Slack request timed out or could not connect." }, 502);
    }
  }


  if (pathname === "/api/integrations/discord/messages" && request.method === "GET") {
    const token = env.DISCORD_BOT_TOKEN?.trim();
    const channel = new URL(request.url).searchParams.get("channel")?.trim() ?? "";
    if (!token) return json({ code: "DISCORD_NOT_CONFIGURED", error: "Discord is not configured on the server." }, 503);
    if (!/^\\d{17,20}$/.test(channel)) return json({ code: "INVALID_DISCORD_CHANNEL", error: "A valid Discord channel ID is required." }, 400);
    try {
      const url = new URL(`https://discord.com/api/v10/channels/${channel}/messages`);
      url.searchParams.set("limit", "20");
      const response = await fetchWithTimeout(fetcher, url, {
        headers: { Authorization: `Bot ${token}`, Accept: "application/json" },
      });
      if (!response.ok) return json({ code: "DISCORD_PROVIDER_ERROR", error: "Discord message history request failed.", providerStatus: response.status }, 502);
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) return json({ code: "DISCORD_INVALID_RESPONSE", error: "Discord returned an invalid message list." }, 502);
      const messages = payload.slice(0, 20).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const author = item.author && typeof item.author === "object" ? item.author as Record<string, unknown> : {};
        if (typeof item.id !== "string" || typeof item.timestamp !== "string") return [];
        return [{
          id: item.id.slice(0, 24),
          timestamp: item.timestamp.slice(0, 40),
          author: typeof author.username === "string" ? author.username.slice(0, 80) : "Unknown",
          content: typeof item.content === "string" ? item.content.slice(0, 2000) : "",
        }];
      });
      return json({ channel, messages, count: messages.length, truncated: payload.length > messages.length });
    } catch {
      return json({ code: "DISCORD_UNAVAILABLE", error: "Discord request timed out or could not connect." }, 502);
    }
  }

  if (
    (pathname === "/api/integrations/home-assistant/service" || pathname === "/api/integrations/slack/send")
    && request.method === "POST"
  ) {
    return json({
      code: "OWNER_APPROVAL_FLOW_REQUIRED",
      error: "This write action is disabled until a one-time owner approval flow is configured.",
      sideEffectsAllowed: false,
    }, 403);
  }

  return json({ code: "INTEGRATION_ENDPOINT_NOT_FOUND", error: "Integration endpoint not found." }, 404);
}
