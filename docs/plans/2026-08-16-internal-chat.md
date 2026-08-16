# Internal Chat Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add 1:1 in-platform chat between users who expressed interest in a post and the post author, so they never need to share phone/email/WhatsApp.

**Architecture:** Two new Prisma models (`Conversation`, `Message`) linked to `Interest`. Two new port-driven services (`ConversationService`, `MessageService`) following the existing `InterestService` pattern. Polling-based UI (5s interval) with Server Actions. Conversation archived (not deleted) when post closes. Moderator access is feature-flagged (removable). Unread badge in header for both chat and moderation queue.

**Tech Stack:** Prisma, TypeScript, Next.js App Router, next-intl, Vitest, Server Actions.

**Key decisions from Ramon:**
- D1: Moderator access to chat content is behind a feature flag (`chat.moderator_read_access`), default OFF. Messages are archived (not deleted) for potential authority requests.
- D2: Notification bell (unread badge) in header — covers both unread chat messages AND pending moderation posts.
- D3: Polling every 5s is sufficient. No SSE/websocket.
- D4: Conversations archived when post closes. Anonymization/encryption deferred.

---

## Task 1: Prisma schema — Conversation and Message models

**Objective:** Add `Conversation` and `Message` models to `prisma/schema.prisma`.

**Files:**
- Modify: `prisma/schema.prisma` (append before `SiteConfig`)
- Create: `prisma/migrations/20260816000001_add_chat/migration.sql`

**Step 1: Add models to schema.prisma**

Append before `model SiteConfig`:

```prisma
/// 1:1 conversation between a post author and an interested user.
/// Created automatically when an Interest is expressed (FR09).
/// Archived (not deleted) when the Post is closed — content retained for
/// potential authority requests (D1). Moderators can read content only when
/// the `chat.moderator_read_access` feature flag is ON (D1).
model Conversation {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  interestId    String   @unique @map("interest_id") @db.Uuid
  postId        String   @map("post_id") @db.Uuid
  participantAId String  @map("participant_a_id") @db.Uuid
  participantBId String  @map("participant_b_id") @db.Uuid
  archived       Boolean  @default(false)
  archivedAt     DateTime? @map("archived_at") @db.Timestamptz()
  lastMessageAt  DateTime? @map("last_message_at") @db.Timestamptz()
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  interest      Interest @relation(fields: [interestId], references: [id])
  post          Post     @relation(fields: [postId], references: [id])
  participantA  User     @relation("ConversationParticipantA", fields: [participantAId], references: [id])
  participantB  User     @relation("ConversationParticipantB", fields: [participantBId], references: [id])
  messages      Message[]

  @@index([postId])
  @@index([participantAId, updatedAt])
  @@index([participantBId, updatedAt])
  @@map("conversations")
}

/// A chat message within a Conversation. Content is plaintext (max 4000 chars).
/// Not encrypted at rest in MVP (D4 — encryption deferred). Archived with the
/// parent Conversation; never hard-deleted unless the user's account is
/// GDPR-deleted (handled by AccountDeletionService expansion).
model Message {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  conversationId String  @map("conversation_id") @db.Uuid
  senderId       String   @map("sender_id") @db.Uuid
  content        String
  readAt         DateTime? @map("read_at") @db.Timestamptz()
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  conversation  Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender        User         @relation("MessageSender", fields: [senderId], references: [id])

  @@index([conversationId, createdAt])
  @@index([senderId])
  @@map("messages")
}
```

**Step 2: Add relations to existing models**

In `model User`, add:
```prisma
  conversationsA   Conversation[] @relation("ConversationParticipantA")
  conversationsB   Conversation[] @relation("ConversationParticipantB")
  sentMessages     Message[]      @relation("MessageSender")
```

In `model Post`, add:
```prisma
  conversations    Conversation[]
```

In `model Interest`, add:
```prisma
  conversation     Conversation?
```

**Step 3: Create migration SQL**

Create `prisma/migrations/20260816000001_add_chat/migration.sql`:

```sql
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
```

**Step 4: Add lock file**

Create `prisma/migrations/20260816000001_add_chat/migration_lock.toml`:
```toml
provider = "postgresql"
```
(Or copy from existing migration_lock.toml — it should already exist at the migration_lock level.)

**Step 5: Verify**

Run: `cd ~/dev/precisase && npx prisma validate`
Expected: "The schema is valid."

Run: `npx prisma generate`
Expected: Generated Prisma Client includes Conversation and Message types.

**Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260816000001_add_chat/
git commit -m "feat(chat): add Conversation and Message models to schema"
```

---

## Task 2: NotificationType enum — add chat message type

**Objective:** Add `chat_message_received` to the `NotificationType` enum so the notification worker can handle chat notifications.

**Files:**
- Modify: `prisma/schema.prisma` (NotificationType enum)
- Create: `prisma/migrations/20260816000002_add_chat_notification_type/migration.sql`

**Step 1: Add enum value**

In `prisma/schema.prisma`, add `chat_message_received` to `NotificationType`:

```prisma
enum NotificationType {
  interest_received
  post_approved
  post_rejected
  post_closed
  password_reset
  chat_message_received

  @@map("notification_type")
}
```

**Step 2: Migration SQL**

```sql
ALTER TYPE "notification_type" ADD VALUE 'chat_message_received';
```

**Step 3: Verify**

Run: `npx prisma validate && npx prisma generate`
Expected: Schema valid, new enum value in generated client.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260816000002_add_chat_notification_type/
git commit -m "feat(chat): add chat_message_received notification type"
```

---

## Task 3: ConversationService — port, domain types, and in-memory fake test

**Objective:** Create `ConversationService` with its `ConversationRepository` port, following the `InterestService` pattern exactly. Write tests first (TDD).

**Files:**
- Create: `src/server/services/conversation-service.ts`
- Create: `src/server/services/conversation-service.test.ts`

**Step 1: Write the service file with port interface**

```typescript
/**
 * ConversationService — manages 1:1 conversations between a post author
 * and an interested user. A Conversation is created automatically when
 * an Interest is expressed (FR09). It is archived (not deleted) when
 * the Post is closed (D4).
 *
 * Like InterestService, this module depends on a narrow
 * ConversationRepository port rather than Prisma, so the creation and
 * archival behavior is unit-testable with an in-memory fake.
 *
 * Moderator access to conversation content is gated behind the
 * `chat.moderator_read_access` feature flag (D1) — the service exposes
 * a `listForModerator` method but it should only be called when the
 * flag is ON.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention).
// ---------------------------------------------------------------------

export interface ConversationRecord {
  id: string;
  interestId: string;
  postId: string;
  participantAId: string;
  participantBId: string;
  archived: boolean;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummary {
  id: string;
  postId: string;
  postTitle: string;
  postStatus: string;
  otherParticipantName: string;
  otherParticipantId: string;
  lastMessageContent: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  archived: boolean;
}

/**
 * Data-access port consumed by ConversationService.
 */
export interface ConversationRepository {
  findByInterestId(interestId: string): Promise<ConversationRecord | null>;
  createConversation(data: {
    interestId: string;
    postId: string;
    participantAId: string;
    participantBId: string;
  }): Promise<ConversationRecord>;
  findByParticipant(userId: string, limit: number, cursor?: Date): Promise<ConversationSummary[]>;
  findById(id: string): Promise<ConversationRecord | null>;
  findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null>;
  archiveByPostId(postId: string): Promise<number>;
  countUnreadForUser(userId: string): Promise<number>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversation ${id} was not found.`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationAccessError extends Error {
  constructor() {
    super("You do not have access to this conversation.");
    this.name = "ConversationAccessError";
  }
}

export class ConversationArchivedError extends Error {
  constructor() {
    super("This conversation has been archived.");
    this.name = "ConversationArchivedError";
  }
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

  /**
   * Create a conversation for an interest. Idempotent: if a conversation
   * already exists for this interestId, returns the existing one.
   * Called by InterestService (or its caller) after expressInterest.
   */
  async getOrCreateForInterest(data: {
    interestId: string;
    postId: string;
    authorId: string;
    interestedUserId: string;
  }): Promise<ConversationRecord> {
    const existing = await this.repo.findByInterestId(data.interestId);
    if (existing) {
      return existing;
    }

    return this.repo.createConversation({
      interestId: data.interestId,
      postId: data.postId,
      participantAId: data.authorId,
      participantBId: data.interestedUserId,
    });
  }

  /**
   * List conversations for a user (inbox view). Returns summaries with
   * last message preview and unread count.
   */
  async listForUser(userId: string, limit = 20, cursor?: Date): Promise<ConversationSummary[]> {
    return this.repo.findByParticipant(userId, limit, cursor);
  }

  /**
   * Get a conversation for a participant. Throws if the user is not a
   * participant.
   */
  async getByIdForUser(conversationId: string, userId: string): Promise<ConversationRecord> {
    const conv = await this.repo.findByIdForUser(conversationId, userId);
    if (!conv) {
      throw new ConversationNotFoundError(conversationId);
    }
    return conv;
  }

