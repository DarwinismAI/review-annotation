/**
 * Debug: inspect pdfjs setFillRGBColor args structure for page 1.
 * Run: pnpm tsx scripts/debug-args-structure.ts
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const PDF = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự/Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf";

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir,"legacy/build/pdf.worker.mjs")}`;
  }
  const buf = fs.readFileSync(PDF);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await (pdfjs as any).getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 }).promise;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string,number> = (pdfjs as any).OPS ?? {};
  const opN = new Map<number,string>(Object.entries(OPS).map(([n,c]) => [c as number, n]));

  const page = await pdf.getPage(1);
  const opList = await page.getOperatorList();
  const fns = opList.fnArray as number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args_ = opList.argsArray as any[][];

  let fillColor = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < fns.length && count < 50; i++) {
    const nm = opN.get(fns[i]) ?? `fn${fns[i]}`;
    const a = args_[i];
    if (nm === "setFillRGBColor") {
      console.log(`[${i}] setFillRGBColor: typeof=${typeof a}, isArray=${Array.isArray(a)}, keys=${JSON.stringify(Object.keys(a??{}))}`);
      console.log(`  a[0]=${a[0]}, a[1]=${a[1]}, a[2]=${a[2]}`);
      console.log(`  JSON: ${JSON.stringify(a).slice(0,100)}`);
      fillColor = [a[0]??0, a[1]??0, a[2]??0];
      count++;
    } else if (nm === "fill" || nm === "eoFill" || nm === "fillStroke") {
      const [r,g,b] = fillColor;
      const lum = (0.299*r+0.587*g+0.114*b)/255;
      console.log(`[${i}] ${nm}: current fill rgb(${r},${g},${b}) lum=${lum.toFixed(3)}`);
      // F3 check
      const isYellow = r>200 && g>100 && b<120 && r>=g;
      const isRed = r>g+25 && r>b+25;
      const isGreen = g>r+15 && g>b+15 && lum>0.35;
      console.log(`  isGreen=${isGreen} isYellow=${isYellow} isRed=${isRed}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
