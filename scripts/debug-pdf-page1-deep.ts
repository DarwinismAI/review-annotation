/**
 * Deep dump of page 1 operator sequence to understand Vivipedia PDF structure.
 * Shows fill-color ops, path-construction, and text ops in order.
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
  for (const [name, code] of Object.entries(OPS)) {
    opsReverse[code] = name;
  }

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  // Inspect page 1 in detail — first 200 ops that involve color/fill/text
  const page = await pdf.getPage(1);
  const opList = await page.getOperatorList();
  const fnArray = opList.fnArray as number[];
  const argsArray = opList.argsArray as unknown[][];

  console.log(`Page 1: ${fnArray.length} total ops\n`);

  let shown = 0;
  for (let i = 0; i < fnArray.length && shown < 300; i++) {
    const fn = fnArray[i];
    const name = opsReverse[fn] ?? `op${fn}`;

    // Show only ops relevant to color / text / path
    const relevant = [
      "setFillRGBColor", "setFillColor", "setFillColorN", "setFillGray",
      "setFillCMYKColor", "setFillColorSpace",
      "showText", "showSpacedText", "nextLineShowText",
      "constructPath", "fill", "eoFill", "fillStroke",
      "beginGroup", "endGroup", "paintFormXObjectBegin", "paintFormXObjectEnd",
      "save", "restore", "transform",
      "beginMarkedContentProps", "setGState",
    ];
    if (!relevant.includes(name)) continue;

    const args = argsArray[i];
    let argStr = JSON.stringify(args);
    if (argStr.length > 120) argStr = argStr.slice(0, 120) + "…";
    console.log(`  [${i}] ${name}: ${argStr}`);
    shown++;
  }

  // Also dump full text content with hasEOL info
  console.log("\n--- Text content items (first 30) ---");
  const textContent = await page.getTextContent();
  textContent.items.slice(0, 30).forEach((item, idx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = item as any;
    console.log(`  [${idx}] str="${s.str}" dir="${s.dir}" transform=${JSON.stringify(s.transform?.slice(4))} hasEOL=${s.hasEOL}`);
  });

  // Check if getTextContent supports includeMarkedContent
  console.log("\n--- Text with markedContent ---");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textWithMC = await (page as any).getTextContent({ includeMarkedContent: true });
    textWithMC.items.slice(0, 30).forEach((item: unknown, idx: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = item as any;
      if (s.type) {
        console.log(`  [${idx}] MC type="${s.type}" tag="${s.tag}" id=${s.id}`);
      } else {
        console.log(`  [${idx}] str="${s.str?.slice(0, 40)}" transform=${JSON.stringify(s.transform?.slice(4, 6))}`);
      }
    });
  } catch (e) {
    console.log("  includeMarkedContent not supported:", e);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