  /**
   * Archive all conversations for a post. Called when the post is closed.
   * Returns the number of archived conversations.
   */
  async archiveForPost(postId: string): Promise<number> {
    return this.repo.archiveByPostId(postId);
  }

  /**
   * Count unread messages for a user (for the notification badge).
   */
  async countUnread(userId: string): Promise<number> {
    return this.repo.countUnreadForUser(userId);
  }
}
```

**Step 2: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  ConversationService,
  type ConversationRepository,
  type ConversationRecord,
  type ConversationSummary,
  ConversationNotFoundError,
} from "./conversation-service";

// In-memory fake following the InterestService test pattern.
class InMemoryConversationRepository implements ConversationRepository {
  store = new Map<string, ConversationRecord>();
  summaries = new Map<string, ConversationSummary[]>();
  unreadCounts = new Map<string, number>();

  async findByInterestId(interestId: string) {
    for (const c of this.store.values()) {
      if (c.interestId === interestId) return c;
    }
    return null;
  }

  async createConversation(data: {
    interestId: string;
    postId: string;
    participantAId: string;
    participantBId: string;
  }) {
    const record: ConversationRecord = {
      id: `conv-${this.store.size + 1}`,
      interestId: data.interestId,
      postId: data.postId,
      participantAId: data.participantAId,
      participantBId: data.participantBId,
      archived: false,
      archivedAt: null,
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(record.id, record);
    return record;
  }

  async findByParticipant(userId: string, limit: number, cursor?: Date) {
    return this.summaries.get(userId) ?? [];
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdForUser(id: string, userId: string) {
    const c = this.store.get(id);
    if (!c) return null;
    if (c.participantAId !== userId && c.participantBId !== userId) return null;
    return c;
  }

  async archiveByPostId(postId: string) {
    let count = 0;
    for (const c of this.store.values()) {
      if (c.postId === postId && !c.archived) {
        c.archived = true;
        c.archivedAt = new Date();
        count++;
      }
    }
    return count;
  }

  async countUnreadForUser(userId: string) {
    return this.unreadCounts.get(userId) ?? 0;
  }
}

describe("ConversationService", () => {
  it("creates a conversation for a new interest", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    const conv = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    expect(conv.interestId).toBe("int-1");
    expect(conv.postId).toBe("post-1");
    expect(conv.archived).toBe(false);
  });

  it("is idempotent — returns existing conversation for same interest", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    const first = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    const second = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    expect(second.id).toBe(first.id);
  });

  it("throws when user is not a participant", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    await expect(
      service.getByIdForUser("conv-1", "intruder")
    ).rejects.toThrow(ConversationNotFoundError);
  });

  it("archives conversations for a closed post", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });
    await service.getOrCreateForInterest({
      interestId: "int-2",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-2",
    });

    const count = await service.archiveForPost("post-1");
    expect(count).toBe(2);
  });

  it("returns unread count for user", async () => {
    const repo = new InMemoryConversationRepository();
    repo.unreadCounts.set("user-1", 3);
    const service = new ConversationService(repo);

    const count = await service.countUnread("user-1");
    expect(count).toBe(3);
  });
});
```

**Step 3: Run tests**

Run: `cd ~/dev/precisase && npx vitest run src/server/services/conversation-service.test.ts`
Expected: 5 tests pass.

**Step 4: Commit**

```bash
git add src/server/services/conversation-service.ts src/server/services/conversation-service.test.ts
git commit -m "feat(chat): add ConversationService with port and tests"
```

---

## Task 4: MessageService — port, domain types, and in-memory fake test

**Objective:** Create `MessageService` following the same port pattern. Tests first.

**Files:**
- Create: `src/server/services/message-service.ts`
- Create: `src/server/services/message-service.test.ts`

**Step 1: Write the service file**

