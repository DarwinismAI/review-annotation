"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { readJsonResponse } from "@/hooks/use-json-resource";

interface DatasetMetric {
  id: string;
  key: string;
  label: string;
}

interface ActiveAnnotator {
  userId: string;
  name: string | null;
  email?: string | null;
}

interface DatasetAssignModalProps {
  datasetId: string;
  metrics: DatasetMetric[];
  selectedRowIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export function DatasetAssignModal({ datasetId, metrics, selectedRowIds, open, onOpenChange, onAssigned }: DatasetAssignModalProps) {
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [targetOverlap, setTargetOverlap] = useState(3);
  const [maxRowsPerAnnotator, setMaxRowsPerAnnotator] = useState<number | "">("");
  const [annotators, setAnnotators] = useState<ActiveAnnotator[]>([]);
  const [annotatorIds, setAnnotatorIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [assigning, setAssigning] = useState(false);
  const targetOverlapRef = useRef(targetOverlap);

  useEffect(() => {
    targetOverlapRef.current = targetOverlap;
  }, [targetOverlap]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/annotators?status=active")
      .then((response) => readJsonResponse(response))
      .then((payload) => {
        const data = ((payload as { data?: ActiveAnnotator[] }).data ?? []);
        if (cancelled) return;
        setAnnotators(data);
        const validIds = new Set(data.map((item) => item.userId));
        setAnnotatorIds((current) => {
          const currentValid = current.filter((id) => validIds.has(id));
          return currentValid.length > 0 ? currentValid : data.slice(0, targetOverlapRef.current).map((item) => item.userId);
        });
      })
      .catch(() => {
        setStatusTone("error");
        setStatus("Không tải được danh sách annotator");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const plannedRows = scope === "all" ? "toàn bộ dataset" : `${selectedRowIds.length} dòng`;
  const preview = useMemo(
    () =>
      `${plannedRows} x overlap ${targetOverlap} x ${metrics.length} metric${
        maxRowsPerAnnotator ? ` · tối đa ${maxRowsPerAnnotator} câu/annotator` : ""
      }`,
    [maxRowsPerAnnotator, metrics.length, plannedRows, targetOverlap],
  );

  function toggleAnnotator(id: string) {
    setAnnotatorIds(annotatorIds.includes(id) ? annotatorIds.filter((item) => item !== id) : [...annotatorIds, id]);
  }

  async function assign() {
    setStatus("");
    setStatusTone("neutral");
    setAssigning(true);
    const body = {
      scope: scope === "all" ? { type: "all" as const } : { type: "selected" as const, rowIds: selectedRowIds },
      targetOverlap,
      maxRowsPerAnnotator: maxRowsPerAnnotator || undefined,
      metricIds: metrics.map((metric) => metric.id),
      annotatorIds,
    };
    try {
      const response = await fetch(`/api/datasets/${datasetId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await readJsonResponse(response)) as { message?: string; error?: string; createdAssignments?: number };
      if (!response.ok) {
        setStatusTone("error");
        setStatus(payload.message ?? payload.error ?? "Assign thất bại");
        return;
      }
      setStatusTone((payload.createdAssignments ?? 0) > 0 ? "success" : "neutral");
      setStatus(payload.message ?? `Đã tạo ${payload.createdAssignments} task`);
      onAssigned();
    } catch {
      setStatusTone("error");
      setStatus("Không kết nối được API assign");
    } finally {
      setAssigning(false);
    }
  }

  const statusClassName =
    statusTone === "error" ? "text-red-600" : statusTone === "success" ? "text-green-700" : "text-slate-600";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign task cho annotator</DialogTitle>
          <DialogDescription>Chọn phạm vi, overlap và annotator nhận task.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Phạm vi</div>
            <div className="flex gap-2">
              <Button type="button" variant={scope === "selected" ? "default" : "outline"} onClick={() => setScope("selected")} disabled={selectedRowIds.length === 0}>
                Dòng đã chọn ({selectedRowIds.length})
              </Button>
              <Button type="button" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>
                Cả dataset
              </Button>
            </div>
            {scope === "all" && selectedRowIds.length > 0 && (
              <div className="text-xs text-amber-700">Đang giao cả dataset, không chỉ {selectedRowIds.length} dòng đã chọn.</div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="assign-overlap" className="block text-xs font-semibold uppercase text-slate-500">
                Overlap
              </label>
              <Input id="assign-overlap" type="number" min={1} max={5} value={targetOverlap} onChange={(event) => setTargetOverlap(Number(event.target.value))} />
            </div>
            <div className="space-y-2">
              <label htmlFor="assign-max-rows" className="block text-xs font-semibold uppercase text-slate-500">
                Số câu / annotator
              </label>
              <Input
                id="assign-max-rows"
                type="number"
                min={1}
                placeholder="Không giới hạn"
                value={maxRowsPerAnnotator}
                onChange={(event) => setMaxRowsPerAnnotator(event.target.value ? Number(event.target.value) : "")}
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-slate-500">Preview</div>
              <Badge variant="secondary">{preview}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Metrics theo Rubric</div>
            <div className="flex flex-wrap gap-2">
              {metrics.map((metric) => (
                <Badge key={metric.id} variant="outline">
                  {metric.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Annotator</div>
            <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
              {annotators.map((annotator) => (
                <label key={annotator.userId} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                  <input type="checkbox" checked={annotatorIds.includes(annotator.userId)} onChange={() => toggleAnnotator(annotator.userId)} />
                  <span>{annotator.name ?? annotator.email ?? annotator.userId}</span>
                </label>
              ))}
            </div>
          </div>

          {status && <div className={`text-sm ${statusClassName}`}>{status}</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type="button" onClick={assign} disabled={assigning || metrics.length === 0 || annotatorIds.length < targetOverlap || (scope === "selected" && selectedRowIds.length === 0)}>
            <Send className="h-4 w-4" />
            {assigning ? "Đang giao..." : "Xác nhận giao"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
