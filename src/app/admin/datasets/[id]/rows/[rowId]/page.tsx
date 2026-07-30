"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnnotationWorkspace, type AnnotationWorkspaceMetric } from "@/components/annotation/annotation-workspace";
import { AdjudicationPanel } from "@/components/admin/adjudication-panel";
import { AgreementBadge } from "@/components/admin/agreement-badge";
import { AnnotatorAvatarStack } from "@/components/admin/annotator-avatar-stack";
import { OverlapBadge } from "@/components/admin/overlap-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readJsonResponse } from "@/hooks/use-json-resource";

interface RowDetailAssignment {
  id: string;
  status: string;
  assignmentRunId?: string;
  annotator: { id: string; name: string | null; image: string | null };
  metrics: Record<string, { label: string; value: string | null; note: string | null }>;
}

interface RowDetail {
  id: string;
  internalRowId: number;
  detailFields: Record<string, unknown>;
  completedCount: number;
  targetOverlap: number;
  overlapLabel: string;
  missingCount: number;
  agreement: number | null;
  metrics: AnnotationWorkspaceMetric[];
  assignments: RowDetailAssignment[];
}

interface RowDetailPayload {
  row: RowDetail;
  error?: string;
}

interface AdjudicationPayload {
  adjudications?: Array<{ metricId: string; value: string | null; note: string | null }>;
  error?: string;
}

export default function AdminDatasetRowDetailPage() {
  const params = useParams<{ id: string; rowId: string }>();
  const searchParams = useSearchParams();
  const datasetId = params.id;
  const rowId = params.rowId;
  const from = searchParams.get("from") ?? "";
  const backHref = `/admin/datasets/${datasetId}${from ? `?${from}` : ""}`;
  const [row, setRow] = useState<RowDetail | null>(null);
  const [adjudicationValues, setAdjudicationValues] = useState<Record<string, { value: string | null; note: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rowResponse, adjudicationResponse] = await Promise.all([
        fetch(`/api/datasets/${datasetId}/rows/${rowId}`, { cache: "no-store" }),
        fetch(`/api/datasets/${datasetId}/rows/${rowId}/adjudication`, { cache: "no-store" }),
      ]);
      const [rowPayload, adjudicationPayload] = await Promise.all([
        readJsonResponse(rowResponse) as Promise<RowDetailPayload>,
        readJsonResponse(adjudicationResponse) as Promise<AdjudicationPayload>,
      ]);
      if (!rowResponse.ok) throw new Error(rowPayload.error ?? "Không tải được row");
      if (!adjudicationResponse.ok) throw new Error(adjudicationPayload.error ?? "Không tải được adjudication");
      setRow(rowPayload.row);
      setAdjudicationValues(
        Object.fromEntries((adjudicationPayload.adjudications ?? []).map((item) => [item.metricId, { value: item.value, note: item.note }])),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được row");
    } finally {
      setLoading(false);
    }
  }, [datasetId, rowId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded bg-slate-100" />
        <div className="h-28 rounded-md border border-slate-200 bg-white" />
        <div className="h-64 rounded-md border border-slate-200 bg-white" />
      </div>
    );
  }

  if (!row) {
    return <div className="text-sm text-red-600">{error || "Không tải được row"}</div>;
  }

  const annotators = row.assignments.map((assignment) => assignment.annotator);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Row {row.internalRowId}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">completed {row.completedCount}/{row.targetOverlap}</Badge>
            <OverlapBadge overlapLabel={row.overlapLabel} missingCount={row.missingCount} />
            <AgreementBadge agreement={row.agreement} />
            <AnnotatorAvatarStack annotators={annotators} />
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={backHref}>Quay lại dataset</Link>
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <AnnotationWorkspace
        datasetName=""
        internalRowId={row.internalRowId}
        status="review"
        detailFields={row.detailFields}
        metrics={row.metrics}
        values={{}}
        notes={{}}
        disabled
        onValueChange={() => undefined}
        onNoteChange={() => undefined}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Annotator results</h2>
        {row.assignments.map((assignment) => (
          <div key={assignment.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-slate-900">{assignment.annotator.name ?? assignment.annotator.id}</div>
                <div className="text-xs text-slate-500">{assignment.id}</div>
              </div>
              <Badge variant={assignment.status === "completed" ? "success" : "outline"}>{assignment.status}</Badge>
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
            </div>
          </div>
        ))}
        {row.assignments.length === 0 && <div className="rounded-md border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">Row chưa được assign.</div>}
      </section>

      <AdjudicationPanel datasetId={datasetId} rowId={rowId} metrics={row.metrics} initialValues={adjudicationValues} />
    </div>
  );
}
