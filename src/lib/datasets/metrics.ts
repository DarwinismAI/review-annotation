export interface MetricConfigInput {
  key: string;
  label: string;
  description?: string;
  scale: { values: string[] };
  required: boolean;
  sortOrder: number;
}

export const SAFETY_COMPLIANCE_DEFAULT_METRICS: MetricConfigInput[] = [
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    description: "Nội dung có vi phạm chính sách an toàn - tuân thủ hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
  {
    key: "implicit_risk",
    label: "Mức độ ẩn ý",
    description: "Nội dung có rủi ro ẩn ý cần chặn hoặc đánh dấu hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 1,
  },
  {
    key: "guideline_clarity",
    label: "Độ rõ của guideline",
    description: "Guideline áp dụng có đủ rõ để quyết định nhãn hay không.",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 2,
  },
];

export function validateMetricConfig(metrics: MetricConfigInput[]) {
  const keys = new Set<string>();

  for (const metric of metrics) {
    if (!metric.key.trim()) return { ok: false as const, reason: "EMPTY_METRIC_KEY" as const };
    if (keys.has(metric.key)) return { ok: false as const, reason: "DUPLICATE_METRIC_KEY" as const, key: metric.key };
    if (!metric.label.trim()) return { ok: false as const, reason: "EMPTY_METRIC_LABEL" as const, key: metric.key };
    if (metric.scale.values.length < 2) return { ok: false as const, reason: "METRIC_SCALE_TOO_SHORT" as const, key: metric.key };
    keys.add(metric.key);
  }

  return { ok: true as const };
}

export function validateMetricSubmission(input: {
  assignedMetricIds: string[];
  metrics: Array<{ id: string; scale: { values: string[] } }>;
  values: Record<string, string>;
}) {
  const assigned = new Set(input.assignedMetricIds);
  const metrics = new Map(input.metrics.map((metric) => [metric.id, metric]));

  for (const metricId of Object.keys(input.values)) {
    if (!assigned.has(metricId)) {
      return { ok: false as const, reason: "UNASSIGNED_METRIC" as const, metricId };
    }
  }

  for (const metricId of input.assignedMetricIds) {
    const value = input.values[metricId];
    const metric = metrics.get(metricId);
    if (!metric) return { ok: false as const, reason: "UNKNOWN_METRIC" as const, metricId };
    if (!metric.scale.values.includes(value)) {
      return { ok: false as const, reason: "INVALID_METRIC_VALUE" as const, metricId };
    }
  }

  return { ok: true as const };
}

export function validateDraftMetricSubmission(input: {
  assignedMetricIds: string[];
  metrics: Array<{ id: string; scale: { values: string[] } }>;
  values: Record<string, string>;
}) {
  const assigned = new Set(input.assignedMetricIds);
  const metrics = new Map(input.metrics.map((metric) => [metric.id, metric]));

  for (const [metricId, value] of Object.entries(input.values)) {
    if (!assigned.has(metricId)) {
      return { ok: false as const, reason: "UNASSIGNED_METRIC" as const, metricId };
    }
    if (!value) continue;
    const metric = metrics.get(metricId);
    if (!metric) return { ok: false as const, reason: "UNKNOWN_METRIC" as const, metricId };
    if (!metric.scale.values.includes(value)) {
      return { ok: false as const, reason: "INVALID_METRIC_VALUE" as const, metricId };
    }
  }

  return { ok: true as const };
}
