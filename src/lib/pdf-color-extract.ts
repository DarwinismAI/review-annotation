/**
 * PDF color-aware text extraction using pdfjs-dist (Node runtime, no worker).
 *
 * Vivipedia PDFs structure: background-color fill (rect or path) → restore →
 * save → dark fill → showText ops (one glyph per showText call).
 *
 * Algorithm:
 *   1. Walk the flattened op list; maintain active fill color.
 *   2. F1: sectionBgColor is STICKY — set by colored path-fill ops (f/B/EF).
 *      Reset ONLY when a NEUTRAL path-fill op fires, or at page-end.
 *      setFillRGBColor for dark text glyphs does NOT affect sectionBgColor.
 *   3. F2: At each colored fill op boundary, flush the current glyph accumulation.
 *      The accumulated string is checked against SCORE_RE BEFORE the merge step.
 *      This prevents score glyphs ("8","6",".","4") from being absorbed into long text.
 *   4. F3: Yellow check uses wide band (R>200 AND G>100 AND B<120 AND R>=G),
 *      placed BEFORE red to prevent amber rgb(254,154,0) from misfiring as red.
 *   5. F4: If a colored setFillRGBColor fires WITHOUT an intervening path-fill op,
 *      the next showText uses that fill as TEXT color (e.g. red warning glyphs).
 *   6. Merge per-fill-boundary chunks; merge consecutive same-color chunks that are not scores.
 *
 * Returns null when no non-neutral fill ops are found anywhere (no color layer).
 *
 * Server-side only. Lazy-imported to avoid Vercel bundle-init issues.
 */

const MAX_SEGMENTS = 300;

export type SegmentColor = "green" | "yellow" | "red" | "neutral";
export type SegmentType = "highlight" | "badge" | "warning" | "score" | "text";

/** Returned from extractColoredSegments — omits id/articleId (caller fills those) */
export interface ArticleSegmentData {
  order: number;
  text: string;
  color: SegmentColor;
  type: SegmentType;
  scoreValue: number | null;
  pageIndex: number;
}

interface RGB { r: number; g: number; b: number }

/** Relative luminance (WCAG). Input channels in [0..255]. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * True when an RGB fill is "neutral" — white, black, gray, or near-dark.
 * Used in F1 to decide whether a path-fill op resets sectionBgColor.
 */
function isNeutralFill(rgb: RGB): boolean {
  const lum = luminance(rgb.r, rgb.g, rgb.b);
  if (lum > 0.92 || lum < 0.08) return true;
  if (rgb.r < 30 && rgb.g < 30 && rgb.b < 30) return true;
  if (Math.abs(rgb.r - rgb.g) < 10 && Math.abs(rgb.g - rgb.b) < 10) return true;
  return false;
}

/**
 * Classify a fill RGB color into one of 4 spec-defined segment colors.
 * Thresholds tuned for Vivipedia's actual palette:
 *   - green:  rgb(0,201,80)   → lum≈0.50, G dominates strongly
 *   - yellow: rgb(254,154,0)  → F3 wide amber band, checked BEFORE red
 *   - red:    R >> G and R >> B
 *
 * Luminance floor for green lowered to 0.35 to capture Vivipedia rgb(0,201,80)
 * which has lum≈0.50 (spec default 0.7 would false-negative here).
 */
function classifyColor(rgb: RGB): SegmentColor {
  const { r, g, b } = rgb;
  const lum = luminance(r, g, b);

  if (isNeutralFill(rgb)) return "neutral";

  // Green: G > R+15 AND G > B+15 (luminance floor lowered to 0.35 for Vivipedia green)
  if (g > r + 15 && g > b + 15 && lum > 0.35) return "green";

  // F3: Yellow — wide band covers pure yellow (255,255,0) AND amber (254,154,0).
  // Checked BEFORE red so amber (|R-G|=100) does not misfire via red path.
  if (r > 200 && g > 100 && b < 120 && r >= g) return "yellow";

  // Red: R > G+25 AND R > B+25
  if (r > g + 25 && r > b + 25) return "red";

  return "neutral";
}

/** Score regex: standalone decimal like "86.4" or "8.6" */
const SCORE_RE = /^\s*\d{1,2}\.\d\s*$/;

function classifyType(
  text: string,
  color: SegmentColor
): { type: SegmentType; scoreValue: number | null } {
  if (color === "green" && SCORE_RE.test(text)) {
    return { type: "score", scoreValue: parseFloat(text.trim()) };
  }
  if (color === "red") return { type: "warning", scoreValue: null };
  if (color === "yellow" && text.trim().length < 20) return { type: "badge", scoreValue: null };
  if (color === "green") return { type: "highlight", scoreValue: null };
  return { type: "text", scoreValue: null };
}

