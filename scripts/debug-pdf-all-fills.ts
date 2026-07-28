/**
 * Scan ALL pages for non-neutral fill colors and print them with context.
 * Also check for score patterns and badge text.
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

function classifyColor(r: number, g: number, b: number): string {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.92 || lum < 0.08) return "";
  if (r < 30 && g < 30 && b < 30) return "";
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) return "";
  if (g > r + 15 && g > b + 15 && lum > 0.35) return "GREEN";
  if (r > b + 40 && g > b + 40 && Math.abs(r - g) < 25) return "YELLOW";
  if (r > g + 25 && r > b + 25) return "RED";
  return `other(${r},${g},${b},lum=${lum.toFixed(2)})`;
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

  console.log(`Total pages: ${pdf.numPages}\n`);

  for (let pageIdx = 0; pageIdx < pdf.numPages; pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    const coloredFills: Array<{ rgb: string; label: string; opIdx: number }> = [];
    let activeFill = { r: 0, g: 0, b: 0 };

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const name = opNames.get(fn) ?? "";
      const args = argsArray[i] as unknown[];

      if (name === "setFillRGBColor") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        activeFill = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
      }
      if (name === "setFillGray") {
        const v = Math.round(((args[0] as number) ?? 0) * 255);
        activeFill = { r: v, g: v, b: v };
      }

      if (name === "fill" || name === "eoFill" || name === "fillStroke") {
        const label = classifyColor(activeFill.r, activeFill.g, activeFill.b);
        if (label) {
          coloredFills.push({ rgb: `rgb(${activeFill.r},${activeFill.g},${activeFill.b})`, label, opIdx: i });
        }
      }
    }

    if (coloredFills.length > 0) {
      console.log(`Page ${pageIdx + 1}: ${coloredFills.length} colored fills`);
      // Deduplicate by rgb
      const seen = new Set<string>();
      for (const f of coloredFills) {
        if (!seen.has(f.label)) {
          seen.add(f.label);
          console.log(`  [op${f.opIdx}] ${f.label} ${f.rgb}`);
        }
      }
    }

    // Also dump full text content to check for score/badge text
    const textContent = await page.getTextContent();
    const allText = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it) => (it as any).str as string ?? "")
      .join("");
    // Look for score patterns
    const scoreMatch = allText.match(/\b\d{1,2}\.\d\b/g);
    if (scoreMatch) {
      console.log(`  Scores found in text: ${scoreMatch.join(", ")}`);
    }
    // Look for tier / badge text
    if (allText.includes("Tầng") || allText.includes("tier") || allText.includes("Nhập môn") || allText.includes("Cơ bản")) {
      const tiers = allText.match(/(Tầng\s*\d+|Nhập môn|Cơ bản|Trung cấp|Nâng cao)/g);
      if (tiers) console.log(`  Tier tags: ${tiers.join(", ")}`);
    }

    page.cleanup();
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
