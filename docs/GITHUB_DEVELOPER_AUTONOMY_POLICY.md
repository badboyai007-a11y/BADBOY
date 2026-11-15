# Autonomous Developer and Owner Permission Policy

This document describes the owner-controlled permission layer added alongside the GitHub Developer Gateway.

## Owner controls API

All endpoints are under `/api/github/controls` and require the authenticated allowlisted Owner session.

- `GET /permissions`: list this Owner's grants.
- `POST /permissions`: grant a repository, branch pattern, allowed action list, and expiry.
- `DELETE /permissions/:permissionId`: revoke one grant.
- `POST /lockdown`: immediately block new approval issuance and consumption.
- `DELETE /lockdown`: release the emergency lock (Owner action).
- `GET /audit?limit=100`: inspect recent Owner-scoped audit events.

Permission grants accept only `create-branch`, `create-draft-pr`, and `dispatch-workflow`. Branch patterns may be exact, end in `/*`, or be `*`. Grant expiry is between 60 seconds and 30 days. No branch prefix is privileged or required.

## Enforcement

The database trigger validates active Owner scope when an approval is issued and again when it is consumed. It checks Owner ID, exact repository, branch pattern, action, expiry, revocation and emergency lockdown. A pending approval therefore stops working after permission revocation or lockdown. Approvals remain short-lived and single-use, and are still bound to the exact request hash by the existing gateway.

Audit records are append-only at the database trigger level for the configured application role. Database superusers can still alter database objects or records; this is not cryptographic tamper-proof storage. For stronger forensic guarantees, export audit events to an independently administered append-only/WORM destination.

## Hard boundaries

- Coding, debugging, refactoring, test and build work remain unrestricted by branch naming conventions.
- GitHub write operations still require explicit, exact, one-time Owner approval.
- Owner grants are an additional scope boundary, not a substitute for per-action approval.
- Developer cannot grant or approve its own permissions.
- No merge, auto-merge, production deployment, repository permission administration, or secret disclosure endpoint is introduced.
- Emergency lockdown blocks the existing approval issuance and consumption path.
- Offline AI remains excluded.

## Owner Control Center

A responsive first-party Owner Control Center is served at `/api/github/controls/owner-control`. It supports Owner sign-in, temporary scoped grants, revocation, emergency lockdown/release, audit review and session sign-out. The dashboard is served from the API origin so the HttpOnly session cookie remains first-party; configure `APP_ORIGIN` to that exact API origin.

## Remaining integration work

Generic arbitrary-file commit/push orchestration, automatic rollback, a production multi-agent runtime, dependency intelligence/scanning, cost accounting and intelligent model routing are not implemented by this gateway. Do not represent them as complete until implemented and tested.
