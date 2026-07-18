"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Post detail photo area (design spec: ~320px tall, prev/next arrows + dot
 * indicators when there's more than one photo). Falls back to a single
 * placeholder image (no controls) when `photos` is empty — the caller is
 * responsible for generating that placeholder URL (see
 * `src/lib/placeholder-photo.ts`) and passing it as the sole entry so this
 * component doesn't need to know about categories/tints.
 */
export function PhotoGallery({ photos }: { photos: string[] }) {
  const t = useTranslations("post.detail.gallery");
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return null;
  }

  const hasMultiple = photos.length > 1;
  const current = photos[Math.min(index, photos.length - 1)]!;

  function goTo(next: number) {
    setIndex((next + photos.length) % photos.length);
  }

  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-2xl border border-[#E3DED2] bg-[#F7F4EE]">
      {/* eslint-disable-next-line @next/next/no-img-element -- external/uploaded photo URLs, not a static Next.js asset */}
      <img src={current} alt="" className="h-full w-full object-cover" />

      {hasMultiple ? (
        <>
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label={t("previous")}
            className="absolute top-1/2 left-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#232922] shadow hover:bg-white"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label={t("next")}
            className="absolute top-1/2 right-3 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#232922] shadow hover:bg-white"
          >
            ›
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {photos.map((photo, photoIndex) => (
              <button
                key={photo + photoIndex}
                type="button"
                aria-label={t("goToPhoto", { number: photoIndex + 1 })}
                onClick={() => goTo(photoIndex)}
                className={`h-2 w-2 rounded-full transition ${
                  photoIndex === index ? "bg-white" : "bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