```typescript
/**
 * MessageService — send and read messages within a Conversation.
 *
 * Follows the same port-driven pattern as ConversationService and
 * InterestService. The repository port is the only Prisma boundary;
 * unit tests use an in-memory fake.
 *
 * Messages are plaintext (max 4000 chars). Not encrypted at rest in MVP
 * (D4 — encryption deferred). Archived with the parent Conversation;
 * never hard-deleted unless GDPR account deletion.
 *
 * Notifications: a `chat_message_received` notification (in_app + email)
 * is queued for the recipient on the FIRST unread message only — not
 * on every message — to avoid notification spam (D2).
 */

import type { ConversationRecord } from "./conversation-service";

// ---------------------------------------------------------------------
// Local domain types
// ---------------------------------------------------------------------

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface MessageSummary {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Data-access port consumed by MessageService.
 */
export interface MessageRepository {
  createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
  }): Promise<MessageRecord>;
  listByConversation(conversationId: string, limit: number, before?: Date): Promise<MessageSummary[]>;
  markAsRead(conversationId: string, userId: string): Promise<number>;
  hasUnreadForRecipient(conversationId: string, recipientId: string): Promise<boolean>;
  updateLastMessageAt(conversationId: string, date: Date): Promise<void>;
  deleteByUserId(userId: string): Promise<number>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export const MAX_MESSAGE_LENGTH = 4000;

export class MessageTooLongError extends Error {
  constructor(maxLength: number) {
    super(`Message must be at most ${maxLength} characters.`);
    this.name = "MessageTooLongError";
  }
}

export class EmptyMessageError extends Error {
  constructor() {
    super("Message cannot be empty.");
    this.name = "EmptyMessageError";
  }
}

// ---------------------------------------------------------------------
// Notification port (reuse from InterestService pattern)
// ---------------------------------------------------------------------

export interface MessageNotificationRecord {
  recipientId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  postTitle: string;
}

export interface MessageNotificationPort {
  queueNotification(notification: MessageNotificationRecord): Promise<void>;
}

// ---------------------------------------------------------------------
// Conversation lookup port (to validate access)
// ---------------------------------------------------------------------

export interface ConversationLookupPort {
  findByIdForUser(conversationId: string, userId: string): Promise<ConversationRecord | null>;
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly conversationLookup: ConversationLookupPort,
    private readonly notificationPort: MessageNotificationPort,
  ) {}

  /**
   * Send a message in a conversation. Validates that the sender is a
   * participant and the conversation is not archived. Queues a
   * notification for the recipient on the first unread message only.
   */
  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
    senderName: string;
    recipientId: string;
    postTitle: string;
  }): Promise<MessageRecord> {
    const trimmed = data.content.trim();
    if (!trimmed) {
      throw new EmptyMessageError();
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new MessageTooLongError(MAX_MESSAGE_LENGTH);
    }

    const conv = await this.conversationLookup.findByIdForUser(data.conversationId, data.senderId);
    if (!conv) {
      throw new Error(`Conversation ${data.conversationId} not found or access denied.`);
    }
    if (conv.archived) {
      throw new Error("Cannot send messages in an archived conversation.");
    }

    const message = await this.repo.createMessage({
      conversationId: data.conversationId,
      senderId: data.senderId,
      content: trimmed,
    });

    await this.repo.updateLastMessageAt(data.conversationId, message.createdAt);

    // Only notify on the first unread message (D2 — avoid spam)
    const hasUnread = await this.repo.hasUnreadForRecipient(data.conversationId, data.recipientId);
    // hasUnread was true BEFORE this message (which is still unread).
    // If it was already true, the recipient already has an unread notification
    // pending — don't send another. If false, this is the first unread.
    if (!hasUnread) {
      // This message is the first unread — but hasUnread was checked BEFORE
      // inserting the new message, so "false" means there were no unread
      // messages before this one. We need to re-check including this message.
      // Actually, the new message IS unread, so if there were no unread before,
      // now there is exactly one — notify.
      await this.notificationPort.queueNotification({
        recipientId: data.recipientId,
        conversationId: data.conversationId,
        senderId: data.senderId,
        senderName: data.senderName,
        postTitle: data.postTitle,
      });
    }

    return message;
  }

  /**
   * List messages in a conversation (paginated, oldest first).
   */
  async listMessages(conversationId: string, limit = 50, before?: Date): Promise<MessageSummary[]> {
    const messages = await this.repo.listByConversation(conversationId, limit, before);
    return messages.reverse(); // oldest first for display
  }

  /**
   * Mark all unread messages in a conversation as read for a user.
   */
  async markAsRead(conversationId: string, userId: string): Promise<number> {
    return this.repo.markAsRead(conversationId, userId);
  }
}
```

**Step 2: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  MessageService,
  type MessageRepository,
  type MessageNotificationPort,
  type ConversationLookupPort,
  type MessageRecord,
  type MessageSummary,
  type ConversationRecord,
  EmptyMessageError,
  MessageTooLongError,
  MAX_MESSAGE_LENGTH,
} from "./message-service";
import type { ConversationRecord as ConvRecord } from "./conversation-service";

class InMemoryMessageRepository implements MessageRepository {
  messages: MessageRecord[] = [];
  lastMessageAtUpdates: { conversationId: string; date: Date }[] = [];

