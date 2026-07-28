/**
 * Smoke test: extract paragraphs from first PDF inside e2e/fixtures/sample-batch.zip.
 * Run with: pnpm tsx scripts/smoke-pdf-extract.ts
 */
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { extractParagraphs } from "../src/lib/pdf-extract";

async function main() {
  const zipPath = path.resolve(__dirname, "../e2e/fixtures/sample-batch.zip");
  if (!fs.existsSync(zipPath)) {
    console.error("Fixture not found:", zipPath);
    process.exit(1);
  }

  const zipBuffer = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipBuffer);

  const pdfEntries = Object.entries(zip.files).filter(
    ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf")
  );

  if (pdfEntries.length === 0) {
    console.error("No PDFs found in fixture ZIP.");
    process.exit(1);
  }

  const [filename, entry] = pdfEntries[0];
  console.log(`Processing: ${filename}`);

  const pdfBuffer = Buffer.from(await entry.async("uint8array"));
  console.log(`PDF buffer size: ${pdfBuffer.length} bytes`);

  const paragraphs = await extractParagraphs(pdfBuffer);
  console.log(`Paragraph count: ${paragraphs.length}`);

  if (paragraphs.length > 0) {
    console.log(`First paragraph preview: ${paragraphs[0].slice(0, 120)}...`);
  } else {
    // Fixture PDFs are 98-byte stubs with no text layer — this is expected.
    // extractParagraphs returns [] gracefully without throwing.
    console.log("Note: fixture PDFs are minimal stubs with no text layer.");
    console.log("extractParagraphs returned [] without error — correct non-fatal behavior.");
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
