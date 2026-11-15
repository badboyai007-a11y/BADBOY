# GitHub Owner Developer Gateway

The API server exposes the owner-scoped GitHub developer gateway under `/api/github`.

## Owner setup

1. Create a GitHub OAuth App for the Badboy API.
2. Set its Authorization callback URL to the exact value configured in `GITHUB_OAUTH_CALLBACK_URL`, for example `https://api.example.com/api/github/oauth/callback`.
3. Configure the following server-only environment variables:
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `GITHUB_OAUTH_CALLBACK_URL`
   - `GITHUB_OWNER_IDS`: comma-separated numeric GitHub account IDs; do not use a display name or email as the owner identifier.
   - `GITHUB_SESSION_SECRET`: at least 32 random bytes, encoded as a hex string.
   - `GITHUB_TOKEN_ENCRYPTION_KEY`: base64 encoding of exactly 32 random bytes.
   - `APP_ORIGIN`: the exact HTTPS origin of the API server hosting the Owner Control Center. The browser dashboard is served by the API itself so its HttpOnly session cookie remains first-party; do not point this at a separate cross-site frontend.
   - `DATABASE_URL`
4. Apply the database schema before enabling the gateway. The Drizzle schema is in `lib/db/src/schema/githubDeveloper.ts`; the equivalent SQL is in `lib/db/migrations/0001_github_developer_security.sql`. Use the repository's normal reviewed database migration process. Do not run a force schema push against production.
5. Open `https://<api-host>/api/github/controls/owner-control` and choose **Continue with GitHub**. The OAuth callback returns to this first-party dashboard.

The OAuth App requests `read:user repo` so the authenticated owner's accessible private repositories can be checked and acted on. GitHub access tokens are encrypted at rest with AES-256-GCM and are never returned by the API. The numeric GitHub account ID allowlist is checked on callback and on every session lookup.

## Owner Control Center

The responsive first-party dashboard is served at `/api/github/controls/owner-control`. It provides Owner sign-in, temporary repository/branch/action grants, grant revocation, emergency lockdown/release, audit history, and sign-out. It uses a per-response CSP nonce, a restrictive content security policy, no-store caching, same-origin requests, and explicit confirmations for every permission/lockdown action.

## Endpoints

- `GET /api/github/oauth/start`: begin OAuth with signed, one-use state.
- `GET /api/github/oauth/callback`: exchange the authorization code, verify the GitHub account, and create an HttpOnly session.
- `GET /api/github/me`: return the authenticated owner identity (never the access token).
- `GET /api/github/repositories/:owner/:repo/access`: check read and write permission using the owner's token.
- `GET /api/github/repositories/:owner/:repo/contents?path=...&ref=...`: read a repository file.
- `POST /api/github/approvals`: the owner-facing approval action accepts `{ action, request }`, derives the exact canonical request hash and resource on the server, then issues a 120-second, single-use approval bound to owner ID, action, resource and payload.
- `POST /api/github/repositories/:owner/:repo/branches`: create a branch only after a matching approval.
- `POST /api/github/repositories/:owner/:repo/pull-requests/draft`: create a Draft PR only after a matching approval.
- `POST /api/github/repositories/:owner/:repo/workflows/dispatch`: dispatch only allowlisted workflows after a matching approval.
- `POST /api/github/oauth/logout`: revoke the current server-side session.

All state-changing endpoints require the exact configured `Origin` header and the HttpOnly owner session. The owner UI must display the proposed request and call the approvals endpoint only after an explicit owner confirmation. Each approval is bound to one owner, action, resource and exact canonical request hash; consumption is an atomic database update, so it cannot be replayed. Audit rows record approval issuance and consumption/rejection.

## Hard boundaries

The gateway intentionally has no merge, auto-merge, ready-for-review, repository permission-management, secret-management, or production-deploy endpoint. Draft PR creation always sends `draft: true`. Repository access is checked against the authenticated owner's GitHub permissions for each operation. The API passes the same owner's OAuth token to GitHub; it does not fall back to a shared `GITHUB_TOKEN`.

Health and assistant routes remain mounted as before. Offline AI is not part of this change.
