/**
 * Debugger ground-truth inspector (meta-harness iter-1 evaluator).
 * Inspects pages 1-3: fill-color ops + surrounding text + parser output.
 *
 * Original content preserved below (unused after rewrite).
 */

import { readFileSync } from "fs";

async function main() {
  const pdfPath = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự/Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf";
  const buf = readFileSync(pdfPath);

  // Lazy import pdfjs
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);

  if (pdfjs.GlobalWorkerOptions) {
    const { createRequire } = await import("module");
    const { default: path } = await import("path");
    const req = createRequire(import.meta.url);
    const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;
  }

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
    verbosity: 0,
  } as any).promise;

  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opNames = new Map<number, string>(
    Object.entries(OPS).map(([name, code]) => [code as number, name])
  );

  console.log(`[DEBUG] PDF has ${pdf.numPages} pages. Scanning for color ops...\n`);

  for (let pageIdx = 0; pageIdx < Math.min(pdf.numPages, 2); pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    console.log(`\n=== Page ${pageIdx + 1} Color Ops ===`);
    let colorOpCount = 0;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const name = opNames.get(fn) ?? "";
      const args = argsArray[i] as unknown[];

      // Log all color-setting ops
      if (
        name === "setFillRGBColor" ||
        name === "setFillColor" ||
        name === "setFillColorN" ||
        name === "setFillGray" ||
        name === "fill" ||
        name === "eoFill" ||
        name === "fillStroke"
      ) {
        if (colorOpCount < 50) {
          // Limit output
          if (name === "setFillRGBColor") {
            const a = args as any;
            console.log(`[${i}] setFillRGBColor: [${a[0]}, ${a[1]}, ${a[2]}]`);
          } else if (name === "fill" || name === "eoFill" || name === "fillStroke") {
            console.log(`[${i}] ${name} (applies current fill color)`);
          } else if (name === "setFillGray") {
            const v = Math.round(((args[0] as number) ?? 0) * 255);
            console.log(`[${i}] setFillGray: ${v}`);
          } else {
            console.log(`[${i}] ${name}`);
          }
          colorOpCount++;
        }
      }

      // Also log showText ops with their args to see what text we're extracting
      if ((name === "showText" || name === "showSpacedText") && colorOpCount < 30) {
        const glyphs = args[0];
        if (Array.isArray(glyphs)) {
          const text = glyphs
            .map((g) => (typeof g === "object" && g !== null ? (g as any).unicode ?? "" : ""))
            .join("")
            .slice(0, 40);
          console.log(`[${i}] showText: "${text}"`);
        }
      }
    }

    if (colorOpCount > 50) {
      console.log(`... and ${colorOpCount - 50} more color ops`);
    }

    page.cleanup();
  }

  console.log("\n[DEBUG] Color inspection complete.");
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
