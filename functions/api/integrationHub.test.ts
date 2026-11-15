import assert from "node:assert/strict";
import test from "node:test";
import { handleIntegrationRequest, getIntegrationStatus } from "./integrationHub.ts";

const jsonRequest = (body: unknown) => new Request("https://badboy.test/api/research/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("integration status exposes configuration but never provider secrets", () => {
  const status = getIntegrationStatus({
    TAVILY_API_KEY: "secret-tavily",
    HOME_ASSISTANT_URL: "https://ha.example",
    HOME_ASSISTANT_TOKEN: "secret-ha",
    SLACK_BOT_TOKEN: "secret-slack",
    DISCORD_BOT_TOKEN: "secret-discord",
    GOOGLE_CALENDAR_ACCESS_TOKEN: "secret-calendar",
  });
  assert.equal(status.research.configured, true);
  assert.equal(status.homeAssistant.configured, true);
  assert.equal(status.slack.configured, true);
  assert.equal(status.discord.configured, true);
  assert.equal(status.googleCalendar.configured, true);
  assert.equal(status.providerSecretsStayServerSide, true);
  assert.equal(JSON.stringify(status).includes("secret-"), false);
});

test("research rejects malformed requests and missing provider configuration", async () => {
  const malformed = await handleIntegrationRequest(jsonRequest({ query: "" }), "/api/research/search", {});
  assert.equal(malformed.status, 400);
  const missing = await handleIntegrationRequest(jsonRequest({ query: "latest AI research" }), "/api/research/search", {});
  assert.equal(missing.status, 503);
});

test("research limits result count and only returns HTTPS source URLs", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      answer: "A short sourced answer.",
      results: [
        { title: "Secure source", url: "https://example.com/article", content: "Useful context", score: 0.9 },
        { title: "Unsafe source", url: "http://example.com", content: "Must be excluded", score: 0.8 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const response = await handleIntegrationRequest(
    jsonRequest({ query: "test query", maxResults: 5 }),
    "/api/research/search",
    { TAVILY_API_KEY: "server-only" },
    fakeFetch,
  );
  const result = await response.json() as { results: Array<{ url: string }>; answer: string };
  assert.equal(response.status, 200);
  assert.equal(result.answer, "A short sourced answer.");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://example.com/article");
  assert.equal(capturedBody?.api_key, "server-only");
});

test("Home Assistant state reads require HTTPS server configuration and filter output", async () => {
  const missing = await handleIntegrationRequest(new Request("https://badboy.test/api/integrations/home-assistant/states"), "/api/integrations/home-assistant/states", {
    HOME_ASSISTANT_URL: "http://localhost:8123",
    HOME_ASSISTANT_TOKEN: "token",
  });
  assert.equal(missing.status, 503);
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://ha.example/api/states");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
    return new Response(JSON.stringify([
      { entity_id: "light.office", state: "on", attributes: { friendly_name: "Office" } },
      { entity_id: 12, state: "invalid" },
    ]), { status: 200 });
  };
  const response = await handleIntegrationRequest(new Request("https://badboy.test/api/integrations/home-assistant/states"), "/api/integrations/home-assistant/states", {
    HOME_ASSISTANT_URL: "https://ha.example",
    HOME_ASSISTANT_TOKEN: "secret",
  }, fakeFetch);
  const result = await response.json() as { states: Array<{ entityId: string; friendlyName: string }> };
  assert.equal(response.status, 200);
  assert.deepEqual(result.states, [{ entityId: "light.office", state: "on", friendlyName: "Office" }]);
});

test("Slack history validates channel and returns bounded messages", async () => {
  const invalid = await handleIntegrationRequest(new Request("https://badboy.test/api/integrations/slack/history?channel=bad"), "/api/integrations/slack/history", { SLACK_BOT_TOKEN: "secret" });
  assert.equal(invalid.status, 400);
  const fakeFetch: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
    return new Response(JSON.stringify({ ok: true, messages: [{ ts: "1.2", user: "U123456", text: "hello" }] }), { status: 200 });
  };
  const response = await handleIntegrationRequest(new Request("https://badboy.test/api/integrations/slack/history?channel=C123456"), "/api/integrations/slack/history", { SLACK_BOT_TOKEN: "secret" }, fakeFetch);
  const result = await response.json() as { count: number; messages: Array<{ text: string }> };
  assert.equal(response.status, 200);
  assert.equal(result.count, 1);
  assert.equal(result.messages[0].text, "hello");
});

