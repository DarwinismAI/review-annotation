"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
  const [metricIds, setMetricIds] = useState<string[]>([]);
  const [annotators, setAnnotators] = useState<ActiveAnnotator[]>([]);
  const [annotatorIds, setAnnotatorIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const targetOverlapRef = useRef(targetOverlap);

  useEffect(() => {
    targetOverlapRef.current = targetOverlap;
  }, [targetOverlap]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/annotators?status=active")
      .then((response) => response.json())
      .then((payload) => {
        const data = (payload.data ?? []) as ActiveAnnotator[];
        if (cancelled) return;
        setAnnotators(data);
        const validIds = new Set(data.map((item) => item.userId));
        setAnnotatorIds((current) => {
          const currentValid = current.filter((id) => validIds.has(id));
          return currentValid.length > 0 ? currentValid : data.slice(0, targetOverlapRef.current).map((item) => item.userId);
        });
      })
      .catch(() => setStatus("Không tải được danh sách annotator"));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (metricIds.length === 0 && metrics.length > 0) {
      setMetricIds(metrics.map((metric) => metric.id));
    }
  }, [metrics, metricIds.length]);

  const plannedRows = scope === "all" ? "toàn bộ dataset" : `${selectedRowIds.length} dòng`;
  const preview = useMemo(
    () =>
      `${plannedRows} x overlap ${targetOverlap} x ${metricIds.length} metric${
        maxRowsPerAnnotator ? ` · tối đa ${maxRowsPerAnnotator} câu/annotator` : ""
      }`,
    [maxRowsPerAnnotator, metricIds.length, plannedRows, targetOverlap],
  );

  function toggleMetric(id: string) {
    setMetricIds(metricIds.includes(id) ? metricIds.filter((item) => item !== id) : [...metricIds, id]);
  }

  function toggleAnnotator(id: string) {
    setAnnotatorIds(annotatorIds.includes(id) ? annotatorIds.filter((item) => item !== id) : [...annotatorIds, id]);
  }

  async function assign() {
    setStatus("");
    const body = {
      scope: scope === "all" ? { type: "all" as const } : { type: "selected" as const, rowIds: selectedRowIds },
      targetOverlap,
      maxRowsPerAnnotator: maxRowsPerAnnotator || undefined,
      metricIds,
      annotatorIds,
    };
    const response = await fetch(`/api/datasets/${datasetId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error ?? "Assign thất bại");
      return;
    }
    setStatus(`Đã tạo ${payload.createdAssignments} task`);
    onAssigned();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign task cho annotator</DialogTitle>
          <DialogDescription>Chọn phạm vi, overlap, metric và annotator nhận task.</DialogDescription>
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
            <div className="text-xs font-semibold uppercase text-slate-500">Metric phải chấm</div>
            <div className="flex flex-wrap gap-2">
              {metrics.map((metric) => (
                <label key={metric.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <input type="checkbox" checked={metricIds.includes(metric.id)} onChange={() => toggleMetric(metric.id)} />
                  {metric.label}
                </label>
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

          {status && <div className="text-sm text-slate-600">{status}</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type="button" onClick={assign} disabled={metricIds.length === 0 || annotatorIds.length < targetOverlap || (scope === "selected" && selectedRowIds.length === 0)}>
            <Send className="h-4 w-4" />
            Xác nhận giao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
