import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";
import { Prisma } from "@/generated/prisma/client";

/**
 * Webhook route unit tests. The prisma client is mocked — no live DB.
 * Real svix signatures are computed against a known test secret in
 * `beforeEach`, so the route's `Webhook.verify` call exercises the real
 * svix verification path (the test catches a real signature-mismatch as a
 * test failure, not a silent mock-through).
 */
vi.mock("@/server/repositories/prisma-client", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/repositories/prisma-client";
import { POST } from "./route";

// svix's `Webhook` constructor base64-decodes the secret after stripping
// the `whsec_` prefix (per Standard Webhooks spec). Real Resend secrets
// are `whsec_<base64>` so this matches production format. Use a real
// base64 string here — a non-base64 placeholder throws at construction.
const TEST_SECRET = "whsec_X8qZ0kT3lZvM4yRq1nQ2wVpA5bC7dE9fG0hI2jK4lM6nO8pQ0rS==";
const WEBHOOK_URL = "http://localhost/api/webhooks/resend";

function signPayload(
  payload: Record<string, unknown>,
  msgId: string,
  timestamp: number,
): Record<string, string> {
  // svix's `Webhook.sign(msgId, timestamp: Date, payload: string)` returns
  // a single `svix-signature` value; svix also requires the matching
  // `svix-id` and `svix-timestamp` headers on the verify side. Build all
  // three here so `buildRequest` can spread them onto the Request.
  // The body string is signed exactly as the route will receive it (the
  // route calls `request.text()` then `Webhook.verify(rawBody, headers)`).
  const wh = new Webhook(TEST_SECRET);
  const body = JSON.stringify(payload);
  const signature = wh.sign(msgId, new Date(timestamp * 1000), body);
  return {
    "svix-id": msgId,
    "svix-timestamp": String(timestamp),
    "svix-signature": signature,
  };
}

function buildRequest(
  payload: Record<string, unknown>,
  msgId: string,
  timestamp: number,
  headersOverride?: Record<string, string>,
): Request {
  const body = JSON.stringify(payload);
  const headers = signPayload(payload, msgId, timestamp);
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
      "x-resend-request-id": msgId,
      ...(headersOverride ?? {}),
    },
    body,
  });
}

describe("POST /api/webhooks/resend", () => {
  const originalSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET;

  beforeEach(() => {
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1" } as never);
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    } else {
      process.env.RESEND_WEBHOOK_SIGNING_SECRET = originalSecret;
    }
  });

  it("sets emailBouncedAt on the matching user for email.bounced events", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "user@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_1", timestamp));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "user@example.com" },
        data: { emailBouncedAt: expect.any(Date) },
      }),
    );
  });

  it("sets emailComplainedAt on the matching user for email.complained events", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.complained",
      data: { email: "user@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_2", timestamp));

    expect(response.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "user@example.com" },
        data: { emailComplainedAt: expect.any(Date) },
      }),
    );
  });

  it("returns 401 and does not touch prisma when the signature is invalid", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "user@example.com" },
    };

    // Sign correctly, then tamper with the body so the signature no longer matches.
    const signedHeaders = signPayload(payload, "evt_3", timestamp);
    const tamperedBody = JSON.stringify({
      type: "email.bounced",
      data: { email: "attacker@example.com" },
    });

    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedHeaders,
        "x-resend-request-id": "evt_3",
      },
      body: tamperedBody,
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "invalid_signature" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 401 with invalid_signature (not 500) when the signing secret env var is missing — to avoid install-config fingerprinting", async () => {
    delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "user@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_4", timestamp));
    const body = await response.json();

    // 401 (not 500) so an attacker can't distinguish "unconfigured" from
    // "configured with a different secret" — both look like auth failure.
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "invalid_signature" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("no-ops on a duplicate request id (idempotency)", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "user@example.com" },
    };

    const first = await POST(buildRequest(payload, "evt_dup", timestamp));
    const second = await POST(buildRequest(payload, "evt_dup", timestamp));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // prisma.user.update should be called exactly once across both requests.
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and does not touch prisma for unknown event types", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.delivered",
      data: { email: "user@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_5", timestamp));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("still returns 200 when no user matches the bounced email (graceful no-op)", async () => {
    // Prisma throws a typed P2025 ("record not found") when `update`'s
    // `where` matches no row — that's the legitimate "user was deleted"
    // outcome we treat as a no-op (vs. a real DB error which must 500).
    vi.mocked(prisma.user.update).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("record not found", {
        code: "P2025",
        clientVersion: "0.0.0-test",
      }) as never,
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "ghost@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_6", timestamp));

    expect(response.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("returns 500 when the DB throws a non-P2025 error (does NOT silently swallow)", async () => {
    // A transient DB outage (connection drop, deadlock, OOM) must propagate
    // as 500 so Resend retries — swallowing it as "no user" would leave
    // the suppression flag NULL and let the next send go through.
    vi.mocked(prisma.user.update).mockRejectedValueOnce(
      new Error("connection terminated") as never,
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      data: { email: "user@example.com" },
    };

    const response = await POST(buildRequest(payload, "evt_7", timestamp));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "internal_error" });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("returns 200 and skips prisma when the payload is missing data.email (defensive against malformed Resend events)", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      type: "email.bounced",
      // No `data` field, or `data.email` missing — Resend shouldn't send
      // this today, but a future event variant might. We short-circuit
      // with 200 (no retry) rather than crashing on `where: { email: undefined }`.
      data: {},
    };

    const response = await POST(buildRequest(payload, "evt_8", timestamp));

    expect(response.status).toBe(200);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
