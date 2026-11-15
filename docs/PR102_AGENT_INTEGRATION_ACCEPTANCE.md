# PR #102 — Agent Integration Completion and Verification Contract

## Purpose

PR #101 adds the bounded Planner → Executor → Reviewer → Synthesizer path and three deterministic built-in tools. This document defines the complete implementation boundary and the evidence required before the broader agent capabilities can be labelled **Verified**.

A source file, UI control, mocked test, successful typecheck, or CI run alone is not proof of end-to-end capability. Statuses must distinguish:

- **Implemented** — production code exists.
- **CI verified** — automated tests/build/security checks passed for the exact PR head SHA.
- **Device verified** — exercised on a physical Android device with recorded result.
- **Integration verified** — exercised against the real provider/account/service with the required credentials.
- **Blocked** — external credential, model asset, platform restriction, or owner action is missing.
- **Not implemented** — no production implementation exists.

Never promote a feature to Verified using only a mock or architecture document.

## 1. Agent workflow and Android chat

| Capability | Existing baseline | Required completion evidence |
|---|---|---|
| Planner | Multi-agent planner exists in `functions/api/agenticAssistant.ts`. | Tests for empty plans, malformed plans, contradictory steps, long requests, Bangla/English requests, and plan-to-execution consistency. |
| Executor | OpenRouter function calling exists with a fixed tool allowlist. | Provider integration test against a configured model that demonstrably supports tool calls; assert tool-call arguments, result handoff, bounded retries, and graceful unsupported-model failure. |
| Reviewer | Review stage exists in multi mode. | Tests proving unsupported claims are rejected/corrected, missing requirements are surfaced, and reviewer failure cannot fabricate completion. |
| Synthesizer | Final SSE response exists. | Stream parsing tests for chunk boundaries, malformed frames, disconnect/cancel, empty stream, provider error, and final answer integrity. |
| Android Chat | Chat screen calls the agentic streaming API. | Physical-device test covering owner login, Bangla and English prompts, multiple tool calls, progress metadata, cancellation, app background/foreground, and network loss. |
| Single-agent mode | Backend mode exists. | API tests for both single and multi modes; document which mode Android exposes. |

## 2. GitHub Developer Agent

### Required implementation
- OAuth/device authorization or a narrowly scoped GitHub App installation; never ask the model to handle raw credentials.
- Owner-bound repository selection and permission inspection.
- Read-only repository tree/file/commit/PR inspection first.
- Diff generation and patch validation before any write.
- Explicit owner confirmation for branch creation, file writes, commits, workflow dispatch, and PR creation.
- Idempotency keys and duplicate-write protection.
- Audit event for every read/write operation without logging secrets or private source contents.
- Build/test execution only in an ephemeral, isolated GitHub Actions runner; no shell or Copilot CLI process inside a Cloudflare Worker.
- Clear engine result states: completed, failed, blocked by permission, provider quota/authentication failure, runner failure, and owner approval required.

### Verification gates
- Cross-owner repository access is denied.
- Read-only token cannot write.
- Write requests without a fresh owner approval are denied.
- Approval is bound to the exact repository, branch, operation, and patch hash.
- Retry cannot duplicate a commit, workflow dispatch, or PR.
- Runner logs redact credentials and do not expose them to model prompts.
- Real GitHub App/token integration and a disposable test repository pass before Integration Verified.

## 3. Android phone-control tools

### Required implementation
- A small, explicit native action allowlist (for example: open an installed app by package identifier, create a notification, or open a system settings page).
- Per-action Android permission checks and user-visible permission explanations.
- Owner confirmation for sensitive actions; no silent message sending, payment, account changes, or destructive actions.
- Native module boundary with typed inputs/results, timeouts, cancellation, and lifecycle cleanup.
- Accessibility APIs are not a general-purpose bypass and must not be enabled by default.
- No arbitrary shell, filesystem, contacts, SMS, call, or settings mutation access.

