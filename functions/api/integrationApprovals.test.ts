import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeIntegrationApproval,
  issueIntegrationApproval,
  type ApprovalDatabase,
  type ApprovalStatement,
} from "./integrationApprovals.ts";

type StoredApproval = {
  approval_id: string;
  owner_id: string;
  provider: string;
  action_hash: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
};

class MemoryApprovalDatabase implements ApprovalDatabase {
  row: StoredApproval | null = null;

  prepare(query: string): ApprovalStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        values = args;
        return statement;
      },
      run: async () => {
        assert.match(query, /INSERT INTO integration_action_approvals/);
        const [approval_id, owner_id, provider, action_hash, token_hash, expires_at] = values as string[];
        this.row = {
          approval_id,
          owner_id,
          provider,
          action_hash,
          token_hash,
          expires_at,
          consumed_at: null,
        };
        return { success: true, meta: { changes: 1 } };
      },
      first: async <T>() => {
        assert.match(query, /UPDATE integration_action_approvals/);
        const [consumedAt, ownerId, provider, actionHash, tokenHash, now] = values as string[];
        const row = this.row;
        if (!row || row.owner_id !== ownerId || row.provider !== provider ||
          row.action_hash !== actionHash || row.token_hash !== tokenHash ||
          row.consumed_at !== null || row.expires_at <= now) return null;
        row.consumed_at = consumedAt;
        return { approval_id: row.approval_id } as T;
      },
    };
    return statement;
  }
}

const owner = "verified-owner-123";
const action = { domain: "light", service: "turn_on", entityId: "light.office" };
const now = new Date("2026-11-16T12:00:00.000Z");

test("approval is owner/provider/action scoped and can be consumed only once", async () => {
  const db = new MemoryApprovalDatabase();
  const issued = await issueIntegrationApproval(db, owner, "home_assistant", action, now);
  assert.equal(issued.expiresAt, "2026-11-16T12:01:00.000Z");
  assert.equal(db.row?.owner_id, owner);
  assert.notEqual(db.row?.token_hash, issued.approvalToken);

  assert.equal(await consumeIntegrationApproval(db, "other-owner", "home_assistant", action, issued.approvalToken, now), false);
  assert.equal(await consumeIntegrationApproval(db, owner, "slack", action, issued.approvalToken, now), false);
  assert.equal(await consumeIntegrationApproval(db, owner, "home_assistant", { ...action, service: "turn_off" }, issued.approvalToken, now), false);
  assert.equal(await consumeIntegrationApproval(db, owner, "home_assistant", action, "invalid-token", now), false);
  assert.equal(await consumeIntegrationApproval(db, owner, "home_assistant", action, issued.approvalToken, now), true);
  assert.equal(await consumeIntegrationApproval(db, owner, "home_assistant", action, issued.approvalToken, now), false);
});

test("approval expires after its 60-second lifetime", async () => {
  const db = new MemoryApprovalDatabase();
  const issued = await issueIntegrationApproval(db, owner, "slack", { channel: "C123456", text: "hello" }, now);
  const afterExpiry = new Date(now.getTime() + 60_001);
  assert.equal(await consumeIntegrationApproval(db, owner, "slack", { channel: "C123456", text: "hello" }, issued.approvalToken, afterExpiry), false);
});

test("approval issuance rejects an empty verified owner identity", async () => {
  const db = new MemoryApprovalDatabase();
  await assert.rejects(issueIntegrationApproval(db, " ", "slack", { channel: "C123456", text: "hello" }, now));
});
