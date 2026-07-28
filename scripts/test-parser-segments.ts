/**
 * Verify parser fixes F1-F4: run extractColoredSegments on sample PDF.
 * Run: pnpm tsx scripts/test-parser-segments.ts
 */
import fs from "fs";
import { extractColoredSegments } from "../src/lib/pdf-color-extract.js";

const PDF = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự/Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf";

async function main() {
  const buf = fs.readFileSync(PDF);
  const segments = await extractColoredSegments(buf);
  if (!segments) { console.log("NULL — no color layer"); process.exit(1); }

  const green = segments.filter(s => s.color === "green");
  const yellow = segments.filter(s => s.color === "yellow");
  const red = segments.filter(s => s.color === "red");
  const scores = segments.filter(s => s.type === "score");
  const page3green = green.filter(s => s.pageIndex === 2);

  console.log(`Total: ${segments.length} | green=${green.length} yellow=${yellow.length} red=${red.length}`);
  console.log(`Score segments: ${scores.length}`);
  console.log(`Page-3 green: ${page3green.length}`);

  console.log("\n--- All segments ---");
  segments.forEach((s, i) => console.log(`[${i}] p${s.pageIndex} ${s.color}/${s.type} sv=${s.scoreValue} "${s.text.slice(0, 50)}"`));

  console.log("\n--- Score segments ---");
  scores.forEach(s => console.log(`  [p${s.pageIndex}] "${s.text}" scoreValue=${s.scoreValue}`));

  console.log("\n--- Yellow segments ---");
  yellow.slice(0, 5).forEach(s => console.log(`  [p${s.pageIndex}] "${s.text.slice(0, 60)}" type=${s.type}`));

  console.log("\n--- Red segments ---");
  red.slice(0, 5).forEach(s => console.log(`  [p${s.pageIndex}] "${s.text.slice(0, 60)}" type=${s.type}`));

  console.log("\n--- Page-3 green segments (first 8) ---");
  page3green.slice(0, 8).forEach(s => console.log(`  "${s.text.slice(0, 70)}" type=${s.type}`));

  // Verification gate assertions
  const pass = {
    a: page3green.length >= 3,
    b: scores.some(s => s.scoreValue === 86.4),
    c: yellow.some(s => s.text.includes("Tầng")),
    d: red.some(s => s.type === "warning"),
  };
  console.log("\n--- Gate ---");
  console.log(`(a) page-3 ≥3 green: ${pass.a} (${page3green.length})`);
  console.log(`(b) score=86.4: ${pass.b}`);
  console.log(`(c) yellow Tầng: ${pass.c}`);
  console.log(`(d) red warning: ${pass.d}`);
  const allPass = Object.values(pass).every(Boolean);
  console.log(`\nGATE: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
