-- AlterTable: email bounce/complaint suppression flags (T20). Set by the
-- Resend webhook (T21) on email.bounced / email.complained events; read by
-- ResendMailer.send (T22) to short-circuit sends before hitting the API.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_bounced_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_complained_at" TIMESTAMPTZ;
