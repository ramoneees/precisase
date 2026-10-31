import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./normalize-search-text";

describe("normalizeSearchText", () => {
  it("lowercases exact non-accented text without stripping", () => {
    expect(normalizeSearchText("Carro")).toBe("carro");
  });

  it('maps an unaccented query onto accented content ("acao" → "Ação")', () => {
    expect(normalizeSearchText("acao")).toBe("acao");
    expect(normalizeSearchText("Ação")).toBe("acao");
  });

  it('maps an accented query onto unaccented content ("Ação" → "acao")', () => {
    expect(normalizeSearchText("Ação")).toBe("acao");
    expect(normalizeSearchText("acao")).toBe("acao");
  });
});
