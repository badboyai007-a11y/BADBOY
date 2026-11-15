import { pgTable, text, timestamp, bigserial } from "drizzle-orm/pg-core";

export const githubDeveloperSessions = pgTable("github_developer_sessions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  ownerLogin: text("owner_login").notNull(),
  ownerName: text("owner_name"),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  tokenTag: text("token_tag").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const githubDeveloperApprovals = pgTable("github_developer_approvals", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  requestHash: text("request_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const githubDeveloperAuditLogs = pgTable("github_developer_audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ownerId: text("owner_id").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  approvalId: text("approval_id"),
  outcome: text("outcome").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