test("side-effecting integration actions fail closed without one-time owner approval", async () => {
  const response = await handleIntegrationRequest(new Request("https://badboy.test/api/integrations/slack/send", { method: "POST" }), "/api/integrations/slack/send", { SLACK_BOT_TOKEN: "secret" });
  assert.equal(response.status, 403);
  const body = await response.json() as { sideEffectsAllowed: boolean };
  assert.equal(body.sideEffectsAllowed, false);
});


test("Discord history validates channel IDs, keeps the bot token server-side and bounds messages", async () => {
  const invalid = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/discord/messages?channel=not-a-channel"),
    "/api/integrations/discord/messages",
    { DISCORD_BOT_TOKEN: "server-secret" },
  );
  assert.equal(invalid.status, 400);
  let requestedUrl = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bot server-secret");
    return new Response(JSON.stringify([
      { id: "12345678901234567", timestamp: "2026-11-15T10:00:00.000Z", author: { username: "owner" }, content: "hello" },
      { id: 12, timestamp: "invalid", content: "filtered" },
    ]), { status: 200 });
  };
  const response = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/discord/messages?channel=12345678901234567"),
    "/api/integrations/discord/messages",
    { DISCORD_BOT_TOKEN: "server-secret" },
    fakeFetch,
  );
  const result = await response.json() as { count: number; messages: Array<{ id: string; timestamp: string; author: string; content: string }> };
  assert.equal(response.status, 200);
  assert.equal(requestedUrl, "https://discord.com/api/v10/channels/12345678901234567/messages?limit=20");
  assert.equal(result.count, 1);
  assert.deepEqual(result.messages[0], {
    id: "12345678901234567",
    timestamp: "2026-11-15T10:00:00.000Z",
    author: "owner",
    content: "hello",
  });
});

test("Discord history fails closed when no server token is configured", async () => {
  const response = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/discord/messages?channel=12345678901234567"),
    "/api/integrations/discord/messages",
    {},
  );
  assert.equal(response.status, 503);
});


test("Google Calendar reads bounded primary events using a server-side access token", async () => {
  const invalid = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/google-calendar/events?timeMin=not-a-date"),
    "/api/integrations/google-calendar/events",
    { GOOGLE_CALENDAR_ACCESS_TOKEN: "calendar-secret" },
  );
  assert.equal(invalid.status, 400);
  let requestedUrl = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer calendar-secret");
    return new Response(JSON.stringify({ items: [
      { id: "event-1", summary: "Planning", start: { dateTime: "2026-11-16T10:00:00Z" }, end: { dateTime: "2026-11-16T11:00:00Z" }, htmlLink: "https://calendar.google.com/calendar/event?eid=abc" },
      { id: 2, summary: "filtered" },
      { id: "event-2", htmlLink: "https://evil.example/event" },
    ] }), { status: 200 });
  };
  const response = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/google-calendar/events?timeMin=2026-11-15T00:00:00Z"),
    "/api/integrations/google-calendar/events",
    { GOOGLE_CALENDAR_ACCESS_TOKEN: "calendar-secret" },
    fakeFetch,
  );
  const result = await response.json() as { events: Array<{ id: string; htmlLink: string | null }>; count: number };
  assert.equal(response.status, 200);
  assert.ok(requestedUrl.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events?"));
  assert.equal(result.count, 2);
  assert.equal(result.events[0].htmlLink, "https://calendar.google.com/calendar/event?eid=abc");
  assert.equal(result.events[1].htmlLink, null);
});

test("Google Calendar fails closed without a configured server token", async () => {
  const response = await handleIntegrationRequest(
    new Request("https://badboy.test/api/integrations/google-calendar/events"),
    "/api/integrations/google-calendar/events",
    {},
  );
  assert.equal(response.status, 503);
});
