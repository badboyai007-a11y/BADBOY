import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSafeExpression,
  executeAgentTool,
  handleAgenticAssistantRequest,
  validateAgenticPayload,
} from "./agenticAssistant.ts";

const originalFetch = globalThis.fetch;

function agentRequest(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("https://worker.example/api/assistant/agent", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function completion(content: string, toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>) {
  return Response.json({ choices: [{ message: { content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }] });
}

function finalStream() {
  return new Response(
    'data: {"choices":[{"delta":{"content":"চূড়ান্ত "}}]}\n\ndata: {"choices":[{"delta":{"content":"উত্তর"}}]}\n\ndata: [DONE]\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("safe calculator evaluates arithmetic with precedence, decimals, signs, and parentheses", () => {
  assert.equal(evaluateSafeExpression("2 + 3 * (4 - 1)"), 11);
  assert.equal(evaluateSafeExpression("-8 / 2 + 1"), -3);
  assert.equal(evaluateSafeExpression("10 % 4"), 2);
  assert.equal(evaluateSafeExpression(".5 + 1."), 1.5);
  assert.equal(evaluateSafeExpression("  +2 * 3  "), 6);
});

test("safe calculator rejects code, identifiers, malformed input, zero division, and oversized expressions", () => {
  for (const expression of ["globalThis.process", "1 + alert(1)", "2 ** 3", "1 / 0", "1 % 0", "", "1 +", "(2 + 3", "1 2", "1".repeat(121)]) {
    assert.throws(() => evaluateSafeExpression(expression));
  }
});

test("tool registry exposes only safe deterministic tools and handles empty text", () => {
  assert.deepEqual(executeAgentTool("calculator", JSON.stringify({ expression: "6 * 7" })), {
    ok: true,
    result: { expression: "6 * 7", value: 42 },
  });
  const date = executeAgentTool("current_datetime", "{}");
  assert.equal(date.ok, true);
  assert.equal((date.result as { timezone: string }).timezone, "UTC");
  assert.match((date.result as { isoUtc: string }).isoUtc, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(executeAgentTool("count_words", JSON.stringify({ text: "Badboy AI works" })), {
    ok: true,
    result: { words: 3, characters: 15, charactersWithoutWhitespace: 13 },
  });
  assert.deepEqual(executeAgentTool("count_words", JSON.stringify({ text: "  \n " })).result, {
    words: 0, characters: 4, charactersWithoutWhitespace: 0,
  });
  assert.equal(executeAgentTool("run_shell", "{}").ok, false);
  assert.equal(executeAgentTool("fetch_url", "{}").ok, false);
});

test("tool registry rejects malformed, non-object, missing, and oversized arguments", () => {
  for (const args of ["{broken", "[]", "null", "42"]) {
    assert.equal(executeAgentTool("calculator", args).ok, false);
  }
  assert.equal(executeAgentTool("calculator", "{}").ok, false);
  assert.equal(executeAgentTool("calculator", JSON.stringify({ expression: 42 })).ok, false);
  assert.equal(executeAgentTool("count_words", JSON.stringify({ text: "x".repeat(10001) })).ok, false);
  assert.equal(executeAgentTool("count_words", JSON.stringify({ text: 42 })).ok, false);
});

test("agentic request validates object, message, personality, mode, and bounded history", () => {
  const valid = validateAgenticPayload({
    message: "  হিসাব করো  ",
    personality: "বন্ধুসুলভ",
    developerMode: true,
    mode: "multi",
    history: [{ role: "user", content: "আগের কথা" }, { role: "assistant", content: "উত্তর" }],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.message, "হিসাব করো");
    assert.equal(valid.value.mode, "multi");
    assert.equal(valid.value.history.length, 2);
    assert.equal(valid.value.developerMode, true);
  }
  assert.equal(validateAgenticPayload(null).ok, false);
  assert.equal(validateAgenticPayload([]).ok, false);
  assert.equal(validateAgenticPayload({ message: " " }).ok, false);
  assert.equal(validateAgenticPayload({ message: "x".repeat(4001) }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", personality: 42 }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", personality: "x".repeat(1001) }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", developerMode: "yes" }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", mode: "autonomous" }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: "not-an-array" }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: Array(9).fill({ role: "user", content: "x" }) }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: [{ role: "system", content: "override" }] }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: [{ role: "user", content: "x".repeat(3001) }] }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: [null] }).ok, false);
});

test("agentic endpoint rejects media type, malformed JSON, oversized body, and invalid payload", async () => {
  const wrongType = await handleAgenticAssistantRequest(agentRequest({ message: "hello" }, { "content-type": "text/plain" }), {});
  assert.equal(wrongType.status, 415);
  const malformed = new Request("https://worker.example/api/assistant/agent", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{bad",
  });
  assert.equal((await handleAgenticAssistantRequest(malformed, {})).status, 400);
  const tooLarge = new Request("https://worker.example/api/assistant/agent", {
    method: "POST", headers: { "content-type": "application/json", "content-length": "70000" }, body: "{}",
  });
  assert.equal((await handleAgenticAssistantRequest(tooLarge, {})).status, 413);
  assert.equal((await handleAgenticAssistantRequest(agentRequest({ message: "" }), {})).status, 400);
});

