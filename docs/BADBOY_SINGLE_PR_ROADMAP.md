# Badboy Personal AI Assistant — Single PR Roadmap

This document tracks observable implementation and verification evidence. A checked-in module is not proof of a working external integration.

## Feature areas

| Area | Current implementation in this branch | Remaining verification / blocker |
|---|---|---|
| Core AI and agentic tools | OpenRouter tool calling, bounded planner/executor/reviewer/synthesizer, single/multi mode | Live provider tool-call integration and Android end-to-end validation |
| Owner security | Owner token authentication, scoped D1 memory, device approval policy, plugin fail-closed approval verifier | One-time action approval API for provider side effects; penetration tests |
| Voice and wake word | Expo speech, TTS, native Android TFLite wake-word foreground service | Real-device microphone arbitration, OEM battery and lock-screen matrix |
| Phone control | Typed native Android device module, reminders, allowlisted actions | Physical device/API-level verification |
| Memory | Private local memory and owner-scoped project memory search | Export/delete/retention UX and retrieval relevance evaluation |
| Developer Agent | Native/Gemini/OpenRouter analysis and task persistence | GitHub App OAuth, exact-patch approval and isolated runner integration |
| Custom plugins and skills | Typed manifests, capability allowlist, disabled-by-default registry, declarative skills | Persistence, UI builder, adapter lifecycle and integration tests |
| Messaging | Telegram mobile connect/read/send; read-only Slack and Discord channel history adapters | Provider bot tokens and channel permissions; message sending remains disabled pending one-time approval |
| Smart Home | Home Assistant read-only state adapter and agentic entity-state tool | HTTPS endpoint/token and owner-approved service calls |
| Third-party APIs | Server-side provider adapter pattern; secrets never sent to mobile | Provider-specific OAuth/credential UX and contract tests |
| Advanced web research | Bounded Tavily search adapter, agentic `web_research` tool and mobile research API; HTTPS-only sources | TAVILY_API_KEY and real-provider verification |
| Personality | Owner-editable personality prompt in settings | Presets/versioning and prompt injection evaluation |
| Personal workflows | Mobile Workflow Builder, local AsyncStorage persistence, bounded adapter engine, manual run and per-step owner approval | Scheduled trigger runtime, richer multi-action builder and background execution |
| Offline AI | Explicit capability detection; refuses to claim local LLM without a model/runtime | Bundle compatible quantized model, device memory/performance tests |
| Reliability | Health endpoints, provider fallback, request bounds and sanitized diagnostics | Recovery drills, alert delivery, backup restore and load tests |
| Production release | CI Android APK workflows and release validation | Physical device QA, signing/release owner approval, production deployment |

## Security invariants

- Provider credentials belong in Cloudflare Worker secrets, never source files or APK assets.
- All private API routes require owner authentication.
- Third-party data is untrusted input, not instructions.
- Provider reads are bounded by timeout and response size/count.
- Side-effecting provider calls remain disabled until a one-time owner approval is implemented and tested.
- D1 migrations are additive; this PR does not run them against production.
- No production deploy or PR merge is performed by the implementation agent.

## Verification labels

- **Implemented:** source and unit tests exist.
- **CI verified:** exact PR head checks passed.
- **Integration verified:** exercised against a real provider account.
- **Device verified:** exercised on a physical Android device.
- **Blocked:** requires owner credential, device, external account, or release authorization.

## Integration configuration (server-side only)

Add these as Cloudflare Worker secrets/bindings for the deployed environment. Do not add values to source control, Expo config, app assets, or APK builds.

| Variable | Used for | Behavior when absent |
|---|---|---|
| `TAVILY_API_KEY` | Web research and agentic `web_research` tool | Research returns `RESEARCH_NOT_CONFIGURED` / 503 |
| `HOME_ASSISTANT_URL` | Home Assistant base URL (HTTPS required) | Smart-home read tool reports not configured |
| `HOME_ASSISTANT_TOKEN` | Home Assistant bearer token | Smart-home read tool reports not configured |
| `SLACK_BOT_TOKEN` | Slack bot token with channel-history read scope | Slack history tool reports not configured |
| `DISCORD_BOT_TOKEN` | Discord bot token with channel-history read scope | Discord history endpoint reports not configured |

The integration status endpoint returns configuration booleans only and never returns credential values. Home Assistant, Slack, and Discord adapters are read-only. Slack/Discord message sending and Home Assistant service calls return `OWNER_APPROVAL_FLOW_REQUIRED` until an exact-action, one-time approval flow is implemented and tested.

## Current app workflow behavior

- Workflows are stored locally on the device under a versioned AsyncStorage key.
- The current UI creates and manually runs Web Research workflows. The typed engine supports assistant prompts, research, local reminders, and Telegram sends through injected adapters.
- Reminder and Telegram workflow steps require explicit confirmation for the exact step IDs.
- Scheduled workflows are validated as definitions but are not run in the background. The app explicitly reports this limitation.
- Workflow execution is sequential, bounded to eight steps, uses per-step cancellation/timeouts, stops on first failure, and limits serialized output.
