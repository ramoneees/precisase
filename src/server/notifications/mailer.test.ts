import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `PrismaEmailSuppressionChecker` (wired in by `createMailer` when
 * RESEND_API_KEY is set) imports the shared prisma client at module load
 * time. Mocking it here means the test file never has to establish a real
 * Postgres connection — same pattern as the health-route test.
 */
vi.mock("@/server/repositories/prisma-client", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { Resend } from "resend";
import {
  ConsoleMailer,
  createMailer,
  EmailAddressSuppressedError,
  MissingResendApiKeyError,
  ResendDeliveryError,
  ResendMailer,
} from "./mailer";
import type { EmailSuppressionChecker } from "@/server/services/notification-dispatch-service";

const TEST_OUTBOX_DIR = join(process.cwd(), ".dev-outbox-test");
const TEST_OUTBOX_PATH = join(TEST_OUTBOX_DIR, "emails.jsonl");

describe("ConsoleMailer", () => {
  afterEach(async () => {
    await rm(TEST_OUTBOX_DIR, { recursive: true, force: true });
  });

  it("appends a JSON line describing the email to the outbox file", async () => {
    const mailer = new ConsoleMailer(TEST_OUTBOX_PATH);

    await mailer.send({
      to: "author@example.com",
      subject: "Your post was approved",
      text: "Good news!",
    });

    const contents = await readFile(TEST_OUTBOX_PATH, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      to: "author@example.com",
      subject: "Your post was approved",
      text: "Good news!",
    });
    expect(typeof entry.sentAt).toBe("string");
  });

  it("appends multiple emails as separate JSON lines", async () => {
    const mailer = new ConsoleMailer(TEST_OUTBOX_PATH);

    await mailer.send({ to: "a@example.com", subject: "A", text: "a" });
    await mailer.send({ to: "b@example.com", subject: "B", text: "b" });

    const contents = await readFile(TEST_OUTBOX_PATH, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("ResendMailer", () => {
  it("throws MissingResendApiKeyError when constructed without an API key", () => {
    expect(() => new ResendMailer(undefined, "notificacoes@example.com")).toThrow(
      MissingResendApiKeyError,
    );
  });

  describe("send with suppression checker", () => {
    /**
     * Fake Resend client — records calls and never hits the network. The
     * `emails.send` signature matches what `ResendMailer.send` actually
     * calls: an object with `from`/`to`/`subject`/`text`/`html?`, returning
     * `{ error: null }` on success. Cast as `unknown` to satisfy the
     * `Resend` type on the constructor option.
     */
    function makeFakeResendClient() {
      const sendMock = vi.fn().mockResolvedValue({ error: null });
      const client = { emails: { send: sendMock } } as unknown as Resend;
      return { client, sendMock };
    }

    /** Builds a checker that returns the supplied status for any address. */
    function makeChecker(status: "bounced" | "complained" | null): EmailSuppressionChecker {
      return {
        checkStatus: vi.fn().mockResolvedValue(status),
      };
    }

    it("throws EmailAddressSuppressedError(bounced) and does NOT call Resend when the recipient is bounced", async () => {
      const { client, sendMock } = makeFakeResendClient();
      const mailer = new ResendMailer("re_test_key", "from@example.com", {
        client,
        checker: makeChecker("bounced"),
      });

      await expect(
        mailer.send({
          to: "bounced@example.com",
          subject: "S",
          text: "T",
        }),
      ).rejects.toThrow(EmailAddressSuppressedError);

      try {
        await mailer.send({ to: "bounced@example.com", subject: "S", text: "T" });
      } catch (err) {
        expect(err).toBeInstanceOf(EmailAddressSuppressedError);
        expect((err as EmailAddressSuppressedError).reason).toBe("bounced");
      }

      expect(sendMock).not.toHaveBeenCalled();
    });

    it("throws EmailAddressSuppressedError(complained) when the recipient has a complaint flag", async () => {
      const { client, sendMock } = makeFakeResendClient();
      const mailer = new ResendMailer("re_test_key", "from@example.com", {
        client,
        checker: makeChecker("complained"),
      });

      await expect(
        mailer.send({ to: "grumpy@example.com", subject: "S", text: "T" }),
      ).rejects.toMatchObject({ name: "EmailAddressSuppressedError", reason: "complained" });

      expect(sendMock).not.toHaveBeenCalled();
    });

    it("calls the underlying Resend send normally when the address is clean", async () => {
      const { client, sendMock } = makeFakeResendClient();
      const checker = makeChecker(null);
      const mailer = new ResendMailer("re_test_key", "from@example.com", {
        client,
        checker,
      });

      await mailer.send({ to: "ok@example.com", subject: "S", text: "T" });

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "from@example.com",
          to: "ok@example.com",
          subject: "S",
          text: "T",
        }),
      );
    });

    it("skips the suppression check entirely when no checker is configured", async () => {
      const { client, sendMock } = makeFakeResendClient();
      const mailer = new ResendMailer("re_test_key", "from@example.com", {
        client,
      });

      await mailer.send({ to: "ok@example.com", subject: "S", text: "T" });

      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("throws ResendDeliveryError WITHOUT the recipient email in the message when Resend returns an error (no PII leak into Notification.lastError)", async () => {
      // Resend returns `{ error: { message } }` when the API rejects the
      // send. The thrown error must NOT include `message.to` — that would
      // land in Notification.lastError via the dispatch loop, bypassing
      // the logger's PII redaction. Instead, a non-reversible hash of
      // the recipient is included for triage correlation.
      const { client } = makeFakeResendClient();
      // Override send to return an error this one time.
      (
        client.emails.send as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        error: { message: "rate limit exceeded", name: "rate_limit_error" },
      });
      const mailer = new ResendMailer("re_test_key", "from@example.com", {
        client,
      });

      const theTo = "specific-user@example.com";
      let caught: unknown;
      try {
        await mailer.send({ to: theTo, subject: "S", text: "T" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ResendDeliveryError);
      const err = caught as ResendDeliveryError;
      // The Resend API message is preserved (useful for triage).
      expect(err.resendMessage).toBe("rate limit exceeded");
      // The recipient email MUST NOT be in the message — that's the PII
      // leak this test guards against.
      expect(err.message).not.toContain(theTo);
      // A short hash IS included, for operator triage correlation.
      expect(err.recipientHash).toMatch(/^[a-f0-9]{12}$/);
      expect(err.message).toContain(err.recipientHash);
    });
  });
});

describe("createMailer", () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
  });

  it("returns a ConsoleMailer when RESEND_API_KEY is not set", () => {
    expect(createMailer()).toBeInstanceOf(ConsoleMailer);
  });

  it("returns a ResendMailer when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(createMailer()).toBeInstanceOf(ResendMailer);
  });
});
