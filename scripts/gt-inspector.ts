/**
 * Meta-harness debugger: ground-truth page inspector.
 * Run from project root: pnpm tsx scripts/gt-inspector.ts
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);
const pkgDir = path.dirname(req.resolve("pdfjs-dist/package.json"));

const PDF = path.resolve(
  "/Users/haido/Downloads/BKTT-OPS",
  "Pháp luật - điểm 80-90",
  "Hình sự",
  "Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf"
);

function cls(r: number, g: number, b: number): string {
  const lum = (0.299*r + 0.587*g + 0.114*b)/255;
  if (lum > 0.92 || lum < 0.08) return "";
  if (r<30 && g<30 && b<30) return "";
  if (Math.abs(r-g)<10 && Math.abs(g-b)<10) return "";
  if (g>r+15 && g>b+15 && lum>0.35) return "GREEN";
  if (r>b+40 && g>b+40 && Math.abs(r-g)<25) return "YELLOW";
  if (r>g+25 && r>b+25) return "RED";
  return `OTHER(${r},${g},${b},lum=${lum.toFixed(2)})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function inspectPage(pdfjs: any, pdf: any, pgNum: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string,number> = (pdfjs as any).OPS ?? {};
  const opN = new Map<number,string>(Object.entries(OPS).map(([n,c]) => [c as number, n]));
  const showOps = new Set(["showText","showSpacedText","nextLineShowText","nextLineSetSpacingShowText"]);
  const page = await pdf.getPage(pgNum);
  const opList = await page.getOperatorList();
  const fns = opList.fnArray as number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args_ = opList.argsArray as any[][];
  const tc = await page.getTextContent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allText = tc.items.map((it: any) => (it as any).str ?? "").join(" ");

  console.log(`\n${"=".repeat(64)}`);
  console.log(`PAGE ${pgNum} (total ops: ${fns.length})`);
  for (const kw of ["86.4","Tầng 2","Tầng","Với lĩnh vực","Tóm tắt nhanh"]) {
    console.log(`  "${kw}" in text layer: ${allText.includes(kw) ? "YES" : "NO"}`);
  }

  let fill: [number,number,number] = [0,0,0];
  const allFills: {opIdx:number; rgb:string; label:string; tw:string[]}[] = [];

  for (let i=0; i<fns.length; i++) {
    const nm = opN.get(fns[i]) ?? "";
    const a = args_[i];
    if (nm==="setFillRGBColor") fill=[a[0]??0,a[1]??0,a[2]??0];
    else if (nm==="setFillGray") { const v=Math.round((a[0]??0)*255); fill=[v,v,v]; }
    else if (nm==="setFillColor" && a.length===3) fill=[Math.round(a[0]*255),Math.round(a[1]*255),Math.round(a[2]*255)];
    else if (nm==="fill" || nm==="eoFill" || nm==="fillStroke") {
      const label = cls(fill[0],fill[1],fill[2]);
      const tw: string[] = [];
      for (let j=i+1; j<fns.length && tw.length<6; j++) {
        const n2 = opN.get(fns[j]) ?? "";
        if (showOps.has(n2)) {
          const glyphs = args_[j]?.[0];
          if (Array.isArray(glyphs)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = glyphs.map((g:any)=>g?.unicode??"").join("").trim();
            if (t) tw.push(t.slice(0,25));
          }
        }
      }
      allFills.push({opIdx:i, rgb:`rgb(${fill[0]},${fill[1]},${fill[2]})`, label, tw});
    }
  }

  const colored = allFills.filter(e=>e.label!=="");
  console.log(`\nColored fills (non-neutral): ${colored.length}/${allFills.length} total fill ops`);
  for (const ev of colored) {
    console.log(`  [op${ev.opIdx}] ${ev.rgb} → ${ev.label}`);
    if (ev.tw.length>0) console.log(`    text-after: ${ev.tw.map(t=>`"${t}"`).join(" | ")}`);
    else console.log(`    text-after: NONE (decorative/SVG, no showText ops follow)`);
  }
  page.cleanup();
}

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir,"legacy/build/pdf.worker.mjs")}`;
  }
  const buf = fs.readFileSync(PDF);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await pdfjs.getDocument({ data:new Uint8Array(buf), disableWorker:true, verbosity:0 } as any).promise;
  console.log(`PDF: ${(buf.length/1024).toFixed(1)} KB, ${pdf.numPages} pages`);
  for (const pg of [1,2,3]) await inspectPage(pdfjs, pdf, pg);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