### Verification gates
- Unit tests for every allowed action and rejected unknown action.
- Permission denied/revoked paths are tested.
- Android API-level compatibility is tested on physical devices.
- Confirmed actions return an OS-observed result; otherwise return an explicit unsupported/failed state.

## 4. Wake word, voice, and background behavior

### Existing baseline
- The repository contains a TensorFlow Lite Android wake-word service and a typed Expo bridge.
- The service uses a microphone foreground service and a persistent notification.
- The current native module reports support only on Android 14+.
- Existing chat voice capture uses Expo Audio and speech recognition.

### Required completion
- One microphone ownership coordinator must serialize wake detection, command recording, transcription, TTS, and release.
- Wake detection must stop and release its microphone before command recording starts.
- Resume listening only after TTS completion and audio-session release.
- Permission revocation, service failure, process death, screen lock, battery restrictions, and app shutdown must fail closed.
- Foreground-only and background/lock-screen support must be reported separately.
- Never claim force-stop survival or universal OEM background operation.

### Verification gates
- Native model input/output tensor shape and model checksum match the shipped asset.
- Instrumented tests cover start/stop races, duplicate wake events, service restart, notification stop, microphone contention, and permission revocation.
- Physical-device matrix covers supported Android versions and at least one OEM battery-restriction scenario.
- Background/lock-screen status remains Blocked until each physical-device test passes.

## 5. Memory and retrieval

### Required implementation
- Keep private device memory distinct from cloud project memory; do not silently sync private notes.
- Add explicit owner-controlled memory scopes: device-private, project, and general assistant context.
- Retrieval must be owner-scoped, privacy-filtered, bounded, and explain which memory source was used.
- Sensitive memories must be excluded from model context unless the owner explicitly opts in for that request.
- Add retention, export, delete, and audit behavior before cloud sync is enabled.

### Verification gates
- Cross-owner reads/writes are impossible.
- Deleted memories never appear in retrieval.
- Sensitive/private scope filters are tested.
- Retrieval relevance and context truncation are tested with Bangla and English fixtures.
- Encryption and backup claims require implementation evidence; local UI copy alone is insufficient.

## 6. Telegram integration

### Existing baseline
- Mobile Telegram client supports bot identity verification, polling, sending, and SecureStore token storage.
- This is a foreground/manual client integration; it is not a background automation service.

### Required completion
- Keep bot token in secure storage or a server secret boundary; never put it in model context or logs.
- Validate bot ownership/chat binding and restrict allowed chat IDs.
- Add explicit owner approval before outbound messages or automated replies.
- Use webhook delivery or a supported scheduled poller with replay protection and update cursor persistence.
- Add rate limiting, message-size limits, retry policy, duplicate suppression, and disconnect/revocation behavior.

### Verification gates
- Invalid token, unauthorized chat, duplicate update, replay, rate limit, network outage, and revoked bot tests.
- Real Telegram bot integration in a private test chat.
- No automated outbound message without the configured approval policy.

## 7. Reminders, scheduling, and calendar

### Required implementation
- Persist reminder records with owner ID, timezone, due time, recurrence rule, status, and delivery history.
- Use a Cloudflare scheduled handler/queue or another supported scheduler; do not rely on Android JS timers for durable reminders.
- Handle daylight-saving/timezone changes, missed schedules, duplicate delivery, cancellation, and retry.
- Calendar integration must use explicit OAuth scopes and read/write consent separately.
- Calendar event creation/update/cancellation requires owner approval and an idempotency key.

### Verification gates
- Deterministic tests for timezone boundaries, recurrence, missed runs, cancellation, retries, and duplicate suppression.
- Scheduled handler tests locally and in CI.
- Real calendar integration tests against a disposable calendar before Integration Verified.
- No production migration is run automatically by this PR; migration review and rollout are separate owner-approved steps.

## 8. Offline local AI