  async createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
  }) {
    const msg: MessageRecord = {
      id: `msg-${this.messages.length + 1}`,
      conversationId: data.conversationId,
      senderId: data.senderId,
      content: data.content,
      readAt: null,
      createdAt: new Date(),
    };
    this.messages.push(msg);
    return msg;
  }

  async listByConversation(conversationId: string, limit: number, before?: Date) {
    let filtered = this.messages.filter(m => m.conversationId === conversationId);
    if (before) {
      filtered = filtered.filter(m => m.createdAt < before);
    }
    const sliced = filtered.slice(-limit);
    return sliced.map(m => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderName: `User-${m.senderId}`,
      content: m.content,
      readAt: m.readAt,
      createdAt: m.createdAt,
    }));
  }

  async markAsRead(conversationId: string, userId: string) {
    let count = 0;
    for (const m of this.messages) {
      if (m.conversationId === conversationId && m.senderId !== userId && !m.readAt) {
        m.readAt = new Date();
        count++;
      }
    }
    return count;
  }

  async hasUnreadForRecipient(conversationId: string, recipientId: string) {
    return this.messages.some(
      m => m.conversationId === conversationId
        && m.senderId !== recipientId
        && !m.readAt
    );
  }

  async updateLastMessageAt(conversationId: string, date: Date) {
    this.lastMessageAtUpdates.push({ conversationId, date });
  }

  async deleteByUserId(userId: string) {
    const before = this.messages.length;
    this.messages = this.messages.filter(m => m.senderId !== userId);
    return before - this.messages.length;
  }
}

class InMemoryNotificationPort implements MessageNotificationPort {
  queued: { recipientId: string; conversationId: string }[] = [];
  async queueNotification(n: { recipientId: string; conversationId: string }) {
    this.queued.push(n);
  }
}

class InMemoryConversationLookup implements ConversationLookupPort {
  conversations = new Map<string, ConversationRecord>();
  async findByIdForUser(id: string, userId: string) {
    const c = this.conversations.get(id);
    if (!c) return null;
    if (c.participantAId !== userId && c.participantBId !== userId) return null;
    return c;
  }
}

