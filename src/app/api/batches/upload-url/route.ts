import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { createSignedUploadUrl } from "@/lib/supabase-storage";
import { createId } from "@paralleldrive/cuid2";

/**
 * POST /api/batches/upload-url
 * Returns a short-lived signed URL the browser can PUT a JSON or ZIP to directly.
 * Avoids routing large payloads through the Vercel function body (4.5MB cap).
 */
const ALLOWED_EXTENSIONS = [".zip", ".json"] as const;

export const POST = requireAdmin(async (req) => {
  let body: { filename?: string };
  try {
    body = (await req.json()) as { filename?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Yêu cầu phải là JSON" } },
      { status: 400 }
    );
  }

  const raw = body.filename?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu trường filename" } },
      { status: 400 }
    );
  }

  // Strip path traversal + keep only the leaf filename.
  const safeFilename = raw.split("/").pop()?.split("\\").pop() ?? "upload.zip";
  const lower = safeFilename.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return NextResponse.json(
      { error: { code: "INVALID_FILENAME", message: "File phải là .json hoặc .zip" } },
      { status: 400 }
    );
  }

  const stagingId = createId();
  const storageKey = `_staging/${stagingId}/${safeFilename}`;

  try {
    const { signedUrl, token } = await createSignedUploadUrl(storageKey);
    return NextResponse.json({ data: { signedUrl, token, storageKey } });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "SIGNED_URL_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
});
