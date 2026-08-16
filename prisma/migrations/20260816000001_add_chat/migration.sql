-- Create conversations table
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interest_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "participant_a_id" UUID NOT NULL,
    "participant_b_id" UUID NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create messages table
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_interest_id_key" UNIQUE ("interest_id");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");
ALTER TABLE "messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");

-- Foreign keys
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_interest_id_fkey"
    FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE RESTRICT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_a_id_fkey"
    FOREIGN KEY ("participant_a_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_participant_b_id_fkey"
    FOREIGN KEY ("participant_b_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT;

-- Indexes
CREATE INDEX "conversations_post_id_idx" ON "conversations"("post_id");
CREATE INDEX "conversations_participant_a_id_updated_at_idx" ON "conversations"("participant_a_id", "updated_at");
CREATE INDEX "conversations_participant_b_id_updated_at_idx" ON "conversations"("participant_b_id", "updated_at");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");
