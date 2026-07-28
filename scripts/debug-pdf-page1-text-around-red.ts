/**
 * Debug page 1: show all fill ops + text ops in sequence,
 * focusing on what text appears after red/orange fill.
 * Also look for score numbers and Tầng badge.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const SAMPLE_PDF = path.resolve(
  "/Users/haido/Downloads/BKTT-OPS",
  "Pháp luật - điểm 80-90",
  "Hình sự",
  "Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf"
);

function glyphsToString(args: unknown[]): string {
  const glyphs = args[0];
  if (!Array.isArray(glyphs)) return "";
  return glyphs.map((g) => (typeof g === "object" && g !== null ? (g as Record<string, unknown>).unicode ?? "" : "")).join("");
}

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(
    () => import("pdfjs-dist/legacy/build/pdf.js" as string)
  );
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opNames = new Map<number, string>(
    Object.entries(OPS).map(([name, code]) => [code as number, name])
  );

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  for (const pageIdx of [0, 1]) { // pages 1 and 2
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    const textContent = await page.getTextContent();
    const allText = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it) => (it as any).str as string ?? "")
      .join(" ");

    console.log(`\n=== Page ${pageIdx + 1} ===`);
    console.log(`All text: "${allText.slice(0, 500)}"`);

    let activeFill = { r: 0, g: 0, b: 0 };
    let saveDepth = 0;
    let sectionColor = "neutral";
    let colorDepth = -1;

    const showOps = new Set(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"]);
    const fillOps = new Set(["fill", "eoFill", "fillStroke"]);

    // Print ops around fill + text for first 2000 ops
    for (let i = 0; i < Math.min(fnArray.length, 2000); i++) {
      const fn = fnArray[i];
      const name = opNames.get(fn) ?? "";
      const args = argsArray[i] as unknown[];

      if (name === "setFillRGBColor") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        activeFill = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
        const lum = (0.299 * activeFill.r + 0.587 * activeFill.g + 0.114 * activeFill.b) / 255;
        // Only print if non-trivial color
        if (lum > 0.08 && lum < 0.92 && !(Math.abs(activeFill.r - activeFill.g) < 15 && Math.abs(activeFill.g - activeFill.b) < 15)) {
          console.log(`  [${i}] setFillRGB rgb(${activeFill.r},${activeFill.g},${activeFill.b}) lum=${lum.toFixed(2)}`);
        }
      }
      if (name === "save") { saveDepth++; }
      if (name === "restore") {
        if (colorDepth >= 0 && saveDepth <= colorDepth) { sectionColor = "neutral"; colorDepth = -1; }
        saveDepth = Math.max(0, saveDepth - 1);
      }
      if (fillOps.has(name)) {
        const { r, g, b } = activeFill;
        // Classify
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        let cls = "";
        if (lum > 0.92 || lum < 0.08 || (r < 30 && g < 30 && b < 30) || (Math.abs(r-g)<10 && Math.abs(g-b)<10)) cls = "neutral";
        else if (g > r + 15 && g > b + 15 && lum > 0.35) { cls = "GREEN"; sectionColor = "GREEN"; colorDepth = saveDepth; }
        else if (r > b + 40 && g > b + 40 && Math.abs(r-g) < 25) { cls = "YELLOW"; sectionColor = "YELLOW"; colorDepth = saveDepth; }
        else if (r > g + 25 && r > b + 25) { cls = "RED/ORANGE"; sectionColor = "RED"; colorDepth = saveDepth; }
        else cls = `other`;
        if (cls !== "neutral") console.log(`  [${i}] fill → ${cls} (depth=${saveDepth})`);
      }
      if (showOps.has(name)) {
        const text = glyphsToString(args);
        if (text.trim() && sectionColor !== "neutral") {
          console.log(`    TEXT [${sectionColor}]: "${text}" (depth=${saveDepth})`);
        }
      }
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
