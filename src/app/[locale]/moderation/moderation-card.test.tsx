import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../messages/pt-PT.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ModerationCard, type ModerationQueueItem } from "./moderation-card";
import { approvePostAction, rejectPostAction } from "./actions";

/**
 * These Server Actions do real Prisma work (actions.ts calls
 * `postService.approvePost`/`rejectPost`), so they're mocked here — this is
 * a component test for `ModerationCard`'s own reject-reason-required UI
 * behavior (docs/ARCHITECTURE.md §5.3 — `rejectPost` requires a non-empty
 * `reason`), not a live-DB test.
 */
vi.mock("./actions", () => ({
  approvePostAction: vi.fn(),
  rejectPostAction: vi.fn(),
}));

const refreshMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function makePost(overrides: Partial<ModerationQueueItem> = {}): ModerationQueueItem {
  return {
    id: "post-1",
    type: "request",
    categoryKey: "category.volunteering",
    title: "Preciso de ajuda a mudar um sofá",
    description: "Descrição do pedido de ajuda.",
    authorName: "Ana Silva",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    photoUrl: "data:image/svg+xml,%3Csvg%2F%3E",
    ...overrides,
  };
}

function renderCard(post: ModerationQueueItem = makePost()) {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <ToastProvider>
        <ModerationCard post={post} locale="pt-PT" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ModerationCard reject-reason-required behavior (docs/ARCHITECTURE.md §5.3)", () => {
  beforeEach(() => {
    vi.mocked(approvePostAction).mockReset();
    vi.mocked(rejectPostAction).mockReset();
    refreshMock.mockReset();
  });

  it("does not show the reason input until 'Rejeitar' is clicked", () => {
    renderCard();

    expect(
      screen.queryByLabelText(ptPT.moderation.reasonLabel),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: ptPT.moderation.confirmReject }),
    ).not.toBeInTheDocument();
  });

  it("reveals an inline reason input (not a native prompt) when 'Rejeitar' is clicked", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: ptPT.moderation.reject }));

    expect(screen.getByLabelText(ptPT.moderation.reasonLabel)).toBeInTheDocument();
  });

  it("disables 'Confirmar rejeição' until a reason has been entered", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: ptPT.moderation.reject }));

    const confirmButton = screen.getByRole("button", {
      name: ptPT.moderation.confirmReject,
    });
    expect(confirmButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.moderation.reasonLabel),
      "Post duplicado, já existe um ativo.",
    );

    expect(confirmButton).toBeEnabled();
  });

  it("does not call rejectPostAction when the reason is only whitespace", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: ptPT.moderation.reject }));
    await user.type(screen.getByLabelText(ptPT.moderation.reasonLabel), "   ");

    const confirmButton = screen.getByRole("button", {
      name: ptPT.moderation.confirmReject,
    });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);

    expect(rejectPostAction).not.toHaveBeenCalled();
  });

  it("calls rejectPostAction with the entered reason once confirmed", async () => {
    vi.mocked(rejectPostAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderCard(makePost({ id: "post-42" }));

    await user.click(screen.getByRole("button", { name: ptPT.moderation.reject }));
    await user.type(
      screen.getByLabelText(ptPT.moderation.reasonLabel),
      "Post duplicado, já existe um ativo.",
    );
    await user.click(
      screen.getByRole("button", { name: ptPT.moderation.confirmReject }),
    );

    await vi.waitFor(() => expect(rejectPostAction).toHaveBeenCalledTimes(1));
    expect(rejectPostAction).toHaveBeenCalledWith(
      "post-42",
      "Post duplicado, já existe um ativo.",
      "pt-PT",
    );
  });

  it("lets 'Cancelar' hide the reason input again without calling rejectPostAction", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: ptPT.moderation.reject }));
    await user.type(screen.getByLabelText(ptPT.moderation.reasonLabel), "Algum motivo");
    await user.click(screen.getByRole("button", { name: ptPT.moderation.cancel }));

    expect(
      screen.queryByLabelText(ptPT.moderation.reasonLabel),
    ).not.toBeInTheDocument();
    expect(rejectPostAction).not.toHaveBeenCalled();
  });

  it("calls approvePostAction when 'Aprovar' is clicked", async () => {
    vi.mocked(approvePostAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderCard(makePost({ id: "post-7" }));

    await user.click(screen.getByRole("button", { name: ptPT.moderation.approve }));

    await vi.waitFor(() => expect(approvePostAction).toHaveBeenCalledTimes(1));
    expect(approvePostAction).toHaveBeenCalledWith("post-7", "pt-PT");
  });
});
