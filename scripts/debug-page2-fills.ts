/**
 * Debug: trace ALL fill ops and color changes on page 2 to find red warning text path.
 * Run: pnpm tsx scripts/debug-page2-fills.ts
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const PDF = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự/Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf";

function lum(r: number, g: number, b: number) { return (0.299*r+0.587*g+0.114*b)/255; }
function cls(r: number, g: number, b: number): string {
  const l = lum(r,g,b);
  if (l>0.92||l<0.08) return "neutral";
  if (r<30&&g<30&&b<30) return "neutral";
  if (Math.abs(r-g)<10&&Math.abs(g-b)<10) return "neutral";
  if (g>r+15&&g>b+15&&l>0.35) return "green";
  if (r>200&&g>100&&b<120&&r>=g) return "yellow";
  if (r>g+25&&r>b+25) return "red";
  return `other(${r},${g},${b})`;
}
function isNeutral(r: number, g: number, b: number) {
  const l = lum(r,g,b); return l>0.92||l<0.08||(r<30&&g<30&&b<30)||(Math.abs(r-g)<10&&Math.abs(g-b)<10);
}

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir,"legacy/build/pdf.worker.mjs")}`;
  const buf = fs.readFileSync(PDF);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await (pdfjs as any).getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 }).promise;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string,number> = (pdfjs as any).OPS ?? {};
  const opN = new Map<number,string>(Object.entries(OPS).map(([n,c]) => [c as number, n]));
  const showOps = new Set(["showText","showSpacedText","nextLineShowText","nextLineSetSpacingShowText"]);

  const page = await pdf.getPage(2); // page 2 = pageIndex 1
  const opList = await page.getOperatorList();
  const fns = opList.fnArray as number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args_ = opList.argsArray as any[][];

  let fr=0, fg=0, fb=0;
  let sectionBg = "neutral";
  let pendingTxt = "neutral";
  let lastPathFill = false;
  let sflCount = 0; // last setFillRGB op index

  // print ops 3620-4232 (from green fill onwards)
  const start = 3620;
  console.log(`=== PAGE 2 OPS ${start}+ ===`);
  for (let i=start; i<fns.length; i++) {
    const nm = opN.get(fns[i]) ?? `fn${fns[i]}`;
    const a = args_[i];
    if (nm === "setFillRGBColor") {
      fr=a[0]??0; fg=a[1]??0; fb=a[2]??0;
      pendingTxt=cls(fr,fg,fb); lastPathFill=false; sflCount=i;
      if (cls(fr,fg,fb) !== "neutral") console.log(`[${i}] setFillRGB (${fr},${fg},${fb}) cls=${cls(fr,fg,fb)}`);
    } else if (nm==="fill"||nm==="eoFill"||nm==="fillStroke") {
      const c=cls(fr,fg,fb);
      if (c!=="neutral") sectionBg=c;
      else if (isNeutral(fr,fg,fb)) sectionBg="neutral";
      lastPathFill=true; pendingTxt="neutral";
      console.log(`[${i}] ${nm} rgb(${fr},${fg},${fb}) cls=${c} → sectionBg=${sectionBg}`);
    } else if (showOps.has(nm)) {
      const glyphs=a?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt=Array.isArray(glyphs)?glyphs.map((g:any)=>g?.unicode??"").join(""):"";
      if (!txt.trim()) continue;
      const eff=(!lastPathFill&&pendingTxt!=="neutral"&&sectionBg==="neutral")?pendingTxt:sectionBg;
      if (eff !== "neutral") console.log(`[${i}] showText "${txt}" eff=${eff} (lastPath=${lastPathFill},pending=${pendingTxt},bg=${sectionBg})`);
    } else if (nm==="save"||nm==="restore") {
      // skip for brevity
    }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
