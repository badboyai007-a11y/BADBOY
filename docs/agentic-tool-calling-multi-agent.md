# Badboy Agentic Tool Calling and Multi-Agent Workflow

## What this adds

The authenticated `POST /assistant/agent` endpoint upgrades ordinary streaming chat with a bounded agent workflow:

1. **Planner** (multi mode): turns the user request into a short ordered plan.
2. **Executor**: uses OpenRouter function/tool calling and executes only the server-side allowlisted tools.
3. **Reviewer** (multi mode): checks the executor result for omissions, unsupported claims, and safety.
4. **Synthesizer**: streams the final user-facing answer back to the Android client.

The Android chat screen sends up to eight recent user/assistant messages as bounded context and renders the streamed final answer using the existing chat UI. The existing `/assistant/chat` endpoint remains available for lightweight tasks such as the optional personality-improvement suggestion.

## Built-in tools

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `calculator` | Basic arithmetic using a strict parser | None |
| `current_datetime` | Current server time in UTC ISO-8601 | None |
| `count_words` | Count words and characters in supplied text | None |

No arbitrary shell, filesystem, browser, network, repository, database, messaging, Android-control, or account-management tool is exposed. Unknown tool names are rejected. Tool arguments are parsed and validated on the server; arithmetic is evaluated without `eval`.

## Limits and safety

- Owner authentication is enforced by the existing API router before this endpoint is reached.
- Only `openrouter/free` and explicitly `:free` fallback models are requested.
- Maximum eight history messages, 3,000 characters per history item, and 4,000 characters for the current message.
- Maximum four tool rounds and six tool calls per request.
- Tool results are truncated before being sent back to the model.
- No side-effecting tools are enabled. Future external actions must be added as individually permissioned tools with explicit owner approval, audit events, and dedicated tests.
- The model is not trusted to select arbitrary functions: execution is limited to a fixed allowlist.
- Streaming final text is retained; planner/executor/reviewer progress and tool names are emitted as metadata events.

## Modes

- `single`: one tool-capable executor followed by final answer synthesis.
- `multi`: planner, tool-capable executor, reviewer, and final synthesizer. The Android chat client currently requests `multi` mode.

## Verification

Run:

```sh
pnpm --filter @workspace/functions test
pnpm --filter @workspace/functions typecheck
pnpm --filter @workspace/mobile test
pnpm --filter @workspace/mobile typecheck
```

Provider support for function calling varies by free model and can change. The server tries the configured free-model fallback list; if none supports the request, it returns a clear error rather than silently pretending a tool ran. Validate real provider behavior and end-to-end Android streaming before marking this feature verified.
