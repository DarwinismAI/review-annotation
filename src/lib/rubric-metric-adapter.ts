// @ts-nocheck

export interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

export function parseScale(raw: string): ScaleItem[] {
  try {
    return JSON.parse(raw) as ScaleItem[];
  } catch {
    return [];
  }
}

export function toMetricResponse(rubric: any, criterion: any | null) {
  return {
    ...rubric,
    criterionId: criterion?.id ?? null,
    description: criterion?.description ?? "",
    scale: criterion ? parseScale(criterion.scale) : [],
    required: criterion ? Boolean(criterion.required) : true,
  };
}
