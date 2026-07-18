import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../messages/pt-PT.json";
import { SignupForm } from "./signup-form";
import { signup } from "./actions";

/**
 * The signup Server Action does real Prisma/argon2 work (actions.ts calls
 * createUserWithConsent + PasswordService), so it is mocked here — these
 * are component/integration tests for the form's own validation behavior
 * (docs/ARCHITECTURE.md §7.5, BR06), not a live-DB test.
 */
vi.mock("./actions", () => ({
  signup: vi.fn(),
}));

// `@/i18n/navigation`'s `Link`/`useRouter` wrap Next.js App Router APIs
// that aren't available outside of a running Next.js server; stub them so
// the form can render in jsdom.
const pushMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: pushMock }),
}));

function renderSignupForm() {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <SignupForm locale="pt-PT" />
    </NextIntlClientProvider>,
  );
}

describe("SignupForm validation (docs/ARCHITECTURE.md §7.5, BR06)", () => {
  beforeEach(() => {
    vi.mocked(signup).mockReset();
    pushMock.mockReset();
  });

  it("rejects mismatched passwords without calling the signup action", async () => {
    const user = userEvent.setup();
    renderSignupForm();

    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.displayNameLabel),
      "Ana Silva",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.emailLabel),
      "ana@example.com",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.passwordLabel),
      "correct-password",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.confirmPasswordLabel),
      "different-password",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: `${ptPT.auth.signUp.consentLabel} ${ptPT.auth.signUp.consentPrivacyLinkLabel}`,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: ptPT.auth.signUp.submit }),
    );

    expect(
      await screen.findByText(ptPT.auth.signUp.errors.passwordMismatch),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("rejects submission when the consent checkbox is not checked", async () => {
    const user = userEvent.setup();
    renderSignupForm();

    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.displayNameLabel),
      "Ana Silva",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.emailLabel),
      "ana@example.com",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.passwordLabel),
      "correct-password",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.confirmPasswordLabel),
      "correct-password",
    );
    // Consent checkbox intentionally left unchecked.
    await user.click(
      screen.getByRole("button", { name: ptPT.auth.signUp.submit }),
    );

    expect(
      await screen.findByText(ptPT.auth.signUp.errors.consentRequired),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("calls the signup action with matching passwords and consent granted", async () => {
    vi.mocked(signup).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSignupForm();

    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.displayNameLabel),
      "Ana Silva",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.emailLabel),
      "ana@example.com",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.passwordLabel),
      "correct-password",
    );
    await user.type(
      screen.getByLabelText(ptPT.auth.signUp.confirmPasswordLabel),
      "correct-password",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: `${ptPT.auth.signUp.consentLabel} ${ptPT.auth.signUp.consentPrivacyLinkLabel}`,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: ptPT.auth.signUp.submit }),
    );

    await vi.waitFor(() => expect(signup).toHaveBeenCalledTimes(1));
    expect(signup).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Ana Silva",
        email: "ana@example.com",
        password: "correct-password",
        confirmPassword: "correct-password",
        consent: true,
        locale: "pt-PT",
      }),
    );
  });
});
