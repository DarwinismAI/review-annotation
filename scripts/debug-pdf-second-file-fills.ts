/** Scan the second Vivipedia PDF for colored fills and score numbers */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const PDF_DIR = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự";

function classifyColor(r: number, g: number, b: number): string {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.92 || lum < 0.08) return "";
  if (r < 30 && g < 30 && b < 30) return "";
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) return "";
  if (g > r + 15 && g > b + 15 && lum > 0.35) return "GREEN";
  if (r > b + 40 && g > b + 40 && Math.abs(r - g) < 25) return "YELLOW";
  if (r > g + 25 && r > b + 25) return "RED";
  return `other(${r},${g},${b})`;
}

async function scanPdf(filePath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(
    () => import("pdfjs-dist/legacy/build/pdf.js" as string)
  );
  pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opNames = new Map<number, string>(
    Object.entries(OPS).map(([name, code]) => [code as number, name])
  );

  const buf = fs.readFileSync(filePath);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const coloredFills = new Set<string>();
  let hasScore = false;
  let hasTang = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    let activeFill = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < fnArray.length; i++) {
      const name = opNames.get(fnArray[i]) ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = argsArray[i] as any;
      if (name === "setFillRGBColor") {
        activeFill = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
      }
      if (name === "fill" || name === "eoFill" || name === "fillStroke") {
        const label = classifyColor(activeFill.r, activeFill.g, activeFill.b);
        if (label) coloredFills.add(`${label}:rgb(${activeFill.r},${activeFill.g},${activeFill.b})`);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tc = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = tc.items.map((it) => (it as any).str ?? "").join("");
    if (text.match(/\b\d{1,2}\.\d\b/)) hasScore = true;
    if (text.includes("Tầng")) hasTang = true;
    page.cleanup();
  }

  console.log(`  Colors: ${[...coloredFills].join(", ")}`);
  console.log(`  hasScore: ${hasScore}, hasTang: ${hasTang}`);
}

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.endsWith(".pdf"));
  for (const f of files) {
    console.log(`\n=== ${f} ===`);
    await scanPdf(path.join(PDF_DIR, f));
  }

  // Also check other PDF folders
  const rootDir = "/Users/haido/Downloads/BKTT-OPS";
  const domains = fs.readdirSync(rootDir).filter((d) => {
    try { return fs.statSync(path.join(rootDir, d)).isDirectory(); } catch { return false; }
  });
  for (const domain of domains.slice(0, 2)) {
    const subDirs = fs.readdirSync(path.join(rootDir, domain)).filter((d) => {
      try { return fs.statSync(path.join(rootDir, domain, d)).isDirectory(); } catch { return false; }
    });
    for (const sub of subDirs.slice(0, 2)) {
      const pdfs = fs.readdirSync(path.join(rootDir, domain, sub)).filter((f) => f.endsWith(".pdf"));
      for (const f of pdfs.slice(0, 2)) {
        console.log(`\n=== ${domain}/${sub}/${f} ===`);
        await scanPdf(path.join(rootDir, domain, sub, f));
      }
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
