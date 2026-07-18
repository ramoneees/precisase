import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../messages/pt-PT.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { DeleteAccountSection } from "./delete-account-section";
import { deleteAccountAction } from "./actions";

/**
 * The deletion Server Action does real Prisma/argon2/Auth.js work
 * (actions.ts calls accountDeletionService.deleteOwnAccount + signOut), so
 * it is mocked here — these are component tests for the confirmation UI's
 * own gating behavior (NFR08), not a live-DB test.
 */
vi.mock("./actions", () => ({
  deleteAccountAction: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: pushMock }),
}));

function renderSection() {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <ToastProvider>
        <DeleteAccountSection />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("DeleteAccountSection (NFR08 — password re-entry confirmation)", () => {
  beforeEach(() => {
    vi.mocked(deleteAccountAction).mockReset();
    pushMock.mockReset();
  });

  it("keeps the confirm button disabled until the password field is filled", async () => {
    const user = userEvent.setup();
    renderSection();

    const confirmButton = screen.getByRole("button", {
      name: ptPT.profile.dangerZone.confirm,
    });
    expect(confirmButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.profile.dangerZone.passwordLabel),
      "my-current-password",
    );

    expect(confirmButton).toBeEnabled();
  });

  it("does not call the delete action while the password field is empty", async () => {
    renderSection();

    const confirmButton = screen.getByRole("button", {
      name: ptPT.profile.dangerZone.confirm,
    });
    // A disabled submit button cannot trigger a submit event in the DOM —
    // this asserts the gating actually prevents the action from firing.
    confirmButton.click();

    expect(deleteAccountAction).not.toHaveBeenCalled();
  });

  it("calls the delete action with the entered password once confirmed", async () => {
    vi.mocked(deleteAccountAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSection();

    await user.type(
      screen.getByLabelText(ptPT.profile.dangerZone.passwordLabel),
      "my-current-password",
    );
    await user.click(screen.getByRole("button", { name: ptPT.profile.dangerZone.confirm }));

    await vi.waitFor(() => expect(deleteAccountAction).toHaveBeenCalledTimes(1));
    expect(deleteAccountAction).toHaveBeenCalledWith("my-current-password");
  });

  it("shows a translated error and does not navigate away when the password is wrong", async () => {
    vi.mocked(deleteAccountAction).mockResolvedValue({
      ok: false,
      error: "invalidPassword",
    });
    const user = userEvent.setup();
    renderSection();

    await user.type(
      screen.getByLabelText(ptPT.profile.dangerZone.passwordLabel),
      "wrong-password",
    );
    await user.click(screen.getByRole("button", { name: ptPT.profile.dangerZone.confirm }));

    expect(
      await screen.findByText(ptPT.profile.dangerZone.errors.invalidPassword),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a confirmation toast and navigates home on success", async () => {
    vi.mocked(deleteAccountAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSection();

    await user.type(
      screen.getByLabelText(ptPT.profile.dangerZone.passwordLabel),
      "my-current-password",
    );
    await user.click(screen.getByRole("button", { name: ptPT.profile.dangerZone.confirm }));

    expect(
      await screen.findByText(ptPT.profile.dangerZone.toastDeleted),
    ).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("links to the privacy policy", () => {
    renderSection();

    expect(
      screen.getByRole("link", { name: ptPT.profile.dangerZone.privacyLinkLabel }),
    ).toHaveAttribute("href", "/privacy");
  });
});