### Required implementation
- Select and pin a supported on-device inference runtime compatible with the app's Android ABI, React Native/Expo SDK, and New Architecture.
- Ship a versioned, checksummed model with documented license, size, memory, context length, and supported languages.
- Route requests explicitly between cloud and local providers; show offline/online state.
- Keep offline mode functional without network access and prevent silent cloud fallback when the owner selects offline-only mode.
- Do not claim offline voice recognition unless the speech model and runtime are also local.

### Verification gates
- Model checksum and load tests on target Android hardware.
- Airplane-mode chat and failure tests.
- Peak RAM, cold-start, token throughput, battery, and thermal measurements.
- Bangla/English quality evaluation on a fixed test set.
- Offline status remains Blocked until a physical device completes the full test suite.

## 9. Security, audit, and reliability

- Every tool has a schema, owner scope, risk classification, timeout, result contract, and test suite.
- Side-effecting tools require explicit owner approval.
- Credentials stay in platform secure storage or Cloudflare/GitHub secrets; never in APK assets, source, logs, or model prompts.
- Audit records contain operation metadata and outcome, not credentials or unnecessary private content.
- Add abuse limits, cancellation, provider timeouts, request-size limits, and safe error mapping.
- No production D1 migration, secret mutation, deployment, or PR merge is authorized by this specification.

## 10. Required PR #102 verification report

The PR description/checklist must include the exact tested commit SHA and links to CI runs. Report each item separately:

1. Typecheck and lint.
2. Backend unit/integration tests.
3. Mobile unit tests.
4. Android native unit/instrumented tests.
5. APK build and artifact existence.
6. Security scans.
7. Provider integration test.
8. GitHub integration test.
9. Telegram integration test.
10. Physical-device voice/wake-word test.
11. Physical-device offline-model test.
12. Scheduler/timezone test.
13. Migration validation (read-only unless separately authorized).

A check is **PASS** only when its job/test actually ran on the exact head SHA and completed successfully. A skipped, queued, unavailable, or credential-blocked check is not PASS. A PR is not production deployed merely because CI passed.

## Context7 documentation constraints used

- Expo background tasks are deferred while the app is foregrounded; they are not a precise alarm clock or a substitute for a durable server scheduler.
- Cloudflare Workers support scheduled handlers and Queues; external-service credentials belong in Wrangler/Worker secrets.
- React Native Android native modules and runtime permissions must be implemented through the native boundary and validated on target Android versions.

## Release policy

PR #102 may be marked ready for review only after all code-level CI checks pass. Hardware- or credential-dependent capabilities must remain explicitly Blocked until the matching integration/device evidence is attached. Never mark the whole roadmap complete by averaging partial results.


## Implementation progress (updated on 2026-11-15)

### Added in this PR branch
- Owner-scoped project-memory search in D1 using parameterized statements.
- New authenticated route: `POST /api/agent/memory/search`.
- Request body is bounded to 8 KiB; only `projectId`, `query`, and optional integer `limit` are accepted.
- The route receives owner identity only from the existing upstream personal-owner authentication gate; client-supplied owner IDs are not accepted.
- Sensitive memories are excluded unconditionally by the route. There is no request flag to bypass this privacy boundary.
- Search results exclude soft-deleted records and are scoped by both project ID and verified owner ID.
- Unit tests cover owner scoping, sensitive-memory exclusion, malformed payloads, unsupported fields/content types, missing D1 storage, and request-size limits.
- Added the backend memory-search test to the functions test script.

### Current verification status
- **Implemented:** code and test files are committed to the PR branch.
- **CI verified:** pending exact-head CI execution; do not mark PASS until the run completes.
- **Device / provider verified:** not applicable to this server-side memory search route; Android client integration and real D1 environment verification remain separate work.
- Existing mobile-local memory behavior and the existing D1 schema/migration are unchanged. No production migration was run.

## Implementation progress (updated 2026-11-15)

### Implemented in this branch (CI pending for the latest SHA)
- Mobile chat now performs owner-authenticated project-memory search across up to 10 owner projects before agentic generation.
- Search results are capped at 8 notes / 5,000 characters, and sensitive memory entries remain excluded by the server API.
- Memory retrieval is best-effort: if D1 or the search endpoint is unavailable, normal chat continues without memory context.
- The agentic system context explicitly labels retrieved notes as untrusted context, not instructions.
- Added mobile API tests for owner authentication, bounded inputs, server errors, and memory-context propagation.

