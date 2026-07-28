/**
 * Evaluation script: test pdf-color-extract.ts on the real sample PDF
 * (Vivipedia green/yellow/red segments).
 *
 * Usage: pnpm tsx scripts/eval-pdf-color-extract.ts
 */

import { readFileSync } from "fs";
import { extractColoredSegments } from "../src/lib/pdf-color-extract";

async function main() {
  const pdfPath = "/Users/haido/Downloads/BKTT-OPS/Pháp luật - điểm 80-90/Hình sự/Trình tự xử phạt vi phạm hành chính đối với hành vi cản trở hoạt động tố tụng - Vivipedia.pdf";
  const buf = readFileSync(pdfPath);
  console.log(`[C1] Loading PDF: ${pdfPath} (${buf.length} bytes)`);

  const segments = await extractColoredSegments(buf);

  if (segments === null) {
    console.error("❌ FAIL: Parser returned null (no colored fills detected)");
    process.exit(1);
  }

  console.log(`✓ Parser returned ${segments.length} segments`);

  // Count per color
  const colorCounts = { green: 0, yellow: 0, red: 0, neutral: 0 };
  const typeCounts = { highlight: 0, badge: 0, warning: 0, score: 0, text: 0 };
  let scoreValue: number | null = null;
  const greenSegments: string[] = [];

  for (const seg of segments) {
    colorCounts[seg.color]++;
    typeCounts[seg.type]++;
    if (seg.type === "score") {
      scoreValue = seg.scoreValue;
    }
    if (seg.color === "green" && greenSegments.length < 3) {
      greenSegments.push(seg.text);
    }
  }

  console.log("\n=== Color Distribution ===");
  console.log(`green:   ${colorCounts.green}`);
  console.log(`yellow:  ${colorCounts.yellow}`);
  console.log(`red:     ${colorCounts.red}`);
  console.log(`neutral: ${colorCounts.neutral}`);

  console.log("\n=== Type Distribution ===");
  console.log(`highlight: ${typeCounts.highlight}`);
  console.log(`badge:     ${typeCounts.badge}`);
  console.log(`warning:   ${typeCounts.warning}`);
  console.log(`score:     ${typeCounts.score}`);
  console.log(`text:      ${typeCounts.text}`);

  console.log("\n=== Score Detection ===");
  console.log(`scoreValue: ${scoreValue ?? "NOT FOUND"}`);

  console.log("\n=== First 3 Green Segments ===");
  greenSegments.forEach((text, i) => {
    console.log(`  ${i + 1}. "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
  });

  console.log("\n=== C1 Validation ===");
  const checks = {
    hasGreen: colorCounts.green >= 3,
    hasYellow: colorCounts.yellow >= 1,
    hasRed: colorCounts.red >= 1,
    hasScore: scoreValue === 86.4,
  };

  console.log(`✓ green >= 3:      ${checks.hasGreen ? "PASS" : "FAIL"}`);
  console.log(`✓ yellow >= 1:     ${checks.hasYellow ? "PASS" : "FAIL"}`);
  console.log(`✓ red >= 1:        ${checks.hasRed ? "PASS" : "FAIL"}`);
  console.log(`✓ score = 86.4:    ${checks.hasScore ? "PASS" : "FAIL"}`);

  const allPass = Object.values(checks).every(Boolean);
  if (allPass) {
    console.log("\n✅ All C1 checks passed");
    process.exit(0);
  } else {
    console.error("\n❌ Some C1 checks failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
