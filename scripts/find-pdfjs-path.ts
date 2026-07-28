import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const req = createRequire(__filename);

try {
  const p = req.resolve("pdfjs-dist/package.json");
  console.log("pdfjs-dist path:", path.dirname(p));
  const legacyWorker = path.join(path.dirname(p), "legacy/build/pdf.worker.mjs");
  const legacyWorkerJs = path.join(path.dirname(p), "legacy/build/pdf.worker.js");
  const buildWorker = path.join(path.dirname(p), "build/pdf.worker.mjs");
  console.log("legacy worker mjs:", legacyWorker);
  console.log("legacy worker js:", legacyWorkerJs);
  console.log("build worker mjs:", buildWorker);
} catch (e) {
  console.error(e);
}
