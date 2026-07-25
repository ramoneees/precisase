/**
 * Branding asset upload endpoint for admin/moderator use only.
 *
 * Accepts logo and favicon uploads with stricter controls than the general
 * photo upload route:
 * - Auth: admin or moderator role required (not just authenticated)
 * - Types: PNG, JPEG, WebP, SVG (SVG allowed here for logos, unlike general uploads)
 * - Size: 2MB per file (stricter than general uploads' 5MB)
 * - Count: single file per request
 * - Naming: fixed filenames based on field name (logo.png, favicon.png, etc.)
 *
 * Storage: `public/uploads/branding/` with overwrite semantics.
 *
 * KNOWN LIMITATION: same as general uploads — in Docker/prod, `public/` is
 * baked into the image and not a persistent volume. Out of scope for MVP.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // SVG removed due to XSS vulnerability - SVGs can contain embedded scripts
  // If SVG support is needed, implement server-side sanitization with svgo/DOMPurify
};

const ALLOWED_FIELD_NAMES = ["logo", "favicon"] as const;

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "branding");

export async function POST(request: Request): Promise<NextResponse> {
  // Stricter auth: only admin or moderator can upload branding assets
  const session = await auth();
  if (
    !session?.user ||
    (session.user.role !== "admin" && session.user.role !== "moderator")
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const files = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);
  const fieldName = formData.get("field") as string | null;

  // Validate: exactly one file and a field name
  if (files.length === 0 || !fieldName) {
    return NextResponse.json(
      { error: "missing_file_or_field" },
      { status: 400 },
    );
  }
  if (files.length > 1) {
    return NextResponse.json(
      { error: "multiple_files_not_allowed" },
      { status: 400 },
    );
  }

  // Validate field name against whitelist to prevent path traversal
  if (!ALLOWED_FIELD_NAMES.includes(fieldName as any)) {
    return NextResponse.json(
      { error: "invalid_field_name" },
      { status: 400 },
    );
  }

  const file = files[0];

  // Validate MIME type (SVG allowed here for logos)
  if (!(file.type in ALLOWED_MIME_TYPES)) {
    return NextResponse.json(
      { error: "invalid_file_type" },
      { status: 400 },
    );
  }

  // Validate size (stricter 2MB limit)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  // Fixed filename based on field name + extension derived from MIME type
  const extension = ALLOWED_MIME_TYPES[file.type];
  const filename = `${fieldName}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  return NextResponse.json({ url: `/uploads/branding/${filename}` });
}