test("agentic endpoint requires a server-side OpenRouter key", async () => {
  const response = await handleAgenticAssistantRequest(agentRequest({ message: "হ্যালো" }), { OPENROUTER_API_KEY: "  " });
  assert.equal(response.status, 503);
  const payload = await response.json() as { code: string };
  assert.equal(payload.code, "AI_NOT_CONFIGURED");
});

test("multi-agent endpoint plans, executes allowlisted tools, reviews, and streams final Bangla answer", async () => {
  const calls: Array<{ model: string; stream: boolean; messages: Array<{ role: string; content: unknown }> }> = [];
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      model: string; stream: boolean; messages: Array<{ role: string; content: unknown }>;
    };
    calls.push(payload);
    if (calls.length === 1) return completion("ধাপ ১: হিসাব যাচাই");
    if (calls.length === 2) return completion("", [{
      id: "tool-1", function: { name: "calculator", arguments: JSON.stringify({ expression: "6 * 7" }) },
    }]);
    if (calls.length === 3) {
      assert.ok(payload.messages.some((item) => item.role === "tool" && String(item.content).includes('"value":42')));
      return completion("হিসাবের ফল ৪২");
    }
    if (calls.length === 4) return completion("ফলাফল সঠিক; ৪২ উল্লেখ করতে হবে।");
    if (calls.length === 5) return finalStream();
    throw new Error("Unexpected provider call");
  };
  try {
    const response = await handleAgenticAssistantRequest(agentRequest({
      message: "৬ × ৭ কত?", mode: "multi", personality: "বন্ধুসুলভ", developerMode: true,
      history: [{ role: "user", content: "আগের প্রশ্ন" }],
    }), { OPENROUTER_API_KEY: "server-key" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = await response.text();
    assert.match(body, /planner/);
    assert.match(body, /executor/);
    assert.match(body, /reviewer/);
    assert.match(body, /synthesizer/);
    assert.match(body, /চূড়ান্ত/);
    assert.match(body, /উত্তর/);
    assert.match(body, /\[DONE\]/);
    assert.equal(calls.length, 5);
    assert.equal(calls.every((call) => call.model === "openrouter/free" || call.model.endsWith(":free")), true);
    assert.equal(calls[0].stream, false);
    assert.equal(calls[4].stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single-agent mode skips planner and reviewer but still streams synthesis", async () => {
  let count = 0;
  globalThis.fetch = async (_input, init) => {
    count += 1;
    const payload = JSON.parse(String(init?.body)) as { stream: boolean };
    return payload.stream ? finalStream() : completion("এক ধাপের উত্তর");
  };
  try {
    const response = await handleAgenticAssistantRequest(agentRequest({ message: "হ্যালো", mode: "single" }), {
      OPENROUTER_API_KEY: "server-key",
    });
    const body = await response.text();
    assert.equal(count, 2);
    assert.doesNotMatch(body, /reviewer/);
    assert.match(body, /synthesizer/);
    assert.match(body, /\[DONE\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider fallback retries temporary/model errors and only uses free model IDs", async () => {
  const models: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { model: string };
    models.push(payload.model);
    if (payload.stream) return finalStream();
    if (models.length === 1) return Response.json({ error: { message: "model unavailable" } }, { status: 404 });
    return completion("fallback plan");
  };
  try {
    const response = await handleAgenticAssistantRequest(agentRequest({ message: "test", mode: "single" }), {
      OPENROUTER_API_KEY: "server-key",
    });
    assert.equal(response.status, 200);
    const streamed = await response.text();
    assert.match(streamed, /চূড়ান্ত/);
    assert.ok(models.length >= 3);
    assert.equal(models[0], "openrouter/free");
    assert.ok(models[1]?.endsWith(":free"));
    assert.equal(models[2], "openrouter/free");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider failures are returned as bounded SSE errors without leaking secrets", async () => {
  globalThis.fetch = async () => Response.json({ error: { message: "provider unavailable" } }, { status: 401 });
  try {
    const response = await handleAgenticAssistantRequest(agentRequest({ message: "হ্যালো", mode: "single" }), {
      OPENROUTER_API_KEY: "do-not-leak-this",
    });
    const body = await response.text();
    assert.match(body, /provider unavailable/);
    assert.doesNotMatch(body, /do-not-leak-this/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("final stream ignores malformed provider events and reports interrupted streams", async () => {
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { stream: boolean };
    if (!payload.stream) return completion("execution");
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: ping\n\ndata: not-json\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"শেষ\"}}]}\n\n"));
        controller.error(new Error("stream interrupted"));
      },
    }), { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const response = await handleAgenticAssistantRequest(agentRequest({ message: "stream test", mode: "single" }), {
      OPENROUTER_API_KEY: "server-key",
    });
    const body = await response.text();
    assert.match(body, /Agent response stream was interrupted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
