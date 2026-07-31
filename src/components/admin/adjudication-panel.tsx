"use client";

import { useEffect, useMemo, useState } from "react";
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

export interface PersistedAdjudication {
  metricId: string;
  value: string | null;
  note: string | null;
}

interface AdjudicationPanelProps {
  datasetId: string;
  rowId: string;
  metrics: AdjudicationMetric[];
  initialValues: Record<string, { value: string | null; note: string | null }>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (result: PersistedAdjudication[]) => void;
  onSaveAndNext?: (result: PersistedAdjudication[]) => void;
  hasNext: boolean;
}

function valuesFrom(metrics: AdjudicationMetric[], initialValues: Record<string, { value: string | null; note: string | null }>) {
  return Object.fromEntries(metrics.map((metric) => [metric.id, initialValues[metric.id]?.value ?? null]));
}

function notesFrom(metrics: AdjudicationMetric[], initialValues: Record<string, { value: string | null; note: string | null }>) {
  return Object.fromEntries(metrics.map((metric) => [metric.id, initialValues[metric.id]?.note ?? ""]));
}

function valuesFromPersisted(metrics: AdjudicationMetric[], adjudications: PersistedAdjudication[]) {
  const persisted = new Map(adjudications.map((item) => [item.metricId, item]));
  return Object.fromEntries(metrics.map((metric) => [metric.id, persisted.get(metric.id)?.value ?? null]));
}

function notesFromPersisted(metrics: AdjudicationMetric[], adjudications: PersistedAdjudication[]) {
  const persisted = new Map(adjudications.map((item) => [item.metricId, item]));
  return Object.fromEntries(metrics.map((metric) => [metric.id, persisted.get(metric.id)?.note ?? ""]));
}

function sameRecord(left: Record<string, string | null>, right: Record<string, string | null>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? null) !== (right[key] ?? null)) return false;
  }
  return true;
}

export function AdjudicationPanel({
  datasetId,
  rowId,
  metrics,
  initialValues,
  onDirtyChange,
  onSaved,
  onSaveAndNext,
  hasNext,
}: AdjudicationPanelProps) {
  const initialValueState = useMemo(() => valuesFrom(metrics, initialValues), [metrics, initialValues]);
  const initialNoteState = useMemo(() => notesFrom(metrics, initialValues), [metrics, initialValues]);
  const [values, setValues] = useState<Record<string, string | null>>(
    initialValueState,
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    initialNoteState,
  );
  const [savedValues, setSavedValues] = useState<Record<string, string | null>>(initialValueState);
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>(initialNoteState);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setValues(initialValueState);
    setNotes(initialNoteState);
    setSavedValues(initialValueState);
    setSavedNotes(initialNoteState);
    setStatus("");
    onDirtyChange?.(false);
  }, [initialNoteState, initialValueState, onDirtyChange]);

  const dirty = !sameRecord(values, savedValues) || !sameRecord(notes, savedNotes);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save(): Promise<PersistedAdjudication[] | null> {
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
        return null;
      }
      const persisted = (payload.adjudications ?? []) as PersistedAdjudication[];
      const nextValues = valuesFromPersisted(metrics, persisted);
      const nextNotes = notesFromPersisted(metrics, persisted);
      setValues(nextValues);
      setNotes(nextNotes);
      setSavedValues(nextValues);
      setSavedNotes(nextNotes);
      setStatus("Đã lưu adjudication");
      onDirtyChange?.(false);
      onSaved?.(persisted);
      return persisted;
    } catch {
      setStatus("Lưu adjudication thất bại");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndNext() {
    const persisted = await save();
    if (persisted) onSaveAndNext?.(persisted);
  }

  return (
    <section aria-label="Adjudication" className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Adjudication</h2>
          <p className="text-xs text-slate-500">Reviewer final decision, tách riêng khỏi vote của annotator.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={save} disabled={saving || metrics.length === 0}>
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
          <Button type="button" onClick={saveAndNext} disabled={saving || metrics.length === 0 || !hasNext}>
            {saving ? "Đang lưu..." : "Lưu & câu tiếp"}
          </Button>
        </div>
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
