/**
 * Inline SVG placeholder for posts without photos — no external asset
 * needed. Ports the intent of the Claude Design prototype's own
 * placeholder-SVG approach: a tiled/striped background tinted with the
 * post's category color, plus a short text label, returned as a
 * `data:image/svg+xml` URI usable directly as an `<img src>`.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * @param label short text shown centered on the placeholder (e.g. the
 *   category name).
 * @param tint hex color used for the tiled stripes and label text.
 */
export function placeholderPhoto(label: string, tint: string): string {
  const safeLabel = escapeXml(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<defs>
<pattern id="stripes" width="28" height="28" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
<rect width="28" height="28" fill="${tint}" fill-opacity="0.05"/>
<rect width="14" height="28" fill="${tint}" fill-opacity="0.09"/>
</pattern>
</defs>
<rect width="400" height="300" fill="#F7F4EE"/>
<rect width="400" height="300" fill="url(#stripes)"/>
<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="${tint}">${safeLabel}</text>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