/** Resolve the pdfjs legacy worker file path for Node runtime fake-worker setup. */
async function resolveWorkerSrc(): Promise<string> {
  const { createRequire } = await import("module");
  const { default: path } = await import("path");
  const selfUrl = import.meta.url ?? `file://${__filename}`;
  const req = createRequire(selfUrl);
  const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));
  return `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;
}

/**
 * Extract the unicode string from a pdfjs showText args array.
 * pdfjs v4: args[0] is an array of glyph objects with `unicode` field.
 */
function glyphsToString(args: unknown[]): string {
  const glyphs = args[0];
  if (!Array.isArray(glyphs)) return "";
  return glyphs
    .map((g) => (typeof g === "object" && g !== null ? (g as Record<string, unknown>).unicode ?? "" : ""))
    .join("");
}

/**
 * Parse colored text segments from a PDF buffer.
 *
 * @returns Ordered segments, or null if no colored fill ops found anywhere.
 */
export async function extractColoredSegments(
  buf: Buffer
): Promise<ArticleSegmentData[] | null> {
  // Lazy import — keeps pdfjs out of the webpack bundle for non-PDF routes.
  // pdfjs-dist v4 ships only the .mjs entry for the legacy build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);

  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = await resolveWorkerSrc();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opNames = new Map<number, string>(
    Object.entries(OPS).map(([name, code]) => [code as number, name])
  );

  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      disableWorker: true,
      verbosity: 0,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  } catch {
    return null;
  }

  const rawChunks: Array<{ text: string; color: SegmentColor; pageIndex: number }> = [];
  let hasColoredFill = false;

  for (let pageIdx = 0; pageIdx < pdf.numPages; pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    // Active fill color (updated by setFillRGB/Gray/Color).
    let activeFillColor: RGB = { r: 0, g: 0, b: 0 };

    // F1: sectionBgColor is STICKY — updated ONLY by path-fill ops (fill/eoFill/fillStroke).
    // setFillRGBColor for dark text glyphs is intentionally NOT allowed to reset this.
    // Reset on page-end, or when a NEUTRAL path-fill fires (e.g. white background rect).
    let sectionBgColor: SegmentColor = "neutral";

    // F4: pendingTextColor — set by setFillRGBColor when no path-fill follows before showText.
    // Only active when sectionBgColor === "neutral" (no colored bg section already established).
    // Cleared once a path-fill fires (which means the fill painted a background rect, not text).
    let pendingTextColor: SegmentColor = "neutral";
    let sinceLastPathFill = true; // true = no path-fill has fired since last setFillRGB

    // F2: Current accumulation buffer — flushed on EACH colored fill op boundary.
    // This ensures each green bullet block becomes its own chunk (not one merged blob).
    let accText = "";
    let accColor: SegmentColor = "neutral";

    /**
     * Flush current accumulation to rawChunks.
     * F2: If the accumulated text starts with a score pattern (e.g. "86.4..."),
     * split the score prefix off as a separate chunk before the remainder.
     */
    function flushAcc() {
      const t = accText.trim();
      accText = "";
      if (!t || accColor === "neutral") return;

      // F2: Check if text STARTS with a score number (possibly followed by more text).
      // Score chips on Vivipedia emit the number glyphs in the same fill op as following text.
      // eslint-disable-next-line no-useless-escape
      const scoreLeadMatch = t.match(/^(\d{1,2}\.\d)([\s\S]*)/);
      if (accColor === "green" && scoreLeadMatch) {
        const scoreStr = scoreLeadMatch[1];
        const rest = scoreLeadMatch[2]?.trim();
        // Emit score chunk first (isolated for classifyType detection)
        rawChunks.push({ text: scoreStr, color: accColor, pageIndex: pageIdx });
        // Emit remainder as separate highlight chunk if non-empty
        if (rest) rawChunks.push({ text: rest, color: accColor, pageIndex: pageIdx });
      } else {
        rawChunks.push({ text: t, color: accColor, pageIndex: pageIdx });
      }
    }

    const showTextOps = new Set([
      "showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText",
    ]);

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const name = opNames.get(fn) ?? "";
      const args = argsArray[i] as unknown[];

      // ── Color tracking ─────────────────────────────────────────────────────
      if (name === "setFillRGBColor") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        activeFillColor = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
        // F1: do NOT touch sectionBgColor here — dark text fills would reset it.
        // F4: classify as candidate text color (only applies if showText fires before next fill op).
        pendingTextColor = classifyColor(activeFillColor);
        sinceLastPathFill = true;
        continue;
      }
      if (name === "setFillGray") {
        const v = Math.round(((args[0] as number) ?? 0) * 255);
        activeFillColor = { r: v, g: v, b: v };
        pendingTextColor = "neutral";
        sinceLastPathFill = true;
        continue;
      }
      if (name === "setFillColor" || name === "setFillColorN") {
        if (Array.isArray(args) && args.length === 3) {
          activeFillColor = {
            r: Math.round((args[0] as number) * 255),
            g: Math.round((args[1] as number) * 255),
            b: Math.round((args[2] as number) * 255),
          };
          pendingTextColor = classifyColor(activeFillColor);
          sinceLastPathFill = true;
        }
        continue;
      }

      // ── Save / Restore ──────────────────────────────────────────────────────
      // F1: save/restore no longer reset sectionBgColor (sticky model).
      if (name === "save" || name === "restore") {
        continue;
      }

      // ── Path-fill ops ───────────────────────────────────────────────────────
      if (name === "fill" || name === "eoFill" || name === "fillStroke") {
        const bgColor = classifyColor(activeFillColor);

        // F2: Each colored fill op is a segment boundary — flush current accumulation
        // BEFORE starting a new segment under the new fill color.
        if (bgColor !== "neutral" || (accColor !== "neutral" && accText)) {
          flushAcc();
          accColor = "neutral";
        }

        if (bgColor !== "neutral") {
          hasColoredFill = true;
          sectionBgColor = bgColor;
          accColor = bgColor; // start accumulating text under this fill color
        } else if (isNeutralFill(activeFillColor)) {
          // F1: neutral path-fill explicitly ends any colored section
          sectionBgColor = "neutral";
          accColor = "neutral";
        }

        // F4: path-fill fired → pendingTextColor no longer applies to following showText
        sinceLastPathFill = false;
        pendingTextColor = "neutral";
        continue;
      }

      // ── Stroke/path-close ops — also end the text-color path ───────────────
      if (
        name === "stroke" || name === "closeStroke" ||
        name === "closeFillStroke" || name === "eoFillStroke" ||
        name === "endPath" || name === "clip" || name === "eoClip"
      ) {
        sinceLastPathFill = false;
        pendingTextColor = "neutral";
        continue;
      }

      // ── Text ops ───────────────────────────────────────────────────────────
      if (showTextOps.has(name)) {
        const text = glyphsToString(args);
        if (!text.trim()) continue;

        // F4: Text-color glyph path — active ONLY when there is no colored section bg
        // (sectionBgColor === "neutral"). A dark setFillRGBColor inside a yellow/green
        // section is used for text rendering, not as a segment color signal.
        let effectiveColor: SegmentColor;
        if (sinceLastPathFill && pendingTextColor !== "neutral" && sectionBgColor === "neutral") {
          // No bg section active — this setFillRGB is the text's own color (e.g. red warning).
          effectiveColor = pendingTextColor;
          hasColoredFill = true;
          if (accColor !== effectiveColor && accText) {
            flushAcc();
            accColor = effectiveColor;
          } else if (!accText) {
            accColor = effectiveColor;
          }
        } else {
          // Use the current section background color (sticky, set by path-fill ops).
          effectiveColor = sectionBgColor;
          if (effectiveColor !== accColor && accText) {
            flushAcc();
            accColor = effectiveColor;
          } else if (!accText) {
            accColor = effectiveColor;
          }
        }

        accText += text;
        continue;
      }
    }

    // Flush remaining accumulation at page-end
    flushAcc();
    // F1: sectionBgColor does not carry over to next page
    sectionBgColor = "neutral";
    accColor = "neutral";

    page.cleanup();
  }

  // No colored fills found anywhere → PDF has no color layer → C3 fallback
  if (!hasColoredFill) return null;

  // Filter out any empty or neutral chunks that slipped through.
  // No cross-fill merge — each fill-op boundary already produced one accumulated chunk.
  const finalChunks = rawChunks.filter(c => c.text.trim() && c.color !== "neutral");

  // Cap at MAX_SEGMENTS, classify, emit
  return finalChunks.slice(0, MAX_SEGMENTS).map((chunk, idx) => {
    const { type, scoreValue } = classifyType(chunk.text, chunk.color);
    return { order: idx, text: chunk.text, color: chunk.color, type, scoreValue, pageIndex: chunk.pageIndex };
  });
}
