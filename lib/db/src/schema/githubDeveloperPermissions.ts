import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const githubDeveloperPermissions = pgTable("github_developer_permissions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  repository: text("repository").notNull(),
  branchPattern: text("branch_pattern").notNull(),
  actions: jsonb("actions").$type<string[]>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const githubDeveloperLockdowns = pgTable("github_developer_lockdowns", {
  ownerId: text("owner_id").primaryKey(),
  reason: text("reason").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
});
