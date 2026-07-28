"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { JsonFieldValue } from "@/components/admin/json-field-value";

interface TaskDetail {
  id: string;
  status: string;
  datasetName: string;
  internalRowId: number;
  detailFields: Record<string, unknown>;
  metrics: Array<{ id: string; key: string; label: string; description: string | null; scale: { values: string[] }; required: boolean }>;
  existingValues: Record<string, { value: string; note: string | null }>;
}

export default function ExpertTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetch(`/api/annotator/tasks/${taskId}`)
      .then((response) => response.json())
      .then((payload) => {
        const loadedTask = payload.task as TaskDetail;
        setTask(loadedTask);
        setValues(Object.fromEntries(Object.entries(loadedTask.existingValues ?? {}).map(([metricId, value]) => [metricId, value.value])));
        setNotes(Object.fromEntries(Object.entries(loadedTask.existingValues ?? {}).map(([metricId, value]) => [metricId, value.note ?? ""])));
      })
      .catch(() => setStatus("Không tải được task"));
  }, [taskId]);

  async function submit() {
    setStatus("");
    const response = await fetch(`/api/annotator/tasks/${taskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, notes }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.metricId ? `${payload.error}: ${payload.metricId}` : payload.error ?? "Submit thất bại");
      return;
    }
    setStatus("Đã submit");
    setTask((current) => (current ? { ...current, status: payload.status } : current));
  }

  if (!task) {
    return <div className="text-sm text-slate-500">Đang tải task...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{task.datasetName}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">Row {task.internalRowId}</Badge>
            <Badge variant={task.status === "completed" ? "success" : "secondary"}>{task.status}</Badge>
          </div>
        </div>
        <Button type="button" onClick={submit}>
          Submit
        </Button>
      </div>

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Detail fields</div>
        <div className="divide-y divide-slate-100">
          {Object.entries(task.detailFields).map(([field, value]) => (
            <div key={field} className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
              <div className="font-mono text-xs text-slate-500">{field}</div>
              <JsonFieldValue value={value} maxLength={2000} className="max-w-none whitespace-pre-wrap text-slate-800" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Metrics</h2>
        {task.metrics.map((metric) => (
          <div key={metric.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">{metric.label}</div>
                {metric.description && <div className="mt-1 text-sm text-slate-500">{metric.description}</div>}
              </div>
              <div className="flex gap-2">
                {metric.scale.values.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={values[metric.id] === option ? "default" : "outline"}
                    onClick={() => setValues((current) => ({ ...current, [metric.id]: option }))}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
            <Textarea
              value={notes[metric.id] ?? ""}
              onChange={(event) => setNotes((current) => ({ ...current, [metric.id]: event.target.value }))}
              className="mt-3"
              placeholder="Ghi chú"
            />
          </div>
        ))}
      </section>

      {status && <div className="text-sm text-slate-600">{status}</div>}
    </div>
  );
}
