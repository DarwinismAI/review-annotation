"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnnotationWorkspace, type AnnotationWorkspaceMetric } from "@/components/annotation/annotation-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TaskDetail {
  id: string;
  assignmentRunId: string;
  status: string;
  datasetName: string;
  internalRowId: number;
  detailFields: Record<string, unknown>;
  metrics: AnnotationWorkspaceMetric[];
  existingValues: Record<string, { value: string | null; note: string | null }>;
}

interface NextPayload {
  done: boolean;
  nextTaskId: string | null;
  error?: string;
}

export default function AnnotatorTaskGroupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = params.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [done, setDone] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const loadedRef = useRef(false);
  const changeVersionRef = useRef(0);
  const currentTaskIdRef = useRef<string | null>(null);

  const loadTask = useCallback(async (taskId: string) => {
    const response = await fetch(`/api/annotator/tasks/${taskId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Không tải được task");

    const loadedTask = payload.task as TaskDetail;
    setTask(loadedTask);
    currentTaskIdRef.current = loadedTask.id;
    setValues(Object.fromEntries(Object.entries(loadedTask.existingValues ?? {}).map(([metricId, value]) => [metricId, value.value ?? ""])));
    setNotes(Object.fromEntries(Object.entries(loadedTask.existingValues ?? {}).map(([metricId, value]) => [metricId, value.note ?? ""])));
    setDirty(false);
    setDone(false);
    loadedRef.current = true;
  }, []);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/annotator/task-groups/${groupId}/next`, { cache: "no-store" });
      const payload = (await response.json()) as NextPayload;
      if (!response.ok) throw new Error(payload.error ?? "Không tải được task tiếp theo");

      if (payload.done || !payload.nextTaskId) {
        setTask(null);
        setValues({});
        setNotes({});
        setDirty(false);
        setDone(true);
        loadedRef.current = false;
        currentTaskIdRef.current = null;
        router.replace(`/annotator/tasks/${groupId}`);
        return;
      }

      await loadTask(payload.nextTaskId);
      router.replace(`/annotator/tasks/${groupId}?item=${payload.nextTaskId}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Không tải được task");
    } finally {
      setLoading(false);
    }
  }, [groupId, loadTask, router]);

  function markDirty() {
    if (task?.status === "completed") return;
    changeVersionRef.current += 1;
    setDirty(true);
  }

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (!itemId) {
      loadNext();
      return;
    }
    if (currentTaskIdRef.current === itemId) return;

    setLoading(true);
    setStatus("");
    loadTask(itemId)
      .catch((err) => {
        setStatus(err instanceof Error ? err.message : "Không tải được task");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadNext, loadTask, searchParams]);

  useEffect(() => {
    if (!task || task.status === "completed" || !loadedRef.current || !dirty || submitting) return;
    const timer = window.setTimeout(async () => {
      const saveVersion = changeVersionRef.current;
      setSaving(true);
      try {
        const response = await fetch(`/api/annotator/tasks/${task.id}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values, notes }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setStatus(payload.metricId ? `${payload.error}: ${payload.metricId}` : payload.error ?? "Lưu nháp thất bại");
          return;
        }
        if (changeVersionRef.current === saveVersion) setDirty(false);
        setStatus(
          payload.savedAt
            ? `Đã lưu nháp ${new Date(payload.savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
            : "Đã lưu",
        );
        setTask((current) => (current && current.status === "assigned" ? { ...current, status: "in_progress" } : current));
      } catch {
        setStatus("Lưu nháp thất bại");
      } finally {
        setSaving(false);
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [dirty, notes, submitting, task, values]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function submit() {
    if (!task) return;
    setStatus("");
    if (task.status === "completed") {
      setStatus("Task đã completed");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/annotator/tasks/${task.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, notes }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.metricId ? `${payload.error}: ${payload.metricId}` : payload.error ?? "Submit thất bại");
        return;
      }
      setDirty(false);
      changeVersionRef.current += 1;
      setStatus("Đã submit");
      await loadNext();
    } catch {
      setStatus("Submit thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  async function skipCurrentTask() {
    if (!task || task.status === "completed") return;
    if (dirty && saving) {
      setStatus("Đang lưu nháp, vui lòng chờ trước khi skip");
      return;
    }
    setStatus("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/annotator/tasks/${task.id}/skip`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(payload.error ?? "Skip thất bại");
        return;
      }
      setDirty(false);
      changeVersionRef.current += 1;
      await loadNext();
    } catch {
      setStatus("Skip thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Đang tải task...</div>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Task group hoàn tất</h1>
          <p className="text-sm text-slate-500">Không còn assignment khả dụng trong nhóm này.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/annotator/tasks">Quay lại task được giao</Link>
        </Button>
      </div>
    );
  }

  if (!task) {
    return <div className="text-sm text-red-600">{status || "Không tải được task"}</div>;
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={skipCurrentTask} disabled={submitting || saving || task.status === "completed"}>
            Skip
          </Button>
          <Button type="button" onClick={submit} disabled={task.status === "completed" || submitting || saving}>
            {submitting ? "Đang xử lý..." : "Submit"}
          </Button>
        </div>
      </div>

      <AnnotationWorkspace
        datasetName={task.datasetName}
        internalRowId={task.internalRowId}
        status={task.status}
        detailFields={task.detailFields}
        metrics={task.metrics}
        values={values}
        notes={notes}
        disabled={task.status === "completed"}
        onValueChange={(metricId, value) => {
          setValues((current) => ({ ...current, [metricId]: value }));
          markDirty();
        }}
        onNoteChange={(metricId, note) => {
          setNotes((current) => ({ ...current, [metricId]: note }));
          markDirty();
        }}
      />

      {(status || saving) && <div className="text-sm text-slate-600">{saving ? "Đang lưu nháp..." : status}</div>}
    </div>
  );
}
