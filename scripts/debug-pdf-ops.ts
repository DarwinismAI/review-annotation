/**
 * Debug script: dump all unique operator codes + args from a PDF page
 * to understand which fill ops are actually used.
 */

import fs from "fs";
import path from "path";

const SAMPLE_PDF = path.resolve(
  "/Users/haido/Downloads/BKTT-OPS",
  "Pháp luật - điểm 80-90",
  "Hình sự",
  "Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf"
);

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(
    () => import("pdfjs-dist/legacy/build/pdf.js" as string)
  );

  // pdfjs v4 requires a real workerSrc to initialise the fake-worker fallback.
  // In Node runtime we point it at the bundled legacy worker via file:// URL.
  if (pdfjs.GlobalWorkerOptions) {
    const { createRequire } = await import("module");
    const { fileURLToPath } = await import("url");
    const { default: path } = await import("path");
    const __filename = fileURLToPath(import.meta.url);
    const req = createRequire(__filename);
    const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opsReverse: Record<number, string> = {};
  for (const [name, code] of Object.entries(OPS)) {
    opsReverse[code] = name;
  }

  console.log("Known fill-related OPS codes:");
  const fillKeys = Object.entries(OPS)
    .filter(([k]) => k.toLowerCase().includes("fill") || k.toLowerCase().includes("color") || k.toLowerCase().includes("stroke"))
    .map(([k, v]) => `  ${k} = ${v}`);
  console.log(fillKeys.join("\n"));

  const buf = fs.readFileSync(SAMPLE_PDF);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const pdf = await loadingTask.promise;
  console.log(`\nPages: ${pdf.numPages}`);

  // Scan first 3 pages
  for (let pageIdx = 0; pageIdx < Math.min(3, pdf.numPages); pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    const seenOps = new Map<number, { name: string; sampleArgs: unknown[] }>();

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      if (!seenOps.has(fn)) {
        seenOps.set(fn, {
          name: opsReverse[fn] ?? "UNKNOWN",
          sampleArgs: argsArray[i] as unknown[],
        });
      }
    }

    console.log(`\n--- Page ${pageIdx + 1}: ${fnArray.length} ops, ${seenOps.size} unique ---`);
    for (const [code, { name, sampleArgs }] of Array.from(seenOps.entries()).sort((a, b) => a[0] - b[0])) {
      const sampleStr = JSON.stringify(sampleArgs).slice(0, 80);
      console.log(`  [${code}] ${name}: ${sampleStr}`);
    }

    // Also dump text content for comparison
    const textContent = await page.getTextContent();
    console.log(`  Text items: ${textContent.items.length}`);
    textContent.items.slice(0, 5).forEach((item) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`    "${(item as any).str}"`);
    });

    page.cleanup();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
