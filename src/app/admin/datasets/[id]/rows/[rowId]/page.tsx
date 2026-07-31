"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnnotationWorkspace, type AnnotationWorkspaceMetric } from "@/components/annotation/annotation-workspace";
import { AdjudicationPanel, type PersistedAdjudication } from "@/components/admin/adjudication-panel";
import { AgreementBadge } from "@/components/admin/agreement-badge";
import { AnnotatorAvatarStack } from "@/components/admin/annotator-avatar-stack";
import { OverlapBadge } from "@/components/admin/overlap-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readJsonResponse } from "@/hooks/use-json-resource";
import { buildAdminRowHref, confirmDirtyNavigation, isTextInputTarget, type CompletionFilter } from "@/lib/datasets/admin-row-navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  adjudications?: Array<{ metricId: string; value: string | null; note: string | null }>;
  navigation: RowNavigation;
  error?: string;
}

interface RowNavigation {
  previousRowId: string | null;
  nextRowId: string | null;
  position: number;
  filteredTotal: number;
}

function normalizeCompletionFilter(value: string | null): CompletionFilter {
  if (value === "completed" || value === "complete" || value === "incomplete") return value;
  return "all";
}

export default function AdminDatasetRowDetailPage() {
  const params = useParams<{ id: string; rowId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const datasetId = params.id;
  const rowId = params.rowId;
  const from = searchParams.get("from") ?? "";
  const fromParams = new URLSearchParams(from);
  const search = searchParams.get("search") ?? fromParams.get("q") ?? "";
  const completion = normalizeCompletionFilter(searchParams.get("completion") ?? fromParams.get("completion"));
  const backHref = `/admin/datasets/${datasetId}${from ? `?${from}` : ""}`;
  const [row, setRow] = useState<RowDetail | null>(null);
  const [navigation, setNavigation] = useState<RowNavigation | null>(null);
  const [adjudicationValues, setAdjudicationValues] = useState<Record<string, { value: string | null; note: string | null }>>({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setLoading(true);
    setError("");
    setRow(null);
    setNavigation(null);
    const query = new URLSearchParams({
      search,
      completion,
    });
    try {
      const rowResponse = await fetch(`/api/datasets/${datasetId}/rows/${rowId}?${query.toString()}`, { cache: "no-store" });
      const rowPayload = (await readJsonResponse(rowResponse)) as RowDetailPayload;
      if (!rowResponse.ok) throw new Error(rowPayload.error ?? "Không tải được row");
      if (rowPayload.row.id !== rowId) throw new Error("Không tải được row hiện tại");
      if (loadIdRef.current !== loadId) return;
      setRow(rowPayload.row);
      setNavigation(rowPayload.navigation);
      setAdjudicationValues(
        Object.fromEntries((rowPayload.adjudications ?? []).map((item) => [item.metricId, { value: item.value, note: item.note }])),
      );
      setDirty(false);
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      setRow(null);
      setNavigation(null);
      setError(err instanceof Error ? err.message : "Không tải được row");
    } finally {
      if (loadIdRef.current === loadId) setLoading(false);
    }
  }, [completion, datasetId, rowId, search]);

  useEffect(() => {
    load();
  }, [load]);

  const goToRow = useCallback(
    (targetRowId: string | null, options: { skipDirtyConfirm?: boolean } = {}) => {
      if (!targetRowId) return;
      if (!options.skipDirtyConfirm && !confirmDirtyNavigation(dirty, () => window.confirm("Bạn có thay đổi chưa lưu. Rời khỏi câu này?"))) return;
      router.push(buildAdminRowHref({ datasetId, rowId: targetRowId, from, search, completion }));
    },
    [completion, datasetId, dirty, from, router, search],
  );

  const goBack = useCallback(() => {
    if (!confirmDirtyNavigation(dirty, () => window.confirm("Bạn có thay đổi chưa lưu. Quay lại dataset?"))) return;
    router.push(backHref);
  }, [backHref, dirty, router]);

  useEffect(() => {
    if (!navigation?.nextRowId) return;
    router.prefetch(buildAdminRowHref({ datasetId, rowId: navigation.nextRowId, from, search, completion }));
  }, [completion, datasetId, from, navigation?.nextRowId, router, search]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || isTextInputTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToRow(navigation?.previousRowId ?? null);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToRow(navigation?.nextRowId ?? null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToRow, navigation?.nextRowId, navigation?.previousRowId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded bg-slate-100" />
        <div className="h-28 rounded-md border border-slate-200 bg-white" />
        <div className="h-64 rounded-md border border-slate-200 bg-white" />
      </div>
    );
  }

  if (!row || row.id !== rowId || !navigation) {
    return <div className="text-sm text-red-600">{error || "Không tải được row"}</div>;
  }

  const annotators = row.assignments.map((assignment) => assignment.annotator);
  const handleSaved = (result: PersistedAdjudication[]) => {
    setAdjudicationValues(Object.fromEntries(result.map((item) => [item.metricId, { value: item.value, note: item.note }])));
    setDirty(false);
  };

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
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon" title="Câu trước (Alt+Left)" aria-label="Câu trước" disabled={!navigation.previousRowId} onClick={() => goToRow(navigation.previousRowId)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-slate-500">{navigation.position} / {navigation.filteredTotal}</span>
          <Button type="button" variant="outline" size="icon" title="Câu tiếp (Alt+Right)" aria-label="Câu tiếp" disabled={!navigation.nextRowId} onClick={() => goToRow(navigation.nextRowId)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" onClick={goBack}>
            Quay lại dataset
          </Button>
        </div>
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

      <AdjudicationPanel
        datasetId={datasetId}
        rowId={rowId}
        metrics={row.metrics}
        initialValues={adjudicationValues}
        onDirtyChange={setDirty}
        onSaved={handleSaved}
        onSaveAndNext={(result) => {
          handleSaved(result);
          goToRow(navigation.nextRowId, { skipDirtyConfirm: true });
        }}
        hasNext={Boolean(navigation.nextRowId)}
      />
    </div>
  );
}
