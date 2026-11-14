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
