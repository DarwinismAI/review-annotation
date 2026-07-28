/**
 * PDF paragraph extraction utility.
 * Server-side only (Node runtime). Uses pdf-parse v2 (PDFParse class) to extract
 * text, then splits into paragraphs on double-newlines (or sentence-boundary fallback).
 *
 * Safety caps: max 200 paragraphs, max 10 000 chars per paragraph.
 */

const MAX_PARAGRAPHS = 200;
const MAX_PARAGRAPH_CHARS = 10_000;

/**
 * Extract an ordered list of paragraph strings from a PDF buffer.
 * Returns [] on parse failure or if the PDF has no extractable text layer.
 * Caller should log failures and continue - this is intentionally non-throwing.
 *
 * pdf-parse is required lazily (inside function) to avoid top-level require() breaking
 * Vercel Node serverless bundle initialization - the module uses fs at load time which
 * fails before the function body executes.
 */
export async function extractParagraphs(buffer: Buffer): Promise<string[]> {
  // Lazy require: only loads pdf-parse when actually called (articleType='paragraph').
  // Top-level require would run at module init and break Vercel bundle for all requests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require("pdf-parse") as {
    PDFParse: new (opts: { data: Buffer }) => {
      getText: () => Promise<{ text: string }>;
      destroy: () => Promise<void>;
    };
  };
  let rawText: string;
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    rawText = result.text ?? "";
  } catch {
    return [];
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (!rawText.trim()) return [];

  // Primary split: one or more blank lines (paragraph breaks in most PDFs)
  let parts = rawText.split(/\n[ \t]*\n+/);

  // Fallback: single-column dense text with sentence-ending newlines
  if (parts.length <= 1) {
    parts = rawText.split(/(?<=[.!?])\n/);
  }

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.slice(0, MAX_PARAGRAPH_CHARS))
    .slice(0, MAX_PARAGRAPHS);
}
