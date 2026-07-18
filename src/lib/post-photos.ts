/**
 * Reads `extraAttributes.photos: string[]` (see `PostRecord.extraAttributes`
 * in `src/server/services/post-service.ts`) defensively — `extraAttributes`
 * is untyped JSON, so this never trusts its shape.
 */
export function getPostPhotos(extraAttributes: Record<string, unknown>): string[] {
  const photos = extraAttributes["photos"];
  if (!Array.isArray(photos)) {
    return [];
  }
  return photos.filter((photo): photo is string => typeof photo === "string");
}
