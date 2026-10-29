import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../../messages/pt-PT.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { CreatePostForm } from "./create-post-form";
import { createPostAction } from "./actions";

const UNSAVED_WARNING = ptPT.post.createForm.unsavedChangesWarning;

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

function clickInternalLink(href: string) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  document.body.appendChild(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  anchor.dispatchEvent(event);
  document.body.removeChild(anchor);
  return event;
}

/**
 * The `createPostAction` Server Action does real Prisma work, so it's
 * mocked here — this is a component test for the form's own
 * submit-disabled logic (design spec: disabled until title, description,
 * contact value, and consent are all filled), not a live-DB test.
 */
vi.mock("./actions", () => ({
  createPostAction: vi.fn(),
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

const categories = [
  { id: "cat-1", slug: "volunteering", key: "category.volunteering", isActive: true },
  { id: "cat-2", slug: "donation", key: "category.donation", isActive: true },
];

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <ToastProvider>
        <CreatePostForm categories={categories} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CreatePostForm submit-disabled logic", () => {
  beforeEach(() => {
    vi.mocked(createPostAction).mockReset();
    pushMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables the submit button until title, description, contact value, and consent are all filled", async () => {
    const user = userEvent.setup();
    renderForm();

    const submitButton = screen.getByRole("button", {
      name: ptPT.post.createForm.submit,
    });
    expect(submitButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.post.createForm.titleLabel),
      "Preciso de voluntários",
    );
    expect(submitButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.post.createForm.descriptionLabel),
      "Descrição detalhada do pedido.",
    );
    expect(submitButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.post.createForm.contactValueLabel),
      "912 345 678",
    );
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByLabelText(ptPT.post.createForm.consentLabel));
    expect(submitButton).toBeEnabled();
  });

  it("does not call the server action while required fields are missing", async () => {
    renderForm();

    const submitButton = screen.getByRole("button", {
      name: ptPT.post.createForm.submit,
    });
    expect(submitButton).toBeDisabled();
    expect(createPostAction).not.toHaveBeenCalled();
  });

  it("calls the server action once all required fields and consent are provided", async () => {
    vi.mocked(createPostAction).mockResolvedValue({ ok: true, postId: "post-1" });
    const user = userEvent.setup();
    renderForm();

    await user.type(
      screen.getByLabelText(ptPT.post.createForm.titleLabel),
      "Preciso de voluntários",
    );
    await user.type(
      screen.getByLabelText(ptPT.post.createForm.descriptionLabel),
      "Descrição detalhada do pedido.",
    );
    await user.type(
      screen.getByLabelText(ptPT.post.createForm.contactValueLabel),
      "912 345 678",
    );
    await user.click(screen.getByLabelText(ptPT.post.createForm.consentLabel));
    await user.click(
      screen.getByRole("button", { name: ptPT.post.createForm.submit }),
    );

    await vi.waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));
    expect(createPostAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Preciso de voluntários",
        description: "Descrição detalhada do pedido.",
        contactValue: "912 345 678",
        consent: true,
      }),
    );
  });
});

describe("CreatePostForm unsaved-changes guard", () => {
  beforeEach(() => {
    vi.mocked(createPostAction).mockReset();
    pushMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not warn before the user modifies anything", () => {
    renderForm();

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(false);

    const clickEvent = clickInternalLink("/my-posts");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it("warns on beforeunload and in-app link navigation once a field is dirty", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(ptPT.post.createForm.titleLabel), "Preciso de voluntários");

    const unloadEvent = dispatchBeforeUnload();
    expect(unloadEvent.defaultPrevented).toBe(true);

    vi.spyOn(window, "confirm").mockReturnValue(false);
    const clickEvent = clickInternalLink("/my-posts");
    expect(window.confirm).toHaveBeenCalledWith(UNSAVED_WARNING);
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it("deactivates the guard after a successful submit", async () => {
    vi.mocked(createPostAction).mockResolvedValue({ ok: true, postId: "post-1" });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(ptPT.post.createForm.titleLabel), "Preciso de voluntários");
    await user.type(
      screen.getByLabelText(ptPT.post.createForm.descriptionLabel),
      "Descrição detalhada do pedido.",
    );
    await user.type(screen.getByLabelText(ptPT.post.createForm.contactValueLabel), "912 345 678");
    await user.click(screen.getByLabelText(ptPT.post.createForm.consentLabel));
    await user.click(screen.getByRole("button", { name: ptPT.post.createForm.submit }));

    await vi.waitFor(() => expect(createPostAction).toHaveBeenCalledTimes(1));

    const unloadEvent = dispatchBeforeUnload();
    await vi.waitFor(() => expect(unloadEvent.defaultPrevented).toBe(false));

    const clickEvent = clickInternalLink("/my-posts");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(false);
  });
});
