/**
 * `Post.extraAttributes.photos` stores relative upload paths (see
 * `PostRecord.extraAttributes` in `src/server/services/post-service.ts`).
 * The upload mechanism itself is out of scope here (create-post-form
 * agent's job) — this just normalizes whatever string ends up in that
 * array into something usable as an `<img src>`: absolute URLs and data
 * URIs pass through untouched, anything else is treated as relative to the
 * site root.
 */
export function resolvePhotoUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) {
    return path;
  }
  return path.startsWith("/") ? path : `/${path}`;
}
