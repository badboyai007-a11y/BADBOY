import assert from "node:assert/strict";
import test from "node:test";
import { handleAgentMemorySearchRequest } from "./agentMemory.ts";
import type { D1Database, D1PreparedStatement } from "./agentStorage.ts";

class MemoryD1 implements D1Database {
  sql = "";
  values: unknown[] = [];
  prepare(sql: string): D1PreparedStatement {
    this.sql = sql;
    const statement = {
      bind: (...values: unknown[]) => { this.values = values; return statement; },
      first: async () => null,
      all: async () => ({
        success: true,
        results: [{
          memory_id: "mem-1", owner_id: "owner-verified", project_id: "project-1",
          category: "preference", content: "আগের ফিচার অক্ষত রাখবে",
          source: "user", privacy_level: "private",
          created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z",
        }],
      }),
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return statement as D1PreparedStatement;
  }
}

function request(body: unknown, contentType = "application/json") {
  return new Request("https://worker.example/api/agent/memory/search", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("memory search returns owner-scoped private project memories but excludes sensitive memories", async () => {
  const db = new MemoryD1();
  const response = await handleAgentMemorySearchRequest(
    request({ projectId: "project-1", query: "ফিচার", limit: 10 }),
    "owner-verified",
    db,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    memories: [{
      id: "mem-1", projectId: "project-1", category: "preference",
      content: "আগের ফিচার অক্ষত রাখবে", source: "user",
      privacyLevel: "private", updatedAt: "2026-11-02T00:00:00.000Z",
    }],
    count: 1,
    sensitiveExcluded: true,
  });
  assert.match(db.sql, /project_id = \? AND owner_id = \? AND deleted_at IS NULL/);
  assert.match(db.sql, /privacy_level != 'sensitive'/);
  assert.deepEqual(db.values, ["project-1", "owner-verified", "ফিচার", 10]);
});

test("memory search rejects unsupported fields and malformed payloads", async () => {
  const db = new MemoryD1();
  assert.equal((await handleAgentMemorySearchRequest(request("{broken"), "owner-a", db)).status, 400);
  assert.equal((await handleAgentMemorySearchRequest(request({ projectId: "p", query: "q", includeSensitive: true }), "owner-a", db)).status, 400);
  assert.equal((await handleAgentMemorySearchRequest(request({ projectId: "p", query: "q", limit: 1.5 }), "owner-a", db)).status, 400);
  assert.equal(db.sql, "");
});

test("memory search rejects unsupported content types and missing storage", async () => {
  assert.equal((await handleAgentMemorySearchRequest(request({}, "text/plain"), "owner-a", new MemoryD1())).status, 415);
  assert.equal((await handleAgentMemorySearchRequest(request({ projectId: "p", query: "q" }), "owner-a", undefined)).status, 503);
});

test("memory search enforces a bounded request body and method", async () => {
  const db = new MemoryD1();
  assert.equal((await handleAgentMemorySearchRequest(new Request("https://worker.example", { method: "GET" }), "owner-a", db)).status, 405);
  assert.equal((await handleAgentMemorySearchRequest(request({ projectId: "p", query: "x".repeat(9000) }), "owner-a", db)).status, 413);
});
