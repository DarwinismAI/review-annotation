/**
 * Print 80 ops before and after the RED fill at op~627 on page 1
 * to understand why no text appears in that colored section.
 */
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

function glyphsToStr(args: unknown[]): string {
  const g = args[0];
  if (!Array.isArray(g)) return "";
  return g.map((x) => (typeof x === "object" && x !== null ? (x as Record<string, unknown>).unicode ?? "" : "")).join("");
}

async function main() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string).catch(
    () => import("pdfjs-dist/legacy/build/pdf.js" as string)
  );
  pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(pkgDir, "legacy/build/pdf.worker.mjs")}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OPS: Record<string, number> = (pdfjs as any).OPS ?? {};
  const opNames = new Map<number, string>(Object.entries(OPS).map(([n, c]) => [c as number, n]));

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const page = await pdf.getPage(1);
  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];

  const showOps = new Set(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"]);
  const skipOps = new Set(["clip", "eoClip", "endPath", "moveText", "setTextMatrix", "setFont",
    "beginText", "endText", "dependency", "beginMarkedContentProps", "endMarkedContent",
    "setHScale", "setLeading", "setCharSpacing", "setWordSpacing", "setTextRise"]);

  // Print ops 580-750 (around the RED fill at op 627)
  let saveDepth = 0;
  // Pre-compute depth at op 580
  for (let i = 0; i < 580; i++) {
    const n = opNames.get(fnArray[i]) ?? "";
    if (n === "save") saveDepth++;
    if (n === "restore") saveDepth = Math.max(0, saveDepth - 1);
  }

  let activeFill = { r: 0, g: 0, b: 0 };
  for (let i = 580; i < Math.min(800, fnArray.length); i++) {
    const fn = fnArray[i];
    const name = opNames.get(fn) ?? `op${fn}`;
    const args = argsArray[i] as unknown[];

    if (skipOps.has(name)) continue;

    if (name === "save") saveDepth++;
    if (name === "restore") saveDepth = Math.max(0, saveDepth - 1);

    if (name === "setFillRGBColor") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = args as any;
      activeFill = { r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0 };
    }

    let argStr = "";
    if (name === "setFillRGBColor" || name === "setStrokeRGBColor") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = args as any;
      argStr = `rgb(${a[0]},${a[1]},${a[2]})`;
    } else if (showOps.has(name)) {
      argStr = `"${glyphsToStr(args)}"`;
    } else if (name === "fill" || name === "eoFill") {
      argStr = `← active fill: rgb(${activeFill.r},${activeFill.g},${activeFill.b})`;
    } else if (name === "constructPath") {
      const ops2 = args[0] as number[];
      argStr = `ops=${JSON.stringify(ops2.slice(0, 4))}`;
    } else {
      argStr = JSON.stringify(args).slice(0, 50);
    }

    console.log(`[${i}] d=${saveDepth} ${name}: ${argStr}`);
  }

  page.cleanup();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
