/**
 * Pure color-math helpers for branding/theme calculations.
 * No dependencies — safe to import from any runtime.
 */

/**
 * Lighten a hex color by mixing it with white.
 * @param hex  6-digit hex string (e.g. "#2f6b4f"), with or without "#"
 * @param t    0 = unchanged, 1 = pure white
 */
export function lighten(hex: string, t: number): string {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const lr = Math.round(r + (255 - r) * t);
  const lg = Math.round(g + (255 - g) * t);
  const lb = Math.round(b + (255 - b) * t);

  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}
