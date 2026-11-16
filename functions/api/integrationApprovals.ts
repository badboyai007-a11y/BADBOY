/**
 * Persistent, one-time approvals for external integration side effects.
 * The caller must supply ownerId from authenticatePersonalOwner; never from request data.
 */
export interface ApprovalStatement {
  bind(...values: unknown[]): ApprovalStatement;
  run<T = unknown>(): Promise<{ success: boolean; meta?: { changes?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface ApprovalDatabase { prepare(query: string): ApprovalStatement; }
export type IntegrationProvider = "home_assistant" | "slack";

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Approval action must be JSON data.");
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function issueIntegrationApproval(
  db: ApprovalDatabase,
  ownerId: string,
  provider: IntegrationProvider,
  action: Record<string, unknown>,
  now = new Date(),
): Promise<{ approvalToken: string; expiresAt: string }> {
  if (!ownerId.trim() || ownerId.length > 256) throw new Error("Verified owner identity is required.");
  const actionHash = await sha256(canonicalize(action));
  const approvalToken = randomToken();
  const tokenHash = await sha256(approvalToken);
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const result = await db.prepare(
    `INSERT INTO integration_action_approvals
      (approval_id, owner_id, provider, action_hash, token_hash, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(crypto.randomUUID(), ownerId, provider, actionHash, tokenHash, expiresAt, now.toISOString()).run();
  if (!result.success || (result.meta?.changes ?? 0) !== 1) throw new Error("Owner approval could not be stored.");
  return { approvalToken, expiresAt };
}
export async function consumeIntegrationApproval(
  db: ApprovalDatabase,
  ownerId: string,
  provider: IntegrationProvider,
  action: Record<string, unknown>,
  approvalToken: string,
  now = new Date(),
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(approvalToken)) return false;
  const [actionHash, tokenHash] = await Promise.all([
    sha256(canonicalize(action)),
    sha256(approvalToken),
  ]);
  const row = await db.prepare(
    `UPDATE integration_action_approvals
       SET consumed_at = ?
     WHERE approval_id = (
       SELECT approval_id FROM integration_action_approvals
       WHERE owner_id = ? AND provider = ? AND action_hash = ? AND token_hash = ?
         AND consumed_at IS NULL AND expires_at > ?
       LIMIT 1
     )
     AND consumed_at IS NULL
     RETURNING approval_id`,
  ).bind(now.toISOString(), ownerId, provider, actionHash, tokenHash, now.toISOString()).first<{ approval_id: string }>();
  return Boolean(row?.approval_id);
}
