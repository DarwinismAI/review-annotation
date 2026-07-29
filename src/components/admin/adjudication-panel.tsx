"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AdjudicationMetric {
  id: string;
  key: string;
  label: string;
  description: string | null;
  scale: { values: string[] };
}

interface AdjudicationPanelProps {
  datasetId: string;
  rowId: string;
  metrics: AdjudicationMetric[];
  initialValues: Record<string, { value: string | null; note: string | null }>;
  onSaved?: () => void;
}

export function AdjudicationPanel({ datasetId, rowId, metrics, initialValues, onSaved }: AdjudicationPanelProps) {
  const [values, setValues] = useState<Record<string, string | null>>(
    Object.fromEntries(metrics.map((metric) => [metric.id, initialValues[metric.id]?.value ?? null])),
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(metrics.map((metric) => [metric.id, initialValues[metric.id]?.note ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(`/api/datasets/${datasetId}/rows/${rowId}/adjudication`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, notes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Lưu adjudication thất bại");
        return;
      }
      setStatus("Đã lưu adjudication");
      onSaved?.();
    } catch {
      setStatus("Lưu adjudication thất bại");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Adjudication" className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Adjudication</h2>
          <p className="text-xs text-slate-500">Reviewer final decision, tách riêng khỏi vote của annotator.</p>
        </div>
        <Button type="button" onClick={save} disabled={saving || metrics.length === 0}>
          {saving ? "Đang lưu..." : "Lưu adjudication"}
        </Button>
      </div>

      <div className="space-y-3">
        {metrics.map((metric) => (
          <div key={metric.id} aria-label={`Adjudication metric ${metric.label}`} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-900">{metric.label}</div>
                <div className="text-xs text-slate-500">{metric.key}</div>
                {metric.description && <div className="mt-1 text-sm text-slate-500">{metric.description}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                {metric.scale.values.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={values[metric.id] === option ? "default" : "outline"}
                    aria-pressed={values[metric.id] === option}
                    onClick={() => setValues((current) => ({ ...current, [metric.id]: option }))}
                  >
                    {option}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setValues((current) => ({ ...current, [metric.id]: null }))}>
                  Clear
                </Button>
              </div>
            </div>
            <label htmlFor={`adjudication-note-${metric.id}`} className="mt-3 block text-sm font-medium text-slate-700">
              Ghi chú final
            </label>
            <Textarea
              id={`adjudication-note-${metric.id}`}
              value={notes[metric.id] ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [metric.id]: event.target.value }))}
              className="mt-1.5"
            />
          </div>
        ))}
      </div>

      {status && (
        <div className={`flex items-center gap-2 text-sm ${status === "Đã lưu adjudication" ? "text-green-700" : "text-red-600"}`}>
          {status === "Đã lưu adjudication" && <CheckCircle2 className="h-4 w-4" />}
          {status}
        </div>
      )}
    </section>
  );
}
