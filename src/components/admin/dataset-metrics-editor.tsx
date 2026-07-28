"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SAFETY_COMPLIANCE_DEFAULT_METRICS, type MetricConfigInput } from "@/lib/datasets/metrics";

export type DatasetMetricDraft = MetricConfigInput;

interface DatasetMetricsEditorProps {
  metrics: DatasetMetricDraft[];
  onMetricsChange: (metrics: DatasetMetricDraft[]) => void;
}

export { SAFETY_COMPLIANCE_DEFAULT_METRICS };

export function DatasetMetricsEditor({ metrics, onMetricsChange }: DatasetMetricsEditorProps) {
  function updateMetric(index: number, patch: Partial<DatasetMetricDraft>) {
    onMetricsChange(metrics.map((metric, metricIndex) => (metricIndex === index ? { ...metric, ...patch } : metric)));
  }

  function addMetric() {
    onMetricsChange([
      ...metrics,
      {
        key: `metric_${metrics.length + 1}`,
        label: "Metric mới",
        description: "",
        scale: { values: ["Failed", "Pass"] },
        required: true,
        sortOrder: metrics.length,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {metrics.map((metric, index) => (
        <div key={`${metric.key}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
            <Input value={metric.key} onChange={(event) => updateMetric(index, { key: event.target.value })} aria-label="Metric key" />
            <Input value={metric.label} onChange={(event) => updateMetric(index, { label: event.target.value })} aria-label="Metric label" />
            <Button type="button" variant="outline" size="icon" onClick={() => onMetricsChange(metrics.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            value={metric.description ?? ""}
            onChange={(event) => updateMetric(index, { description: event.target.value })}
            className="mt-3"
            aria-label="Metric description"
          />
          <div className="mt-2 text-xs font-medium text-slate-500">Scale: Failed / Pass</div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addMetric}>
        <Plus className="h-4 w-4" />
        Thêm metric
      </Button>
    </div>
  );
}