### GitHub Developer Agent safety hardening
- Added a read-only GitHub repository/file preview helper. It performs GET requests only and refuses secret/key/keystore paths and oversized files.
- GitHub writes now require an explicit `approved: true`, the base SHA from the reviewed preview, and 1–20 explicit file changes.
- The write path rechecks the base SHA before creating a branch, rejects unsafe paths / traversal / secret files / duplicate paths / oversized changes, and never merges or deploys.
- Fixed the default repository target to this Badboy project.
- Added tests for read-only preview, explicit approval, stale previews, unsafe paths, and the write flow.

### Still not marked complete
- GitHub workflow still needs a user-facing preview/approval screen and live GitHub integration tests with a least-privilege token.
- Android phone-control actions, full wake-word background/device lifecycle verification, Telegram approval/background delivery, durable reminders/calendar, and a real on-device generative offline model remain incomplete or hardware/provider dependent.
- No physical Android device acceptance test has been performed in this change set.

## Implementation progress (2026-11-15, continued)

### Android Control
- Added a local Expo native module, `BadboyDevice`, with a strict allowlist for launching YouTube, Chrome, Gmail, Maps, WhatsApp, and Telegram.
- Added allowlisted Wi-Fi, Bluetooth, Sound, app-details, and notification settings shortcuts. No arbitrary package names or arbitrary Android intents are accepted.
- The Developer Task Engine now asks for explicit owner confirmation before app-launch or Settings actions and only returns allowlisted action IDs.
- Added unit tests for app/settings allowlists and approval-gated task planning.

### Local reminders and Calendar
- Added a native Android one-shot reminder scheduler using `AlarmManager.setAndAllowWhileIdle`, local SharedPreferences, a notification receiver, and reboot/package-replacement restoration.
- Reminder notification delivery is intentionally marked **inexact**; Android battery/doze policies may delay it. Exact-alarm privileges are not requested.
- Added notification permission checks and safe handling when permission is revoked.
- Calendar integration opens the system Calendar's event-insert draft; the user must review and tap Save. The app does not silently write to a calendar.
- Added reminder validation tests and Android native policy tests.

### Voice / Wake Word
- Wake-word startup now requests Android microphone permission and the native module independently enforces that permission before starting AudioRecord.
- Existing foreground microphone service and on-device TFLite wake-word model are preserved.
- Background/lock-screen reliability, OEM battery restrictions, process-death recovery, and microphone hand-off still require physical-device acceptance testing; not marked Device Verified.

### Telegram approval workflow
- Inbox polling now filters to private chats and no longer silently binds the last sender as the destination.
- The owner must explicitly bind one private chat in Settings before outbound messages can be sent.
- Only `/badboy ask ...` and `/badboy youtube ...` are recognized as remote requests; each requires an in-app owner approval tap. Other commands are ignored.
- This is still foreground/manual polling. No background Telegram worker or guaranteed delivery has been implemented.

### Offline AI status
- **Not implemented / blocked:** the repository contains an offline wake-word classifier, not a generative language model. No local LLM model weights or validated Android inference runtime are present. Do not describe wake-word inference as offline chat.
- A real offline chat implementation requires a compatible quantized LLM artifact, licensing review, model-size/RAM/performance benchmarks for target devices, a supported Android inference runtime, and fallback tests. No placeholder or network-backed fake is accepted.

### Verification still required
- Exact-head backend/mobile CI and Android APK build must pass after these changes.
- Android native module compilation/unit tests must pass in CI.
- Physical Android tests must verify app launching, Settings intents, notification permission, reminder firing after Doze/reboot, Calendar save flow, microphone permission, wake-word detection, app background/foreground, and OEM battery restrictions.
- Telegram must be tested with an owner-controlled bot and private chat; no production bot token is stored in this repository.
