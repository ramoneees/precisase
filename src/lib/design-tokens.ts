/**
 * Shared design tokens for the "Precisa-se" UI — single source of truth for
 * the color palette translated from the Claude Design prototype
 * (`Precisa-se.dc.html`). Consumed by:
 *
 * - Places that need a raw hex string at runtime (e.g. the placeholder
 *   photo SVG generator, inline `style` props for computed badge colors).
 * - Documentation/reference for the literal Tailwind arbitrary-value
 *   classes used across components (e.g. `bg-[#2F6B4F]`) — Tailwind's JIT
 *   compiler needs those class strings to appear literally in source, so
 *   this file cannot replace them, only keep the underlying values in sync.
 *
 * Other agents building the create-post form, "my posts" page, and
 * moderation queue should import from here rather than re-declaring hex
 * values, so the whole app stays visually consistent.
 */

export const colors = {
  background: "#F7F4EE",
  foreground: "#232922",
  border: "#E3DED2",
  mutedText: "#6B7268",
  mutedTextLight: "#9AA098",
  card: "#FFFFFF",

  /** Brand primary — muted green. */
  primary: "#2F6B4F",
  primaryTint: "#E6F0EA",

  /** Brand secondary/accent — warm terracotta. */
  accent: "#C4622D",
  accentTint: "#FBEBE0",

  status: {
    active: { fg: "#2F6B4F", bg: "#E6F0EA" },
    pending: { fg: "#8A6D23", bg: "#FBF0DD" },
    closed: { fg: "#6B7268", bg: "#ECEAE4" },
    rejected: { fg: "#B23B23", bg: "#F7E4DE" },
  },

  type: {
    offer: { fg: "#2F6B4F", bg: "#E6F0EA" },
    request: { fg: "#C4622D", bg: "#FBEBE0" },
  },
} as const;

export type StatusColorKey = keyof typeof colors.status;
export type TypeColorKey = keyof typeof colors.type;
