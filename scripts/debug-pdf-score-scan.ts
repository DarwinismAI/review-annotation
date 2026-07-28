/** Scan all pages for score numbers and tier/badge text */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const SAMPLE_PDF = path.resolve(
  "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự",
  "Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf"
);

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(
    () => import("pdfjs-dist/legacy/build/pdf.js" as string)
  );
  pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tc = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = tc.items.map((it) => (it as any).str ?? "").join("");
    const scores = text.match(/\b\d{1,2}\.\d\b/g);
    const hasTang = text.includes("Tầng") || text.includes("Tang");
    console.log(`Page ${p}: scores=${JSON.stringify(scores)}, hasTang=${hasTang}, preview="${text.slice(0, 100)}"`);
    page.cleanup();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