function makeConv(overrides: Partial<ConvRecord> = {}): ConvRecord {
  return {
    id: "conv-1",
    interestId: "int-1",
    postId: "post-1",
    participantAId: "author-1",
    participantBId: "user-1",
    archived: false,
    archivedAt: null,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("MessageService", () => {
  async function setup() {
    const repo = new InMemoryMessageRepository();
    const notif = new InMemoryNotificationPort();
    const lookup = new InMemoryConversationLookup();
    lookup.conversations.set("conv-1", makeConv());
    const service = new MessageService(repo, lookup, notif);
    return { service, repo, notif, lookup };
  }

  it("sends a message and queues notification on first unread", async () => {
    const { service, notif } = await setup();

    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Olá!",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Preciso de voluntários",
    });

    expect(notif.queued).toHaveLength(1);
    expect(notif.queued[0].recipientId).toBe("author-1");
  });

  it("does not queue notification when recipient already has unread", async () => {
    const { service, repo, notif } = await setup();

    // First message (unread)
    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Primeira mensagem",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    // Second message (recipient still has unread from first)
    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Segunda mensagem",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    expect(notif.queued).toHaveLength(1);
  });

  it("rejects empty messages", async () => {
    const { service } = await setup();

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "   ",
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow(EmptyMessageError);
  });

  it("rejects messages over max length", async () => {
    const { service } = await setup();

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "a".repeat(MAX_MESSAGE_LENGTH + 1),
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow(MessageTooLongError);
  });

  it("rejects messages to archived conversations", async () => {
    const { service, lookup } = await setup();
    lookup.conversations.set("conv-1", makeConv({ archived: true, archivedAt: new Date() }));

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "Olá",
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow("archived");
  });

  it("marks messages as read", async () => {
    const { service } = await setup();

    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Olá",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    const count = await service.markAsRead("conv-1", "author-1");
    expect(count).toBe(1);
  });

  it("lists messages oldest first", async () => {
    const { service } = await setup();

    await service.sendMessage({
      conversationId: "conv-1", senderId: "user-1", content: "A",
      senderName: "U1", recipientId: "author-1", postTitle: "T",
    });
    await service.sendMessage({
      conversationId: "conv-1", senderId: "author-1", content: "B",
      senderName: "A1", recipientId: "user-1", postTitle: "T",
    });

    const messages = await service.listMessages("conv-1", 50);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("A");
    expect(messages[1].content).toBe("B");
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/server/services/message-service.test.ts`
Expected: 7 tests pass.

**Step 4: Commit**

```bash
git add src/server/services/message-service.ts src/server/services/message-service.test.ts
git commit -m "feat(chat): add MessageService with port and tests"
```

---

## Task 5: Prisma repository implementations

**Objective:** Implement `ConversationRepository` and `MessageRepository` ports with Prisma.

**Files:**
- Create: `src/server/repositories/prisma-conversation-repository.ts`
- Create: `src/server/repositories/prisma-message-repository.ts`

**Step 1: Write prisma-conversation-repository.ts**

Follow the pattern from `prisma-interest-repository.ts`. Key points:
- Use `select` projections everywhere
- `findByParticipant` needs a join to get post title, other participant name, last message preview, and unread count
- `archiveByPostId` does `updateMany` with `WHERE postId AND archived = false`
- `countUnreadForUser` counts messages where senderId != userId AND readAt IS NULL, across all conversations where user is a participant

**Step 2: Write prisma-message-repository.ts**

Follow the same pattern. Key points:
- `createMessage` inserts and returns the record
- `listByConversation` uses `findMany` with `orderBy createdAt desc`, `take limit+1`, reversed in service
- `markAsRead` does `updateMany` WHERE conversationId AND senderId != userId AND readAt IS NULL
- `hasUnreadForRecipient` does `findFirst` WHERE conversationId AND senderId != recipientId AND readAt IS NULL
- `updateLastMessageAt` updates the Conversation row
- `deleteByUserId` does `deleteMany` WHERE senderId = userId

**Step 3: Wire in service-instances.ts**

Add imports and exports:

```typescript
import { ConversationService } from "@/server/services/conversation-service";
import { PrismaConversationRepository } from "@/server/repositories/prisma-conversation-repository";
import { MessageService } from "@/server/services/message-service";
import { PrismaMessageRepository } from "@/server/repositories/prisma-message-repository";

export const conversationService = new ConversationService(new PrismaConversationRepository());
export const messageService = new MessageService(
  new PrismaMessageRepository(),
  new PrismaConversationRepository(), // ConversationLookupPort
  // NotificationPort — see Task 6
  {} as any, // placeholder, wired in Task 6
);
```

> Note: The notification port wiring is completed in Task 6 when we connect to the existing notification system.

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/server/repositories/prisma-conversation-repository.ts src/server/repositories/prisma-message-repository.ts src/server/service-instances.ts
git commit -m "feat(chat): add Prisma repository implementations"
```

---

## Task 6: Wire conversation creation into InterestService flow

**Objective:** When a user expresses interest in a post, automatically create a conversation. Wire the notification port.

**Files:**
- Modify: `src/server/repositories/prisma-interest-repository.ts` (add conversation creation)
- Modify: `src/server/service-instances.ts` (wire notification port)

**Step 1: Update InterestService to accept a ConversationService dependency**

The cleanest approach: add an optional `onInterestCreated` callback to `InterestService` constructor, or better yet, have the **caller** (Server Action) create the conversation after `expressInterest` succeeds. This keeps InterestService unchanged (YAGNI — don't modify working code unnecessarily).

**Decision:** Wire at the **Server Action level**, not the service level. The `posts/[id]/actions.ts` already calls `interestService.expressInterest` — after it returns, call `conversationService.getOrCreateForInterest` with the interest ID and participant IDs.

**Step 2: Implement the notification port**

Create `src/server/repositories/prisma-message-notification-port.ts`:

```typescript
import type { MessageNotificationRecord, MessageNotificationPort } from "@/server/services/message-service";
import { prisma } from "./prisma-client";

export class PrismaMessageNotificationPort implements MessageNotificationPort {
  async queueNotification(n: MessageNotificationRecord): Promise<void> {
    await prisma.notification.create({
      data: {
        recipientId: n.recipientId,
        type: "chat_message_received",
        channel: "in_app",
        status: "queued",
        payload: {
          conversationId: n.conversationId,
          senderId: n.senderId,
          senderName: n.senderName,
          postTitle: n.postTitle,
        },
      },
    });
  }
}
```

**Step 3: Update service-instances.ts**

```typescript
import { PrismaMessageNotificationPort } from "@/server/repositories/prisma-message-notification-port";

const messageNotificationPort = new PrismaMessageNotificationPort();
export const messageService = new MessageService(
  new PrismaMessageRepository(),
  new PrismaConversationRepository(),
  messageNotificationPort,
);
```

**Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/server/repositories/prisma-message-notification-port.ts src/server/service-instances.ts
git commit -m "feat(chat): wire notification port and service instances"
```

---

## Task 7: Wire conversation archival into PostService closePost

**Objective:** When a post is closed, archive all its conversations.

**Files:**
- Modify: `src/app/[locale]/posts/[id]/actions.ts` (or `my-posts/actions.ts`) — after `postService.closePost` succeeds, call `conversationService.archiveForPost(postId)`

**Step 1:** Find the close-post Server Action and add the archival call after the post is closed.

**Step 2:** This is a one-liner: `await conversationService.archiveForPost(postId)`.

**Step 3: Commit**

```bash
git add src/app/[locale]/my-posts/actions.ts
git commit -m "feat(chat): archive conversations when post is closed"
```

---

## Task 8: i18n strings — chat namespace

**Objective:** Add all chat-related strings to the three locale files.

**Files:**
- Modify: `messages/pt-PT.json`
- Modify: `messages/pt-BR.json`
- Modify: `messages/en.json`

**Step 1: Add chat namespace to pt-PT.json**

```json
"chat": {
  "nav": {
    "messages": "Mensagens",
    "badge": "{count, plural, one {# não lida} other {# não lidas}}"
  },
  "inbox": {
    "title": "Mensagens",
    "subtitle": "Conversas com outros membros da comunidade.",
    "empty": "Ainda não tens conversas. Manifesta interesse num post para começar.",
    "archived": "Arquivada",
    "unread": "{count, plural, one {# não lida} other {# não lidas}}"
  },
  "conversation": {
    "backLink": "← Voltar às mensagens",
    "archivedBanner": "Esta conversa foi arquivada — o post foi resolvido.",
    "inputPlaceholder": "Escreve uma mensagem…",
    "send": "Enviar",
    "sending": "A enviar…",
    "loadMore": "Ver mensagens anteriores",
    "empty": "Sem mensagens. Inicia a conversa!",
    "errors": {
      "empty": "A mensagem não pode estar vazia.",
      "tooLong": "A mensagem é demasiado longa (máximo 4000 caracteres).",
      "archived": "Esta conversa foi arquivada.",
      "generic": "Não foi possível enviar a mensagem. Tenta novamente."
    }
  }
}
```

**Step 2:** Translate for `pt-BR.json` (minor differences — "conversas" etc.)

**Step 3:** Translate for `en.json`:

```json
"chat": {
  "nav": {
    "messages": "Messages",
    "badge": "{count, plural, one {# unread} other {# unread}}"
  },
  "inbox": {
    "title": "Messages",
    "subtitle": "Conversations with other community members.",
    "empty": "No conversations yet. Express interest in a post to start.",
    "archived": "Archived",
    "unread": "{count, plural, one {# unread} other {# unread}}"
  },
  "conversation": {
    "backLink": "← Back to messages",
    "archivedBanner": "This conversation has been archived — the post was resolved.",
    "inputPlaceholder": "Type a message…",
    "send": "Send",
    "sending": "Sending…",
    "loadMore": "Load earlier messages",
    "empty": "No messages yet. Start the conversation!",
    "errors": {
      "empty": "Message cannot be empty.",
      "tooLong": "Message is too long (max 4000 characters).",
      "archived": "This conversation has been archived.",
      "generic": "Could not send the message. Try again."
    }
  }
}
```

**Step 4: Add nav link to the header**

In `messages/pt-PT.json` under `nav`, add:
```json
"messages": "Mensagens"
```
(Already covered by `chat.nav.messages` — use that.)

**Step 5: Commit**

```bash
git add messages/
git commit -m "feat(chat): add i18n strings for chat in pt-PT, pt-BR, en"
```

---

## Task 9: UI — Inbox page (conversation list)

**Objective:** Create `/messages` page listing the user's conversations.

**Files:**
- Create: `src/app/[locale]/messages/page.tsx`
- Create: `src/app/[locale]/messages/conversation-list.tsx` (client component)

**Step 1: Server Component page**

Renders the inbox. Fetches conversations via `conversationService.listForUser`. Passes data to a client component for polling/refresh.

**Step 2: Client component**

Renders the list. Each row shows:
- Other participant's name
- Post title (linked)
- Last message preview (truncated)
- Last message time
- Unread badge (if any)
- Archived indicator

**Step 3: Commit**

```bash
git add src/app/[locale]/messages/
git commit -m "feat(chat): add inbox page with conversation list"
```

---

## Task 10: UI — Chat view (conversation detail)

**Objective:** Create `/messages/[conversationId]` page with message list and input.

**Files:**
- Create: `src/app/[locale]/messages/[id]/page.tsx`
- Create: `src/app/[locale]/messages/[id]/chat-view.tsx` (client component)
- Create: `src/app/[locale]/messages/[id]/actions.ts` (Server Actions)

**Step 1: Server Actions**

```typescript
"use server";

import { messageService } from "@/server/service-instances";
import { conversationService } from "@/server/service-instances";

export async function sendMessageAction(conversationId: string, content: string) {
  // Get current user from auth, get conversation to find recipient
  // Call messageService.sendMessage
}

export async function markAsReadAction(conversationId: string) {
  // Get current user
  // Call messageService.markAsRead
}
```

**Step 2: Client component**

- Polls for new messages every 5s via Server Action
- Renders messages oldest-first
- Input box with send button
- Calls markAsRead on mount and on new messages received
- Shows archived banner if conversation is archived
- Input disabled when archived

**Step 3: Commit**

```bash
git add src/app/[locale]/messages/[id]/
git commit -m "feat(chat): add chat view with message list and input"
```

---

## Task 11: UI — Notification badge in header

**Objective:** Add unread badge to the messages link in the app header.

**Files:**
- Modify: `src/components/layout/app-header.tsx`

**Step 1:** In the header Server Component, fetch `conversationService.countUnread(userId)` (and optionally pending moderation count) for the logged-in user.

**Step 2:** Render a badge next to the "Messages" nav link showing the unread count.

**Step 3:** Also show pending moderation count badge for moderators/admins (reuses existing moderation queue count).

**Step 4: Commit**

```bash
git add src/components/layout/app-header.tsx
git commit -m "feat(chat): add unread notification badge to header"
```

---

## Task 12: Wire conversation creation after interest is expressed

**Objective:** In the express-interest Server Action, after `interestService.expressInterest` returns, call `conversationService.getOrCreateForInterest`.

**Files:**
- Modify: `src/app/[locale]/posts/[id]/actions.ts`

**Step 1:** After the interest is created, call:

```typescript
await conversationService.getOrCreateForInterest({
  interestId: interest.id,
  postId,
  authorId: post.authorId,
  interestedUserId: userId,
});
```

**Step 2: Commit**

```bash
git add src/app/[locale]/posts/[id]/actions.ts
git commit -m "feat(chat): create conversation on interest expressed"
```

---

## Task 13: AccountDeletionService — handle chat data

**Objective:** When a user deletes their account (GDPR), delete their messages and archive their conversations.

**Files:**
- Modify: `src/server/repositories/prisma-account-deletion-repository.ts`

**Step 1:** In the `redactAndDeleteAccount` transaction, add:
- `prisma.message.deleteMany({ where: { senderId: userId } })`
- Archive conversations where the user is a participant: `prisma.conversation.updateMany({ where: { OR: [{ participantAId: userId }, { participantBId: userId }], archived: false }, data: { archived: true, archivedAt: new Date() } })`

**Step 2: Commit**

```bash
git add src/server/repositories/prisma-account-deletion-repository.ts
git commit -m "feat(chat): handle chat data on GDPR account deletion"
```

---

## Task 14: Contact panel update — link to chat instead of revealing contact

**Objective:** Update the post detail page to show a "Chat on platform" option alongside the existing contact reveal, so users have a choice to chat without sharing contact info.

**Files:**
- Modify: `src/app/[locale]/posts/[id]/contact-panel.tsx`

**Step 1:** After interest is expressed, show two options:
1. "Conversar na plataforma" → link to `/messages/[conversationId]`
2. Existing contact reveal (phone/WhatsApp/email) — kept for backward compatibility

**Step 2: Commit**

```bash
git add src/app/[locale]/posts/[id]/contact-panel.tsx
git commit -m "feat(chat): add platform chat option to contact panel"
```

---

## Task 15: Integration test — full flow

**Objective:** Write an integration test covering: express interest → conversation created → send message → notification queued → mark as read → close post → conversation archived.

**Files:**
- Create: `src/server/services/chat-integration.test.ts`

**Step 1:** Write a test using in-memory fakes for all services, verifying the full flow.

**Step 2: Commit**

```bash
git add src/server/services/chat-integration.test.ts
git commit -m "test(chat): add integration test for full chat flow"
```

---

## Summary

| Task | What | Est. |
|------|------|------|
| 1 | Prisma schema (Conversation, Message) | 5 min |
| 2 | NotificationType enum | 2 min |
| 3 | ConversationService + tests | 10 min |
| 4 | MessageService + tests | 10 min |
| 5 | Prisma repository implementations | 15 min |
| 6 | Wire notification port + service instances | 5 min |
| 7 | Wire archival into closePost | 3 min |
| 8 | i18n strings (pt-PT, pt-BR, en) | 5 min |
| 9 | UI — Inbox page | 10 min |
| 10 | UI — Chat view | 15 min |
| 11 | UI — Header badge | 5 min |
| 12 | Wire conversation creation after interest | 3 min |
| 13 | AccountDeletionService chat handling | 5 min |
| 14 | Contact panel update | 5 min |
| 15 | Integration test | 10 min |
