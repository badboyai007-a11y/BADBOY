import { createAgentStorage, type D1Database } from "./agentStorage.ts";

const MAX_BODY_BYTES = 8 * 1024;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Owner-authenticated, read-only project-memory retrieval.
 * Sensitive memories are deliberately excluded; there is no client override.
 */
export async function handleAgentMemorySearchRequest(
  request: Request,
  ownerId: string,
  db: D1Database | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", error: "POST is required." }, 405);
  }
  if (!db) {
    return jsonResponse({ code: "MEMORY_STORAGE_UNAVAILABLE", error: "Project memory storage is not configured." }, 503);
  }
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ code: "UNSUPPORTED_MEDIA_TYPE", error: "Content-Type must be application/json." }, 415);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse({ code: "INVALID_REQUEST", error: "Request body could not be read." }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ code: "REQUEST_TOO_LARGE", error: "Memory search request is too large." }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ code: "INVALID_JSON", error: "Request body must be valid JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ code: "INVALID_REQUEST", error: "Request body must be an object." }, 400);
  }
  const value = body as Record<string, unknown>;
  if (typeof value.projectId !== "string" || typeof value.query !== "string") {
    return jsonResponse({ code: "INVALID_MEMORY_SEARCH", error: "projectId and query must be strings." }, 400);
  }
  if (Object.keys(value).some((key) => key !== "projectId" && key !== "query" && key !== "limit")) {
    return jsonResponse({ code: "INVALID_MEMORY_SEARCH", error: "Unsupported memory search fields." }, 400);
  }
  if (value.limit !== undefined && (typeof value.limit !== "number" || !Number.isInteger(value.limit))) {
    return jsonResponse({ code: "INVALID_MEMORY_SEARCH", error: "limit must be an integer." }, 400);
  }

  try {
    const storage = createAgentStorage(db);
    const memories = await storage.searchProjectMemory(
      value.projectId,
      ownerId,
      value.query,
      { limit: typeof value.limit === "number" ? value.limit : 20 },
    );
    return jsonResponse({
      memories: memories.map(({ memory_id, project_id, category, content, source, privacy_level, updated_at }) => ({
        id: memory_id,
        projectId: project_id,
        category,
        content,
        source,
        privacyLevel: privacy_level,
        updatedAt: updated_at,
      })),
      count: memories.length,
      sensitiveExcluded: true,
    });
  } catch (error) {
    return jsonResponse({
      code: "MEMORY_SEARCH_FAILED",
      error: error instanceof Error ? error.message : "Memory search failed.",
    }, 400);
  }
}
