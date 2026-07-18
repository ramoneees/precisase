import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../messages/pt-PT.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ProfileForm, type ProfileFormData } from "./profile-form";
import { updateProfileAction } from "./actions";

/**
 * The update Server Action does real Prisma work (actions.ts calls
 * prisma.user.update), so it is mocked here — these are component tests for
 * the form's own rendering/validation behavior (FR13), not a live-DB test.
 */
vi.mock("./actions", () => ({
  updateProfileAction: vi.fn(),
}));

function makeProfile(overrides: Partial<ProfileFormData> = {}): ProfileFormData {
  return {
    email: "ana@example.com",
    displayName: "Ana Silva",
    phoneE164: "+351912345678",
    phoneCountry: "PT",
    churchAffiliation: "Casa da Cidade — Núcleo Norte",
    role: "user",
    uiLocale: "pt-PT",
    ...overrides,
  };
}

function renderProfileForm(profile: ProfileFormData = makeProfile()) {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <ToastProvider>
        <ProfileForm profile={profile} locale="pt-PT" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ProfileForm (FR13)", () => {
  beforeEach(() => {
    vi.mocked(updateProfileAction).mockReset();
  });

  it("renders the current profile values, including read-only email/role/locale", () => {
    renderProfileForm();

    expect(screen.getByLabelText(ptPT.profile.displayNameLabel)).toHaveValue("Ana Silva");
    expect(screen.getByLabelText(ptPT.profile.phoneLabel)).toHaveValue("+351912345678");
    expect(screen.getByLabelText(ptPT.profile.churchAffiliationLabel)).toHaveValue(
      "Casa da Cidade — Núcleo Norte",
    );
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText(ptPT.profile.roleValues.user)).toBeInTheDocument();
    expect(screen.getByText("pt-PT")).toBeInTheDocument();
  });

  it("renders empty inputs for null phone/churchAffiliation", () => {
    renderProfileForm(makeProfile({ phoneE164: null, churchAffiliation: null }));

    expect(screen.getByLabelText(ptPT.profile.phoneLabel)).toHaveValue("");
    expect(screen.getByLabelText(ptPT.profile.churchAffiliationLabel)).toHaveValue("");
  });

  it("rejects an empty display name without calling the update action", async () => {
    const user = userEvent.setup();
    renderProfileForm();

    await user.clear(screen.getByLabelText(ptPT.profile.displayNameLabel));
    await user.click(screen.getByRole("button", { name: ptPT.profile.save }));

    expect(
      await screen.findByText(ptPT.profile.errors.invalidInput),
    ).toBeInTheDocument();
    expect(updateProfileAction).not.toHaveBeenCalled();
  });

  it("calls the update action with the edited values", async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderProfileForm();

    await user.clear(screen.getByLabelText(ptPT.profile.displayNameLabel));
    await user.type(screen.getByLabelText(ptPT.profile.displayNameLabel), "Ana Costa");
    await user.click(screen.getByRole("button", { name: ptPT.profile.save }));

    await vi.waitFor(() => expect(updateProfileAction).toHaveBeenCalledTimes(1));
    expect(updateProfileAction).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Ana Costa",
        phoneE164: "+351912345678",
        churchAffiliation: "Casa da Cidade — Núcleo Norte",
        locale: "pt-PT",
      }),
    );
  });

  it("shows a confirmation toast on a successful save", async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderProfileForm();

    await user.click(screen.getByRole("button", { name: ptPT.profile.save }));

    expect(await screen.findByText(ptPT.profile.toastSaved)).toBeInTheDocument();
  });
});
