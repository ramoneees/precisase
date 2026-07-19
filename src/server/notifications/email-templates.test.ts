import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNotificationEmail } from "./email-templates";
import type { NotificationRecord } from "@/server/services/notification-dispatch-service";

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "notif-1",
    recipientId: "user-1",
    recipientEmail: "ana@example.com",
    recipientDisplayName: "Ana",
    recipientLocale: "pt-PT",
    postId: "post-1",
    type: "post_approved",
    channel: "email",
    payload: { postId: "post-1", title: "Preciso de um sofá" },
    status: "queued",
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("buildNotificationEmail", () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = "https://precisase.example";
  });

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
  });

  it("builds a post_approved email with title and a link back to the post", async () => {
    const email = await buildNotificationEmail(
      makeNotification({
        type: "post_approved",
        payload: { postId: "post-1", title: "Preciso de um sofá" },
      }),
    );

    expect(email.subject).toContain("Preciso de um sofá");
    expect(email.text).toContain("Ana");
    expect(email.text).toContain("Preciso de um sofá");
    expect(email.text).toContain("https://precisase.example/posts/post-1");
  });

  it("builds a post_rejected email that includes the rejection reason", async () => {
    const email = await buildNotificationEmail(
      makeNotification({
        type: "post_rejected",
        payload: {
          postId: "post-1",
          title: "Preciso de um sofá",
          reason: "Falta informação de contacto.",
        },
      }),
    );

    expect(email.text).toContain("Falta informação de contacto.");
  });

  it("builds a post_closed email defensively even with a minimal payload", async () => {
    const email = await buildNotificationEmail(
      makeNotification({
        type: "post_closed",
        payload: { postId: "post-1", title: "Preciso de um sofá" },
      }),
    );

    expect(email.subject).toContain("Preciso de um sofá");
    expect(email.text).toContain("https://precisase.example/posts/post-1");
  });

  it("builds an interest_received email and includes the optional message when present", async () => {
    const email = await buildNotificationEmail(
      makeNotification({
        type: "interest_received",
        payload: {
          postId: "post-1",
          title: "Preciso de um sofá",
          interestedUserId: "user-2",
          message: "Tenho um sofá disponível!",
        },
      }),
    );

    expect(email.text).toContain("Tenho um sofá disponível!");
  });

  it("omits the message line for interest_received when no message was provided", async () => {
    const email = await buildNotificationEmail(
      makeNotification({
        type: "interest_received",
        payload: { postId: "post-1", title: "Preciso de um sofá", interestedUserId: "user-2" },
      }),
    );

    expect(email.text).not.toContain("Mensagem:");
  });

  it("localizes the email based on recipientLocale (en)", async () => {
    const email = await buildNotificationEmail(
      makeNotification({ recipientLocale: "en", type: "post_approved" }),
    );

    expect(email.subject).toBe('Your post "Preciso de um sofá" was approved');
  });

  it("localizes the email based on recipientLocale (pt-BR)", async () => {
    const email = await buildNotificationEmail(
      makeNotification({ recipientLocale: "pt-BR", type: "post_approved" }),
    );

    expect(email.subject).toBe('Seu post "Preciso de um sofá" foi aprovado');
  });

  it("falls back to the default locale for an unrecognized locale", async () => {
    const email = await buildNotificationEmail(
      makeNotification({ recipientLocale: "fr-FR", type: "post_approved" }),
    );

    // pt-PT is the app's default locale (src/i18n/routing.ts).
    expect(email.subject).toBe('O teu post "Preciso de um sofá" foi aprovado');
  });

  it("falls back to a generic title when the payload is missing one", async () => {
    const email = await buildNotificationEmail(
      makeNotification({ type: "post_approved", payload: { postId: "post-1" } }),
    );

    expect(email.subject).toBeTruthy();
    expect(email.text).toBeTruthy();
  });

  describe("password_reset", () => {
    it("builds a pt-PT password_reset email with the reset URL and displayName", async () => {
      const email = await buildNotificationEmail(
        makeNotification({
          recipientLocale: "pt-PT",
          type: "password_reset",
          payload: {
            displayName: "Ana",
            resetUrl: "https://precisase.example/pt-PT/reset-password?token=abc123",
          },
        }),
      );

      expect(email.text).toContain("Ana");
      expect(email.text).toContain(
        "https://precisase.example/pt-PT/reset-password?token=abc123",
      );
    });

    it("builds an en password_reset email with the reset URL and displayName", async () => {
      const email = await buildNotificationEmail(
        makeNotification({
          recipientLocale: "en",
          type: "password_reset",
          payload: {
            displayName: "Ana",
            resetUrl: "https://precisase.example/en/reset-password?token=abc123",
          },
        }),
      );

      expect(email.subject).toBe("Reset your password");
      expect(email.text).toContain("Ana");
      expect(email.text).toContain("https://precisase.example/en/reset-password?token=abc123");
    });

    it("builds a pt-BR password_reset email with the reset URL and displayName", async () => {
      const email = await buildNotificationEmail(
        makeNotification({
          recipientLocale: "pt-BR",
          type: "password_reset",
          payload: {
            displayName: "Ana",
            resetUrl: "https://precisase.example/pt-BR/reset-password?token=abc123",
          },
        }),
      );

      expect(email.subject).toBe("Redefinir sua senha");
      expect(email.text).toContain("Ana");
      expect(email.text).toContain(
        "https://precisase.example/pt-BR/reset-password?token=abc123",
      );
    });

    it("falls back to a generic greeting when displayName is empty (no crash)", async () => {
      const email = await buildNotificationEmail(
        makeNotification({
          recipientLocale: "en",
          type: "password_reset",
          payload: {
            displayName: "",
            resetUrl: "https://precisase.example/en/reset-password?token=abc123",
          },
        }),
      );

      expect(email.text).toContain("Hi there,");
      expect(email.text).toContain("https://precisase.example/en/reset-password?token=abc123");
    });

    it("mentions the 1-hour expiry", async () => {
      const email = await buildNotificationEmail(
        makeNotification({
          recipientLocale: "en",
          type: "password_reset",
          payload: {
            displayName: "Ana",
            resetUrl: "https://precisase.example/en/reset-password?token=abc123",
          },
        }),
      );

      expect(email.text).toContain("1 hour");
    });
  });
});
