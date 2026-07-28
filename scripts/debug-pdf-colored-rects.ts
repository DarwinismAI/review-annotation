/**
 * Debug: extract all colored filled rectangles and text items with their positions.
 * This helps map text → background color via bounding-box overlap.
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

interface RGB { r: number; g: number; b: number }
interface ColoredRect { rgb: RGB; x: number; y: number; w: number; h: number; pageIndex: number }

function classifyColor(rgb: RGB): string {
  const { r, g, b } = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.97) return "white";
  if (g > r + 15 && g > b + 15 && lum > 0.7) return "GREEN";
  if (r > b + 40 && g > b + 40 && Math.abs(r - g) < 25) return "YELLOW";
  if (r > g + 25 && r > b + 25) return "RED";
  return `other(r=${r},g=${g},b=${b},lum=${lum.toFixed(2)})`;
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
  const opsReverse: Record<number, string> = {};
  for (const [name, code] of Object.entries(OPS)) { opsReverse[code] = name; }

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const allRects: ColoredRect[] = [];

  for (let pageIdx = 0; pageIdx < Math.min(4, pdf.numPages); pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);
    const opList = await page.getOperatorList();
    const fnArray = opList.fnArray as number[];
    const argsArray = opList.argsArray as unknown[][];

    let activeFill: RGB = { r: 0, g: 0, b: 0 };
    const matrixStack: number[][] = [[1,0,0,1,0,0]];
    let lastRect: { x: number; y: number; w: number; h: number } | null = null;

    // Apply a simple 2D affine transform to a point
    function applyMatrix(m: number[], x: number, y: number) {
      return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
    }

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const name = opsReverse[fn] ?? `op${fn}`;
      const args = argsArray[i] as unknown[];

      if (name === "setFillRGBColor") {
        // Args come as object {"0": R, "1": G, "2": B} (integers 0-255)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        activeFill = { r: a[0] ?? a["0"] ?? 0, g: a[1] ?? a["1"] ?? 0, b: a[2] ?? a["2"] ?? 0 };
      }

      if (name === "transform" && Array.isArray(args)) {
        // Replace top of matrix stack
        matrixStack[matrixStack.length - 1] = args as number[];
      }
      if (name === "save") matrixStack.push([...(matrixStack[matrixStack.length - 1])]);
      if (name === "restore") { if (matrixStack.length > 1) matrixStack.pop(); }

      // constructPath with op=19 (rectangle) gives [x,y,w,h] as 2nd arg element
      if (name === "constructPath" && Array.isArray(args)) {
        const ops2 = args[0] as number[];
        const pts = args[1] as number[];
        // op 19 = re (rectangle): next 4 values are x,y,w,h
        let ptIdx = 0;
        for (let k = 0; k < ops2.length; k++) {
          const op2 = ops2[k];
          if (op2 === 19) { // rectangle
            if (pts.length >= ptIdx + 4) {
              const rx = pts[ptIdx], ry = pts[ptIdx+1], rw = pts[ptIdx+2], rh = pts[ptIdx+3];
              lastRect = { x: rx, y: ry, w: rw, h: rh };
              ptIdx += 4;
            }
          } else if (op2 === 13) { ptIdx += 2; } // moveTo
          else if (op2 === 14) { ptIdx += 2; } // lineTo
          else if (op2 === 15) { ptIdx += 6; } // curveTo
          else if (op2 === 18) { /* closePath, no args */ }
        }
      }

      if ((name === "fill" || name === "eoFill" || name === "fillStroke") && lastRect) {
        const color = classifyColor(activeFill);
        if (color !== "white" && !color.startsWith("other(r=2") && !color.startsWith("other(r=1,g=1,b=1")) {
          const m = matrixStack[matrixStack.length - 1];
          const p1 = applyMatrix(m, lastRect.x, lastRect.y);
          const p2 = applyMatrix(m, lastRect.x + lastRect.w, lastRect.y + lastRect.h);
          allRects.push({
            rgb: { ...activeFill },
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            w: Math.abs(p2.x - p1.x),
            h: Math.abs(p2.y - p1.y),
            pageIndex: pageIdx,
          });
          console.log(`  Page${pageIdx+1} rect [${color}] rgb(${activeFill.r},${activeFill.g},${activeFill.b}) @ x=${p1.x.toFixed(0)},y=${p1.y.toFixed(0)},w=${Math.abs(p2.x-p1.x).toFixed(0)},h=${Math.abs(p2.y-p1.y).toFixed(0)}`);
        }
        lastRect = null;
      }
    }

    // Text items with positions
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    console.log(`  Page${pageIdx+1} viewport: ${viewport.width}x${viewport.height}, ${textContent.items.length} text items`);

    // Show first 10 text items with transforms
    textContent.items.slice(0, 10).forEach((item, idx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = item as any;
      console.log(`    [${idx}] "${s.str?.slice(0,30)}" tx=${JSON.stringify(s.transform)}`);
    });

    page.cleanup();
  }

  console.log(`\nTotal colored rects found: ${allRects.length}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
