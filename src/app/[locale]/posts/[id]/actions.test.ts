import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/auth/auth-context";
import {
  conversationService,
  interestService,
  postService,
} from "@/server/service-instances";
import { PostNotFoundError } from "@/server/services/interest-service";
import { expressInterestAction } from "./actions";

/**
 * Chat plan Task 12: after `interestService.expressInterest` succeeds, the
 * Server Action must get-or-create the 1:1 Conversation for that interest
 * (chat plan §"Task 12", decision to wire at the action level — keeps
 * InterestService untouched). All dependencies are mocked: this locks in
 * the orchestration order and arguments, not Prisma behavior.
 *
 * Convergence note: both `expressInterest` (C7) and `getOrCreateForInterest`
 * are idempotent, so if conversation creation fails after the interest row
 * was written, a user retry heals the gap without duplicate side effects
 * (no second author notification, no second conversation).
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/auth/auth-context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/server/service-instances", () => ({
  interestService: { expressInterest: vi.fn() },
  postService: { getPost: vi.fn() },
  conversationService: { getOrCreateForInterest: vi.fn() },
}));

const anonContext = { kind: "anon" } as const;
const userContext = {
  kind: "user",
  user: {
    id: "user-1",
    email: "user@example.com",
    displayName: "Ana",
    role: "user" as const,
    country: null,
    timeZone: null,
    currency: null,
  },
} as const;

const interestRecord = {
  id: "int-1",
  postId: "post-1",
  userId: "user-1",
  message: null,
  createdAt: new Date("2026-08-16T00:00:00Z"),
};

const activePost = {
  id: "post-1",
  authorId: "author-1",
  status: "active" as const,
};

describe("expressInterestAction creates the conversation (chat plan Task 12)", () => {
  beforeEach(() => {
    vi.mocked(getAuthContext).mockReset();
    vi.mocked(interestService.expressInterest).mockReset();
    vi.mocked(postService.getPost).mockReset();
    vi.mocked(conversationService.getOrCreateForInterest).mockReset();
    vi.mocked(revalidatePath).mockReset();

    vi.mocked(postService.getPost).mockResolvedValue(activePost as never);
    vi.mocked(conversationService.getOrCreateForInterest).mockResolvedValue({} as never);
  });

  it("returns unauthenticated and creates nothing for anonymous visitors", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(anonContext);

    const result = await expressInterestAction("post-1", "en");

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(conversationService.getOrCreateForInterest).not.toHaveBeenCalled();
  });

  it("creates a conversation for the interest with both participants", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(userContext);
    vi.mocked(interestService.expressInterest).mockResolvedValue(interestRecord);

    const result = await expressInterestAction("post-1", "en");

    expect(result).toEqual({ ok: true });
    expect(interestService.expressInterest).toHaveBeenCalledWith({
      postId: "post-1",
      userId: "user-1",
    });
    expect(conversationService.getOrCreateForInterest).toHaveBeenCalledWith({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/en/posts/post-1");
  });

  it("still calls get-or-create when the interest already existed (idempotent re-click)", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(userContext);
    vi.mocked(interestService.expressInterest).mockResolvedValue(interestRecord);

    await expressInterestAction("post-1", "en");
    await expressInterestAction("post-1", "en");

    expect(conversationService.getOrCreateForInterest).toHaveBeenCalledTimes(2);
  });

  it("maps a missing post to 'unavailable' without touching conversations", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(userContext);
    vi.mocked(postService.getPost).mockRejectedValue(new PostNotFoundError("post-1"));

    const result = await expressInterestAction("post-1", "en");

    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(conversationService.getOrCreateForInterest).not.toHaveBeenCalled();
  });

  it("surfaces 'generic' when conversation creation fails (retry heals via idempotency)", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(userContext);
    vi.mocked(interestService.expressInterest).mockResolvedValue(interestRecord);
    vi.mocked(conversationService.getOrCreateForInterest).mockRejectedValue(
      new Error("db down"),
    );

    const result = await expressInterestAction("post-1", "en");

    expect(result).toEqual({ ok: false, error: "generic" });
  });
});
