# Badboy Personal AI Assistant — Single PR Roadmap

This document tracks observable implementation and verification evidence. A checked-in module is not proof of a working external integration.

## Feature areas

| Area | Current implementation in this branch | Remaining verification / blocker |
|---|---|---|
| Core AI and agentic tools | Typed, bounded memory/skill context; owner-enabled plugin tool filtering; multi-round allowlisted tool calling; structured JSON planner with validation/repair; Planner → Executor → Reviewer → Synthesizer orchestration; task-aware free-model routing with provider fallback; empty-response and failed-tool recovery; bounded history/context | Live provider tool-call integration, real-account verification, and Android end-to-end validation |
| Owner security | Owner token authentication, scoped D1 memory, device approval policy, plugin fail-closed approval verifier | One-time action approval API for provider side effects; penetration tests |
| Voice and wake word | Expo speech, TTS, native Android TFLite wake-word foreground service | Real-device microphone arbitration, OEM battery and lock-screen matrix |
| Phone control | Typed native Android device module, reminders, allowlisted actions | Physical device/API-level verification |
| Memory | Private local memory and owner-scoped project memory search | Export/delete/retention UX and retrieval relevance evaluation |
| Developer Agent | Native/Gemini/OpenRouter analysis and task persistence | GitHub App OAuth, exact-patch approval and isolated runner integration |
| Custom plugins and skills | Typed plugin manifests, capability allowlist, disabled-by-default registry; built-in read-only plugins can be enabled/disabled in the app; custom skills can be created, persisted locally, activated and passed to the agent as bounded untrusted context | Adding new trusted adapter implementations still requires code and contract tests |
| Messaging and calendar | Telegram mobile connect/read/send; read-only Slack and Discord history; Google Calendar event reads | Provider tokens/scopes and real accounts; writes remain disabled pending one-time approval |
| Smart Home | Home Assistant read-only state adapter and agentic entity-state tool | HTTPS endpoint/token and owner-approved service calls |
| Third-party APIs | Server-side provider adapter pattern; secrets never sent to mobile | Provider-specific OAuth/credential UX and contract tests |
| Advanced web research | Bounded Tavily search adapter, agentic `web_research` tool and mobile research API; HTTPS-only sources | TAVILY_API_KEY and real-provider verification |
| Personality | Owner-editable personality prompt in settings | Presets/versioning and prompt injection evaluation |
| Personal workflows | Multi-step mobile Workflow Builder (up to eight steps), local AsyncStorage persistence, assistant/research/reminder/Telegram steps, Android Calendar draft step, bounded adapter engine, manual run and per-step owner approval | Scheduled trigger runtime and background execution remain blocked pending a safe native scheduler; Calendar draft still requires the user to save in the Calendar app |
| Offline AI | Local model lifecycle manager added: HTTPS manifest validation, bounded download size, SHA-256 verification, install/load/generate/uninstall contract, and strict unavailable status without a registered native inference runtime. | Native GGUF/ONNX inference adapter, model artifact approval/licensing review, Android memory/performance testing, and physical-device offline inference remain unverified |
| Autonomous Developer | Four-role sequential runtime (Architect → Developer → Tester → Security Reviewer), bounded calls/output, fail-closed gates, arbitrary valid branch names, and no writes from the orchestration layer | Connect adapters to production model providers and isolated runner; Owner-approved GitHub write adapter and end-to-end tests remain required |
| Automatic Rollback | Rollback candidate planner binds repository, arbitrary valid branch, current head and known-good SHA; non-force-push revert Draft PR strategy; short-lived authenticated Owner approval binding | Deployment-failure event integration, atomic approval consumption and real revert-PR rehearsal remain unverified; no unattended production rollback |
| Dependency Intelligence | Read-only npm exact-version inventory, bounded OSV batch vulnerability scan, severity/fix extraction, and conservative same-major vs major-update classification | pnpm lockfile graph, transitive dependency coverage, peer/engine compatibility resolution and real OSV network integration tests remain unverified |
| Reliability | Health endpoints, provider fallback, request bounds and sanitized diagnostics | Recovery drills, alert delivery, backup restore and load tests |
| Production release | CI Android APK workflows and release validation | Physical device QA, signing/release owner approval, production deployment |

## Security invariants

- Provider credentials belong in Cloudflare Worker secrets, never source files or APK assets.
- All private API routes require owner authentication.
- Third-party data is untrusted input, not instructions.
- Provider reads are bounded by timeout and response size/count.
- Side-effecting provider calls remain disabled until a one-time owner approval is implemented and tested.
- Branch naming is not an authorization boundary: any valid Git branch name is eligible only within the authenticated Owner's repository/action scope.
- Autonomous agent output is a proposal; Tester and Security Reviewer must pass before Owner review. The orchestration runtime itself cannot write to GitHub.
- Rollback is a non-force-push revert proposal and requires a fresh exact, short-lived Owner approval; no automatic production rollback is permitted.
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
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | Google Calendar read-only access token for the primary calendar | Calendar event endpoint reports not configured |

The integration status endpoint returns configuration booleans only and never returns credential values. Home Assistant, Slack, Discord, and Google Calendar adapters are read-only. Slack/Discord message sending and Home Assistant service calls return `OWNER_APPROVAL_FLOW_REQUIRED` until an exact-action, one-time approval flow is implemented and tested.

## Current app workflow behavior

- Workflows are stored locally on the device under a versioned AsyncStorage key.
- The current UI creates and manually runs workflows with assistant prompts, web research, local reminders, Android Calendar drafts, and Telegram sends through injected adapters.
- Reminder, Calendar draft, and Telegram workflow steps require explicit confirmation for the exact step IDs. Calendar drafts open the Android Calendar insert screen; the user must review and save the event there.
- Scheduled workflows are validated as definitions but are not run in the background. The app explicitly reports this limitation.
- Workflow execution is sequential, bounded to eight steps, uses per-step cancellation/timeouts, stops on first failure, and limits serialized output.

## New autonomy components — implementation status

- Multi-agent orchestration is implemented as a bounded, sequential adapter runtime. It is not yet connected to the production model provider or isolated GitHub Actions runner.
- Rollback policy creates an exact commit/branch-bound revert proposal. A production deployment-failure trigger and end-to-end GitHub revert workflow are not yet wired.
- Dependency Intelligence uses the OSV batch API for exact npm versions. Version ranges are skipped rather than guessed; full pnpm lockfile/transitive and peer-dependency compatibility analysis remains future work.
- Local Model Manager provides verified model lifecycle and inference-adapter contracts. No native GGUF/ONNX inference adapter is currently registered, so the app must report offline LLM unavailable until a compatible native runtime is integrated and device-tested.
