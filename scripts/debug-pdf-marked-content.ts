/**
 * Debug: use getTextContent({ includeMarkedContent: true }) to see the
 * structure of the PDF, plus check getAnnotations() for highlight annotations.
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

  const buf = fs.readFileSync(SAMPLE_PDF);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, verbosity: 0 } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  // Check page 3 (0-indexed page 2) which has "Tóm tắt nhanh" green content
  for (let pageIdx = 2; pageIdx < Math.min(5, pdf.numPages); pageIdx++) {
    const page = await pdf.getPage(pageIdx + 1);

    console.log(`\n=== Page ${pageIdx + 1} ===`);

    // Check annotations
    const annotations = await page.getAnnotations();
    console.log(`Annotations: ${annotations.length}`);
    annotations.slice(0, 5).forEach((ann) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = ann as any;
      console.log(`  ann: subtype=${a.subtype} color=${JSON.stringify(a.color)} rect=${JSON.stringify(a.rect)}`);
    });

    // getTextContent with includeMarkedContent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textContent = await (page as any).getTextContent({ includeMarkedContent: true });
    console.log(`Text items (with MC): ${textContent.items.length}`);

    let depth = 0;
    let currentTag = "";
    let buf2 = "";
    textContent.items.slice(0, 80).forEach((item: unknown, idx: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = item as any;
      if (s.type === "beginMarkedContent" || s.type === "beginMarkedContentProps") {
        depth++;
        currentTag = s.tag ?? "";
        const idStr = s.id != null ? ` id=${s.id}` : "";
        console.log(`${"  ".repeat(depth)}[${idx}] BEGIN_MC tag="${currentTag}"${idStr}`);
      } else if (s.type === "endMarkedContent") {
        console.log(`${"  ".repeat(depth)}[${idx}] END_MC`);
        depth = Math.max(0, depth - 1);
      } else {
        const text = s.str ?? "";
        buf2 += text;
        if (text.trim()) {
          console.log(`${"  ".repeat(depth + 1)}[${idx}] "${text.slice(0, 60)}" y=${s.transform?.[5]?.toFixed(1)}`);
        }
      }
    });

    page.cleanup();
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
