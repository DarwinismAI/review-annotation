"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgreementBadge } from "./agreement-badge";
import { AnnotatorAvatarStack } from "./annotator-avatar-stack";
import { JsonFieldValue } from "./json-field-value";
import { OverlapBadge } from "./overlap-badge";

interface RowDetailAssignment {
  id: string;
  status: string;
  annotator: { id: string; name: string | null; image: string | null };
  metrics: Record<string, { label: string; value: string | null; note: string | null }>;
}

interface DatasetRowDetail {
  id: string;
  internalRowId: number;
  detailFields: Record<string, unknown>;
  completedCount: number;
  targetOverlap: number;
  overlapLabel: string;
  missingCount: number;
  agreement: number | null;
  assignments: RowDetailAssignment[];
}

interface DatasetRowDetailResponse {
  row: DatasetRowDetail;
}

interface DatasetRowDetailDialogProps {
  datasetId: string;
  rowId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DatasetRowDetailDialog({ datasetId, rowId, open, onOpenChange }: DatasetRowDetailDialogProps) {
  const [detail, setDetail] = useState<DatasetRowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !rowId) {
      setDetail(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetch(`/api/datasets/${datasetId}/rows/${rowId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Không tải được chi tiết row");
        setDetail((payload as DatasetRowDetailResponse).row);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Không tải được chi tiết row");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [datasetId, open, rowId]);

  const annotators = detail?.assignments.map((assignment) => assignment.annotator) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail ? `Row ${detail.internalRowId}` : "Row detail"}</DialogTitle>
          <DialogDescription>Chi tiết dữ liệu và kết quả annotation của row.</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-3">
            <div className="h-16 rounded-md bg-slate-100" />
            <div className="h-28 rounded-md bg-slate-100" />
            <div className="h-28 rounded-md bg-slate-100" />
          </div>
        )}

        {!loading && error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {!loading && !error && detail && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <Badge variant="secondary">completed {detail.completedCount}/{detail.targetOverlap}</Badge>
              <OverlapBadge overlapLabel={detail.overlapLabel} missingCount={detail.missingCount} />
              <AgreementBadge agreement={detail.agreement} />
              <AnnotatorAvatarStack annotators={annotators} />
            </div>

            <section>
              <h3 className="text-sm font-semibold text-slate-900">Detail fields</h3>
              <div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                {Object.entries(detail.detailFields).map(([field, value]) => (
                  <div key={field} className="grid gap-2 px-3 py-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <div className="text-sm font-medium text-slate-600">{field}</div>
                    <JsonFieldValue value={value} maxLength={1200} wrap />
                  </div>
                ))}
                {Object.keys(detail.detailFields).length === 0 && <div className="px-3 py-4 text-sm text-slate-500">Không có detail field.</div>}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-900">Assignments</h3>
              <div className="mt-2 space-y-3">
                {detail.assignments.map((assignment) => (
                  <div key={assignment.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{assignment.annotator.name ?? assignment.annotator.id}</div>
                        <div className="text-xs text-slate-500">{assignment.id}</div>
                      </div>
                      <Badge variant={assignment.status === "completed" ? "secondary" : "outline"}>{assignment.status}</Badge>
                    </div>
                    <div className="mt-3 divide-y divide-slate-100">
                      {Object.entries(assignment.metrics).map(([metricKey, metric]) => (
                        <div key={metricKey} className="grid gap-2 py-2 sm:grid-cols-[220px_minmax(0,1fr)]">
                          <div>
                            <div className="text-sm font-medium text-slate-700">{metric.label}</div>
                            <div className="text-xs text-slate-400">{metricKey}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-sm text-slate-900">{metric.value ?? "-"}</div>
                            {metric.note && <div className="text-sm text-slate-600">{metric.note}</div>}
                          </div>
                        </div>
                      ))}
                      {Object.keys(assignment.metrics).length === 0 && <div className="py-3 text-sm text-slate-500">Chưa có metric result.</div>}
                    </div>
                  </div>
                ))}
                {detail.assignments.length === 0 && <div className="rounded-md border border-slate-200 px-3 py-4 text-sm text-slate-500">Row chưa được assign.</div>}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
