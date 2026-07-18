import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConsoleMailer, createMailer, MissingResendApiKeyError, ResendMailer } from "./mailer";

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
