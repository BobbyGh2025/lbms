// ============================================================================
// LBMS Finance — Idempotency Helper
// ----------------------------------------------------------------------------
// Prevents duplicate financial mutations from double-submitted requests.
//
// Protocol:
//   1. Client sends an `Idempotency-Key` header on mutating finance requests.
//   2. Server hashes the request body + userId.
//   3. If a FinanceIdempotencyLog row exists for that key:
//      a. Same hash → return the cached response (no new journal created).
//      b. Different hash → reject with 409 Conflict.
//   4. If no row exists → execute the mutation, cache the response, return.
//
// If no `Idempotency-Key` header is present, the request proceeds normally
// WITHOUT idempotency protection. This is documented behaviour: the header
// is optional but recommended for all finance mutations.
//
// The idempotency record + financial mutation are NOT in the same database
// transaction. Rationale: the financial posting engine manages its own
// transactions (for atomicity of journal+entries). Wrapping the idempotency
// record in the same tx would require the engine to accept an external tx
// handle, coupling it to the HTTP layer. Instead, we use a "claim then
// execute" pattern:
//   - Claim the key (insert row with status "pending") — atomic via unique
//     constraint on `key`.
//   - If the claim fails with a unique violation, another request owns the
//     key → return cached result or 409.
//   - Execute the mutation.
//   - Update the row with the final response.
//
// This means under concurrent duplicate requests, exactly one wins the claim
// and the other gets the cached response. The worst case is: claim succeeds,
// mutation fails → the key is "used" with an error response. A retry with
// the same key returns the cached error (which is the desired behaviour —
// the client should use a new key for a genuine retry after fixing the
// input).
// ============================================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createHash } from "crypto";

const IDEMPOTENCY_TTL_HOURS = 24;
const HEADER_NAME = "idempotency-key";

export interface IdempotencyResult {
  /** If `replay` is true, `response` holds the cached NextResponse to return. */
  replay: boolean;
  /** If `replay` is false, `key` holds the stored key for later caching. */
  key?: string;
  /** The cached response (only set when `replay` is true). */
  response?: NextResponse;
}

/**
 * Check + claim an idempotency key. Call this BEFORE executing the mutation.
 * If `replay` is true, return the cached `response` immediately.
 * If `replay` is false, call `cacheResponse()` after the mutation succeeds.
 */
export async function checkIdempotency(
  req: Request,
  userId: string,
  body: unknown,
): Promise<IdempotencyResult> {
  const key = req.headers.get(HEADER_NAME);
  if (!key) {
    // No key → no idempotency protection. Documented behaviour.
    return { replay: false };
  }

  const bodyHash = hashPayload({ userId, body });
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  // Try to claim the key by inserting a row. If it already exists, we have
  // a replay or a conflict.
  try {
    await db.financeIdempotencyLog.create({
      data: {
        key,
        userId,
        responseHash: bodyHash,
        responseBody: "", // pending — filled after mutation
        statusCode: 0, // pending
        expiresAt,
      },
    });
    // Claim succeeded — this request owns the key. Proceed to mutation.
    return { replay: false, key };
  } catch {
    // Claim failed — a row with this key already exists. Determine if it's
    // a replay (same hash) or a conflict (different hash).
  }

  const existing = await db.financeIdempotencyLog.findUnique({
    where: { key },
  });
  if (!existing) {
    // Row vanished between the insert failure and the lookup (expired + pruned).
    // Treat as no replay — let the mutation proceed. Edge case.
    return { replay: false, key };
  }

  if (existing.responseHash !== bodyHash) {
    // Same key, different payload → CONFLICT.
    return {
      replay: true,
      response: NextResponse.json(
        {
          error:
            "Idempotency key was already used for a different request. Use a new key for a different payload.",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 },
      ),
    };
  }

  // Same key + same payload → REPLAY the cached response.
  if (existing.statusCode === 0 || !existing.responseBody) {
    // The original request is still "pending" (hasn't finished yet). This
    // happens under true concurrency — the first request is still executing.
    // Return a 409 to prevent a duplicate; the client should retry.
    return {
      replay: true,
      response: NextResponse.json(
        {
          error:
            "A request with this idempotency key is currently being processed. Retry shortly.",
          code: "IDEMPOTENCY_PENDING",
        },
        { status: 409 },
      ),
    };
  }

  // Replay the cached response.
  let cachedBody: unknown;
  try {
    cachedBody = JSON.parse(existing.responseBody);
  } catch {
    cachedBody = existing.responseBody;
  }
  return {
    replay: true,
    response: NextResponse.json(cachedBody, { status: existing.statusCode }),
  };
}

/**
 * Cache the response for an idempotency key. Call this AFTER the mutation
 * succeeds (or fails with a client error — cache those too so retries with
 * the same key return the same error).
 */
export async function cacheIdempotencyResponse(
  key: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  const responseBody = typeof body === "string" ? body : JSON.stringify(body);
  try {
    await db.financeIdempotencyLog.update({
      where: { key },
      data: {
        statusCode,
        responseBody,
      },
    });
  } catch {
    // If the update fails (row pruned, etc.), the mutation already succeeded.
    // The next request with this key will simply re-execute. Acceptable.
  }
}

/** SHA-256 hash of { userId, body } for idempotency comparison. */
function hashPayload(payload: { userId: string; body: unknown }): string {
  const json = JSON.stringify({
    userId: payload.userId,
    body: payload.body,
  });
  return createHash("sha256").update(json).digest("hex");
}

/** Prune expired idempotency records. Call periodically (e.g. via cron). */
export async function pruneExpiredIdempotencyRecords(): Promise<number> {
  const result = await db.financeIdempotencyLog.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
