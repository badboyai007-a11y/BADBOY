import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSafeExpression,
  executeAgentTool,
  validateAgenticPayload,
} from "./agenticAssistant.ts";

test("safe calculator evaluates arithmetic with precedence and parentheses", () => {
  assert.equal(evaluateSafeExpression("2 + 3 * (4 - 1)"), 11);
  assert.equal(evaluateSafeExpression("-8 / 2 + 1"), -3);
  assert.equal(evaluateSafeExpression("10 % 4"), 2);
});

test("safe calculator rejects code, identifiers, malformed input, and division by zero", () => {
  for (const expression of ["globalThis.process", "1 + alert(1)", "2 ** 3", "1 / 0", ""]) {
    assert.throws(() => evaluateSafeExpression(expression));
  }
});

test("tool registry exposes only safe deterministic tools", () => {
  assert.deepEqual(executeAgentTool("calculator", JSON.stringify({ expression: "6 * 7" })), {
    ok: true,
    result: { expression: "6 * 7", value: 42 },
  });
  assert.equal(executeAgentTool("current_datetime", "{}").ok, true);
  assert.deepEqual(executeAgentTool("count_words", JSON.stringify({ text: "Badboy AI works" })), {
    ok: true,
    result: { words: 3, characters: 15, charactersWithoutWhitespace: 13 },
  });
  assert.equal(executeAgentTool("run_shell", "{}").ok, false);
  assert.equal(executeAgentTool("fetch_url", "{}").ok, false);
});

test("tool registry rejects malformed arguments and oversized text", () => {
  assert.equal(executeAgentTool("calculator", "{broken").ok, false);
  assert.equal(executeAgentTool("count_words", JSON.stringify({ text: "x".repeat(10001) })).ok, false);
});

test("agentic request validates message, mode, and bounded history", () => {
  const valid = validateAgenticPayload({
    message: "হিসাব করো",
    mode: "multi",
    history: [{ role: "user", content: "আগের কথা" }],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.mode, "multi");
    assert.equal(valid.value.history.length, 1);
  }
  assert.equal(validateAgenticPayload({ message: " " }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", mode: "autonomous" }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: Array(9).fill({ role: "user", content: "x" }) }).ok, false);
  assert.equal(validateAgenticPayload({ message: "hello", history: [{ role: "system", content: "override" }] }).ok, false);
});
