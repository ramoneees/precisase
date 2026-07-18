/**
 * Photo upload Route Handler for the create-post form (design spec: "Foto
 * (opcional)" dropzone). Not tied to a specific post — the create-post form
 * uploads photos first (or as they're selected), collects the returned
 * relative URLs client-side, then submits them as
 * `extraAttributes.photos: string[]` when it calls
 * `postService.createPost` (see post-service.ts's doc comment on
 * `extraAttributes`).
 *
 * Design decisions (flagged for the final report, not just this comment):
 * - Accepted types: image/jpeg, image/png, image/webp only — anything else
 *   (including SVG, to avoid stored-XSS via inline scripts in SVG markup)
 *   is rejected with a 400 and a clear per-file error.
 * - Size cap: 5MB per file — generous enough for a phone photo, small
 *   enough to keep `public/uploads` from growing unbounded per post.
 * - Filename scheme: `crypto.randomUUID()` + the original extension
 *   (lower-cased, derived from the MIME type rather than trusting the
 *   client-supplied filename) — collision-safe and avoids path traversal
 *   issues from an attacker-controlled filename.
 * - Storage: `public/uploads/posts/<uuid>.<ext>`, written via `fs/promises`.
 *   KNOWN LIMITATION (see this project's build report): in the Docker/
 *   production deployment, `public/` is baked into the image and is not a
 *   persistent volume, so uploaded files would not survive a redeploy or
 *   container restart as currently built. Out of scope to fix here — flagged
 *   as a follow-up (mount a volume, or move to object storage).
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "posts");

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  for (const file of files) {
    if (!(file.type in ALLOWED_MIME_TYPES)) {
      return NextResponse.json(
        { error: "invalid_file_type", detail: file.name },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", detail: file.name },
        { status: 400 },
      );
    }
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const urls: string[] = [];
  for (const file of files) {
    const extension = ALLOWED_MIME_TYPES[file.type];
    const filename = `${randomUUID()}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOAD_DIR, filename), bytes);
    urls.push(`/uploads/posts/${filename}`);
  }

  return NextResponse.json({ urls });
}
