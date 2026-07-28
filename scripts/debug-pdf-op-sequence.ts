/**
 * Print the first 400 ops of page 3 (Tóm tắt nhanh) in sequence,
 * focusing on fill/save/restore/text to understand the exact grouping.
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

  // Page 3 = "Tóm tắt nhanh" (pageIdx=2)
  const page = await pdf.getPage(3);
  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];

  // Get text content for cross-reference
  const textContent = await page.getTextContent();
  const unicodeItems = textContent.items.map((it) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (it as any).str as string ?? "";
  });
  let textIdx = 0;

  const showTextOps = new Set(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"]);
  const colorOps = new Set(["setFillRGBColor", "setFillGray", "setFillColor", "setFillColorN"]);
  const fillOps = new Set(["fill", "eoFill", "fillStroke"]);
  const ignore = new Set(["clip", "eoClip", "endPath", "moveText", "setTextMatrix", "setFont",
    "beginText", "endText", "dependency", "beginMarkedContentProps", "endMarkedContent",
    "setHScale", "setLeading", "setCharSpacing", "setWordSpacing", "setTextRise"]);

  let shown = 0;
  for (let i = 0; i < fnArray.length && shown < 600; i++) {
    const fn = fnArray[i];
    const name = opsReverse[fn] ?? `op${fn}`;
    if (ignore.has(name)) continue;

    const args = argsArray[i] as unknown[];
    let argStr = "";

    if (colorOps.has(name)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = args as any;
      argStr = `rgb(${a[0]},${a[1]},${a[2]})`;
    } else if (fillOps.has(name)) {
      argStr = "";
    } else if (showTextOps.has(name)) {
      const glyphs = (args[0] as Array<{ unicode?: string }>);
      const str = Array.isArray(glyphs) ? glyphs.map(g => g?.unicode ?? "").join("") : "?";
      const fromTC = unicodeItems[textIdx] ?? "(eof)";
      textIdx++;
      argStr = `"${str.slice(0,30)}" [tc:"${fromTC.slice(0,30)}"]`;
    } else if (name === "constructPath") {
      const ops2 = args[0] as number[];
      const pts = args[1] as number[];
      // Check if it's a rectangle (contains op 19)
      if (ops2.includes(19)) {
        const idx19 = ops2.indexOf(19);
        const x = pts[idx19 * 2 - ops2.slice(0, idx19).reduce((s, o) => s + (o === 13 || o === 14 ? 2 : o === 15 ? 6 : o === 19 ? 4 : 0), 0)];
        argStr = `RECT ops=${JSON.stringify(ops2)} pts=${JSON.stringify(pts.slice(0,8))}`;
      } else {
        argStr = `PATH ops=${JSON.stringify(ops2.slice(0,4))}`;
      }
    } else {
      argStr = JSON.stringify(args).slice(0, 60);
    }

    console.log(`[${i}] ${name}: ${argStr}`);
    shown++;
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
