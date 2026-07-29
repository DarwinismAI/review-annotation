"use client";

import { useState } from "react";
import { RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useJsonResource } from "@/hooks/use-json-resource";

interface ImportJob {
  id: string;
  sourceFilename: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled" | string;
  rowCount: number;
  targetRowCount: number | null;
  progress: number;
  errorMessage: string | null;
  canCancel: boolean;
  canRetry: boolean;
  createdAt: string;
}

interface ImportJobsPayload {
  jobs?: ImportJob[];
  total?: number;
}

interface DatasetImportJobsPanelProps {
  datasetId: string;
}

const EMPTY_JOBS: ImportJobsPayload = { jobs: [], total: 0 };

function statusVariant(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "queued") return "warning";
  return "secondary";
}

export function DatasetImportJobsPanel({ datasetId }: DatasetImportJobsPanelProps) {
  const { data, error, loading, reload } = useJsonResource<ImportJobsPayload>(`/api/datasets/${datasetId}/import-jobs?pageSize=5`, EMPTY_JOBS);
  const [actionStatus, setActionStatus] = useState("");
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const jobs = data.jobs ?? [];

  async function runAction(jobId: string, action: "retry" | "cancel") {
    setActingJobId(jobId);
    setActionStatus("");
    try {
      const response = await fetch(`/api/import-jobs/${jobId}/${action}`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionStatus(payload.message ?? payload.error ?? "Không thực hiện được import job action");
        return;
      }
      setActionStatus(action === "cancel" ? "Đã cancel import job" : "Đã retry import job");
      reload();
    } catch {
      setActionStatus("Không thực hiện được import job action");
    } finally {
      setActingJobId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Import jobs</h2>
          <p className="text-xs text-slate-500">5 job gần nhất của dataset.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={reload} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 rounded-md bg-slate-100" />
          ))}
        </div>
      )}
      {!loading && jobs.length === 0 && <div className="text-sm text-slate-500">Chưa có import job.</div>}

      <div className="space-y-2">
        {jobs.map((job) => (
          <div key={job.id} aria-label={`Import job ${job.sourceFilename}`} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{job.sourceFilename}</div>
                <div className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString("vi-VN")}</div>
              </div>
              <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            </div>
            <div className="mt-3 space-y-1">
              <Progress value={job.progress} />
              <div className="text-xs text-slate-500">
                {job.rowCount.toLocaleString("vi-VN")} / {(job.targetRowCount ?? job.rowCount).toLocaleString("vi-VN")} rows
              </div>
            </div>
            {job.errorMessage && <div className="mt-2 text-sm text-red-600">{job.errorMessage}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!job.canRetry || actingJobId === job.id}
                onClick={() => runAction(job.id, "retry")}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!job.canCancel || actingJobId === job.id}
                onClick={() => runAction(job.id, "cancel")}
              >
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        ))}
      </div>

      {actionStatus && <div className="text-sm text-slate-600">{actionStatus}</div>}
    </section>
  );
}
