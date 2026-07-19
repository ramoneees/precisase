import { describe, expect, it } from "vitest";
import { diffKeys } from "./check-i18n-parity.mjs";

describe("diffKeys", () => {
  it("reports no drift when catalogs share the same key set", () => {
    const canonical = {
      nav: { home: "Início", posts: "Publicações" },
      auth: { signIn: { title: "Entrar" } },
    };
    const en = {
      nav: { home: "Home", posts: "Posts" },
      auth: { signIn: { title: "Sign in" } },
    };
    const ptBR = {
      nav: { home: "Início", posts: "Publicações" },
      auth: { signIn: { title: "Entrar" } },
    };

    expect(diffKeys(canonical, en)).toEqual({ missing: [], extra: [] });
    expect(diffKeys(canonical, ptBR)).toEqual({ missing: [], extra: [] });
  });

  it("reports a missing nested key present in the canonical catalog but absent from the target", () => {
    const canonical = {
      nav: { home: "Início" },
      auth: { signIn: { title: "Entrar", subtitle: "Bem-vindo de volta" } },
    };
    const en = {
      nav: { home: "Home" },
      auth: { signIn: { title: "Sign in" } },
    };

    const { missing, extra } = diffKeys(canonical, en);

    expect(missing).toEqual(["auth.signIn.subtitle"]);
    expect(extra).toEqual([]);
  });
});
