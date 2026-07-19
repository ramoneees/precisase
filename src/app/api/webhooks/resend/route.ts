/**
 * Resend webhook receiver — handles `email.bounced` / `email.complained`
 * events from Resend (https://resend.com/docs/dashboard/webhooks), setting
 * `User.emailBouncedAt` / `User.emailComplainedAt` so `ResendMailer.send`
 * (T22) can short-circuit future sends without burning a Resend API call.
 *
 * Why a webhook and not bounce parsing: Resend's webhook is signed with
 * svix (https://github.com/svix/svix-webhooks) — the signature is verified
 * here BEFORE any DB write, so a forged bounce report that would suppress
 * a legitimate recipient can't get through without the signing secret.
 *
 * Why no DB-side dedupe table for MVP volume: Resend retries on non-2xx
 * with a bounded window (a few hours). An in-memory LRU (cap 1000, 1h TTL)
 * covers the retry window without a write-heavy `processed_webhooks` table
 * that we'd then need to GC. If volume grows or the worker restarts more
 * often than hourly, swap this for a real dedupe table — the API is the
 * same (replace `seenRequestIds.has(id)` with `repo.wasProcessed(id)`).
 *
 * Returns 200 on every successfully-processed payload (including unknown
 * event types — we don't want Resend to retry forever on a new event
 * variant we haven't coded for yet; we just log it).
 */

import { Webhook } from "svix";
import { logger } from "@/server/logger";
import { prisma } from "@/server/repositories/prisma-client";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reason attached to a `emailBouncedAt`/`emailComplainedAt` update. */
type SuppressionReason = "bounced" | "complained";

/** Shape of the verified Resend webhook payload (subset we read). */
interface ResendWebhookPayload {
  type: string;
  data: {
    email: string;
  };
}

/** X-Resend-Request-Id — used for idempotency replay protection. */
const RESEND_REQUEST_ID_HEADER = "x-resend-request-id";

/**
 * In-memory LRU-ish dedupe of seen `X-Resend-Request-Id` values. Each entry
 * is stamped with the time it was first seen; entries older than 1h are
 * evicted lazily on read. Cap is 1000 entries — once full, new pushes
 * drop the oldest, which is safe (worst case: a retried webhook is
 * processed twice, setting `emailBouncedAt = now()` twice — idempotent).
 */
const SEEN_REQUEST_TTL_MS = 60 * 60 * 1000;
const SEEN_REQUEST_CAP = 1000;
const seenRequestIds = new Map<string, number>();

function wasRequestIdSeen(id: string | null): boolean {
  if (!id) return false;
  const now = Date.now();
  const seenAt = seenRequestIds.get(id);
  if (seenAt === undefined) return false;
  if (now - seenAt > SEEN_REQUEST_TTL_MS) {
    seenRequestIds.delete(id);
    return false;
  }
  return true;
}

function markRequestIdSeen(id: string | null): void {
  if (!id) return;
  if (seenRequestIds.size >= SEEN_REQUEST_CAP) {
    // Evict the oldest entry (Map preserves insertion order in JS).
    const oldest = seenRequestIds.keys().next().value;
    if (typeof oldest === "string") seenRequestIds.delete(oldest);
  }
  seenRequestIds.set(id, Date.now());
}

/**
 * Applies the suppression flag for the given reason, returning the user id
 * updated (or null if no user matched the email — happens if the recipient
 * was deleted/anonymized between the original send and the bounce report).
 *
 * Throws on anything other than "user not found" — a transient DB outage
 * (connection drop, deadlock, serialization failure, OOM) must NOT be
 * swallowed as "no user", because that would (a) return 200 here so Resend
 * doesn't retry, and (b) leave the suppression flag NULL so the next send
 * to a known-bouncing address goes through anyway. Only Prisma's `P2025`
 * (record not found) is treated as the legitimate "no user" outcome.
 */
async function applySuppression(
  email: string,
  reason: SuppressionReason,
): Promise<string | null> {
  const data =
    reason === "bounced"
      ? { emailBouncedAt: new Date() }
      : { emailComplainedAt: new Date() };
  try {
    const updated = await prisma.user.update({
      where: { email },
      data,
      select: { id: true },
    });
    return updated.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      // Record not found — legitimate "user was deleted/anonymized".
      return null;
    }
    // Any other DB error propagates — the POST handler converts to a 500
    // so Resend retries on the next poll.
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    // Config error — the webhook can't be verified without a secret. Log
    // the specific reason for ops; return 401 (not 500) so the response
    // shape is indistinguishable from a bad-signature response. A 500
    // would let an unauthenticated attacker fingerprint whether the
    // install is configured (500=unconfigured vs 401=configured).
    logger.error({
      module: "resend-webhook",
      event: "missing_signing_secret",
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn({
      module: "resend-webhook",
      event: "missing_svix_headers",
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const rawBody = await request.text();

  let payload: ResendWebhookPayload;
  try {
    payload = new Webhook(signingSecret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as ResendWebhookPayload;
  } catch {
    logger.warn({
      module: "resend-webhook",
      event: "signature_mismatch",
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Idempotency: Resend retries on non-2xx, and may also redeliver from the
  // dashboard. Processing the same `X-Resend-Request-Id` twice is safe
  // (it's just a re-write of the same timestamp column) but we skip the
  // DB round-trip when we've already seen the ID.
  const requestId = request.headers.get(RESEND_REQUEST_ID_HEADER) ?? svixId;
  if (wasRequestIdSeen(requestId)) {
    logger.info({
      module: "resend-webhook",
      event: "duplicate_request_id_skipped",
    });
    return Response.json({ ok: true }, { status: 200 });
  }
  markRequestIdSeen(requestId);

  // Defensive: Resend payloads always include `data.email` for bounce/
  // complaint events today, but a future event variant (or a malformed
  // report) might not. Missing email means we can't apply suppression
  // anyway — short-circuit with 200 (so Resend doesn't retry) and a log.
  const bounceEmail = payload.data?.email;
  if (!bounceEmail || typeof bounceEmail !== "string") {
    logger.warn({
      module: "resend-webhook",
      event: "missing_email_in_payload",
      type: payload.type,
    });
    return Response.json({ ok: true }, { status: 200 });
  }

  try {
    switch (payload.type) {
      case "email.bounced": {
        const userId = await applySuppression(bounceEmail, "bounced");
        if (userId === null) {
          logger.info({
            module: "resend-webhook",
            event: "email_bounced_unknown_user",
          });
        } else {
          // No email in the log — PII. user_id is fine (it's a UUID).
          logger.info({
            module: "resend-webhook",
            event: "email_bounced",
            user_id: userId,
          });
        }
        break;
      }
      case "email.complained": {
        const userId = await applySuppression(bounceEmail, "complained");
        if (userId === null) {
          logger.info({
            module: "resend-webhook",
            event: "email_complained_unknown_user",
          });
        } else {
          logger.info({
            module: "resend-webhook",
            event: "email_complained",
            user_id: userId,
          });
        }
        break;
      }
      default: {
        logger.info({
          module: "resend-webhook",
          event: "unknown_type",
          type: payload.type,
        });
      }
    }
  } catch (error) {
    // A DB error from applySuppression (anything other than P2025) —
    // 500 so Resend retries. Don't include the error message in the
    // response body (could leak DB internals); the structured log has it.
    logger.error({
      module: "resend-webhook",
      event: "suppression_write_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
