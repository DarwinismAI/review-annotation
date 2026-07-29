export interface PassFailScaleItem {
  score: number;
  label: string;
  description: string;
}

const PASS_FAIL_SCALE: PassFailScaleItem[] = [
  { score: 1, label: "Failed", description: "Không đạt metric này." },
  { score: 2, label: "Pass", description: "Đạt metric này." },
];

export function defaultPassFailScale(): PassFailScaleItem[] {
  return PASS_FAIL_SCALE.map((item) => ({ ...item }));
}

export function isPassFailScale(scale: unknown): boolean {
  if (!Array.isArray(scale)) return false;
  const labels = scale.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    const label = (item as { label?: unknown }).label;
    return typeof label === "string" ? label.trim() : "";
  });
  return labels.length === 2 && labels[0] === "Failed" && labels[1] === "Pass";
}
