import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import ptPT from "../../../messages/pt-PT.json";
import ptBR from "../../../messages/pt-BR.json";
import { LanguageSwitcher } from "./language-switcher";

const replaceMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/",
}));

function renderSwitcher(locale: "pt-PT" | "pt-BR" | "en" = "pt-PT") {
  const messages = locale === "pt-PT" ? ptPT : locale === "pt-BR" ? ptBR : en;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="UTC"
    >
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LanguageSwitcher", () => {
  it("renders the current locale as the selected option", () => {
    renderSwitcher("pt-PT");
    const select = screen.getByLabelText("Idioma") as HTMLSelectElement;
    expect(select.value).toBe("pt-PT");
  });

  it("renders all configured locales as options in their native form", () => {
    renderSwitcher("en");
    const select = screen.getByLabelText("Language") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain("Português (PT)");
    expect(optionLabels).toContain("Português (BR)");
    expect(optionLabels).toContain("English");
  });

  it("calls router.replace with the new locale on change", async () => {
    const user = userEvent.setup();
    renderSwitcher("pt-PT");
    const select = screen.getByLabelText("Idioma");

    await user.selectOptions(select, "en");

    expect(replaceMock).toHaveBeenCalledWith("/", { locale: "en" });
  });
});