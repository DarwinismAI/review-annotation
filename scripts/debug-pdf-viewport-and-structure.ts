/**
 * Debug: understand PDF structure for color extraction.
 * Strategy: use the operator list but track the full CTM stack including
 * paintFormXObjectBegin to get correct rect positions in viewport space.
 * Also check raw PDF structure to see if there is a simpler approach.
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

// Multiply two 6-element CTM matrices [a,b,c,d,e,f]
function matMul(m1: number[], m2: number[]): number[] {
  const [a1,b1,c1,d1,e1,f1] = m1;
  const [a2,b2,c2,d2,e2,f2] = m2;
  return [
    a1*a2 + c1*b2,
    b1*a2 + d1*b2,
    a1*c2 + c1*d2,
    b1*c2 + d1*d2,
    a1*e2 + c1*f2 + e1,
    b1*e2 + d1*f2 + f1,
  ];
}

function applyMatrix(m: number[], x: number, y: number) {
  return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
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

  // Try page 3 (Tóm tắt nhanh with green bullets)
  const pageIdx = 2;
  const page = await pdf.getPage(pageIdx + 1);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`Page ${pageIdx+1} viewport: ${viewport.width}x${viewport.height}`);
  console.log(`Viewport transform: ${JSON.stringify(viewport.transform)}`);

  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];

  // Track CTM stack with proper matrix multiplication
  // Start with the viewport transform (converts PDF user space → viewport pixels)
  const vpT = viewport.transform; // [sx, 0, 0, sy, tx, ty] typically [1,0,0,-1,0,792]
  const ctmStack: number[][] = [vpT.slice()];
  let activeFill = { r: 0, g: 0, b: 0 };

  interface ColoredRect { rgb: typeof activeFill; x: number; y: number; w: number; h: number }
  const rects: ColoredRect[] = [];
  let lastRawRect: { x: number; y: number; w: number; h: number } | null = null;

  function classifyColor(r: number, g: number, b: number): string {
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum > 0.97) return "white";
    if (g > r + 15 && g > b + 15 && lum > 0.7) return "GREEN";
    if (r > b + 40 && g > b + 40 && Math.abs(r - g) < 25) return "YELLOW";
    if (r > g + 25 && r > b + 25) return "RED";
    return `other(${r},${g},${b})`;
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const name = opsReverse[fn] ?? `op${fn}`;
    const args = argsArray[i] as unknown[];

    if (name === "setFillRGBColor") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = args as any;
      activeFill = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
    }

    if (name === "transform" && Array.isArray(args) && args.length === 6) {
      // Concatenate with current CTM
      const cur = ctmStack[ctmStack.length - 1];
      ctmStack[ctmStack.length - 1] = matMul(cur, args as number[]);
    }

    if (name === "save") {
      ctmStack.push([...ctmStack[ctmStack.length - 1]]);
    }
    if (name === "restore") {
      if (ctmStack.length > 1) ctmStack.pop();
    }

    if (name === "paintFormXObjectBegin" && Array.isArray(args) && args[0]) {
      // args[0] is the form XObject's matrix, args[1] is its bbox
      const formMatrix = args[0] as number[] | null;
      // Push a new save + apply form matrix
      ctmStack.push([...ctmStack[ctmStack.length - 1]]);
      if (formMatrix && formMatrix.length === 6) {
        const cur = ctmStack[ctmStack.length - 1];
        ctmStack[ctmStack.length - 1] = matMul(cur, formMatrix);
      }
    }
    if (name === "paintFormXObjectEnd") {
      if (ctmStack.length > 1) ctmStack.pop();
    }

    if (name === "constructPath" && Array.isArray(args)) {
      const ops2 = args[0] as number[];
      const pts = args[1] as number[];
      let ptIdx = 0;
      for (const op2 of ops2) {
        if (op2 === 19) { // rectangle
          if (pts.length >= ptIdx + 4) {
            lastRawRect = { x: pts[ptIdx], y: pts[ptIdx+1], w: pts[ptIdx+2], h: pts[ptIdx+3] };
            ptIdx += 4;
          }
        } else if (op2 === 13 || op2 === 14) { ptIdx += 2; }
        else if (op2 === 15) { ptIdx += 6; }
      }
    }

    if ((name === "fill" || name === "eoFill") && lastRawRect) {
      const ctm = ctmStack[ctmStack.length - 1];
      const p1 = applyMatrix(ctm, lastRawRect.x, lastRawRect.y);
      const p2 = applyMatrix(ctm, lastRawRect.x + lastRawRect.w, lastRawRect.y + lastRawRect.h);
      const color = classifyColor(activeFill.r, activeFill.g, activeFill.b);
      if (!color.includes("white")) {
        console.log(`  fill: ${color} rgb(${activeFill.r},${activeFill.g},${activeFill.b}) @ viewport x=${p1.x.toFixed(1)},y=${p1.y.toFixed(1)} → x=${p2.x.toFixed(1)},y=${p2.y.toFixed(1)}`);
        rects.push({ rgb: { ...activeFill }, x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) });
      }
      lastRawRect = null;
    }
  }

  // Now check text item positions vs rects
  console.log(`\nColored rects found: ${rects.length}`);
  const textContent = await page.getTextContent();
  console.log(`Text items: ${textContent.items.length}`);

  // Show first 15 text items with y positions
  console.log("\nText item positions (viewport y):");
  textContent.items.slice(0, 20).forEach((item, idx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = item as any;
    const tx = s.transform?.[4] ?? 0;
    const ty = s.transform?.[5] ?? 0;
    console.log(`  [${idx}] "${s.str?.slice(0,30)}" tx=${tx.toFixed(1)} ty=${ty.toFixed(1)}`);
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
