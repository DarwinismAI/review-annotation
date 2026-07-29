"use client";

import { JsonFieldValue } from "@/components/admin/json-field-value";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface AnnotationWorkspaceMetric {
  id: string;
  key: string;
  label: string;
  description: string | null;
  scale: { values: string[] };
  required: boolean;
}

export interface AnnotationWorkspaceProps {
  datasetName: string;
  internalRowId: number;
  status: string;
  detailFields: Record<string, unknown>;
  metrics: AnnotationWorkspaceMetric[];
  values: Record<string, string>;
  notes: Record<string, string>;
  disabled?: boolean;
  onValueChange: (metricId: string, value: string) => void;
  onNoteChange: (metricId: string, note: string) => void;
}

export function AnnotationWorkspace({
  detailFields,
  metrics,
  values,
  notes,
  disabled,
  onValueChange,
  onNoteChange,
}: AnnotationWorkspaceProps) {
  return (
    <div className="space-y-5">
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Detail fields</div>
        <div className="divide-y divide-slate-100">
          {Object.entries(detailFields).map(([field, value]) => (
            <div key={field} className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
              <div className="font-mono text-xs text-slate-500">{field}</div>
              <JsonFieldValue value={value} maxLength={2000} className="max-w-none whitespace-pre-wrap text-slate-800" />
            </div>
          ))}
          {Object.keys(detailFields).length === 0 && <div className="px-4 py-4 text-sm text-slate-500">Không có detail field.</div>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Metrics</h2>
        {metrics.map((metric) => (
          <div key={metric.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">{metric.label}</div>
                {metric.description && <div className="mt-1 text-sm text-slate-500">{metric.description}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                {metric.scale.values.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    aria-pressed={values[metric.id] === option}
                    variant={values[metric.id] === option ? "default" : "outline"}
                    disabled={disabled}
                    onClick={() => onValueChange(metric.id, option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
            <label htmlFor={`note-${metric.id}`} className="mt-3 block text-sm font-medium text-slate-700">
              Ghi chú
            </label>
            <Textarea
              id={`note-${metric.id}`}
              value={notes[metric.id] ?? ""}
              disabled={disabled}
              onChange={(event) => onNoteChange(metric.id, event.target.value)}
              className="mt-1.5"
              placeholder="Nhập ghi chú"
            />
          </div>
        ))}
        {metrics.length === 0 && <div className="rounded-md border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">Không có metric.</div>}
      </section>
    </div>
  );
}
