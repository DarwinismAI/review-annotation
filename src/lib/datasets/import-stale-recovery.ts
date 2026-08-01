export const IMPORT_STALE_RECOVERY_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export type ImportJobRecoveryState = {
  id: string;
  datasetId: string;
  datasetStatus: string;
  status: string;
  rowCount: number;
  createdAt: Date | string;
  activeImportId: string | null;
};

type RecoveryBlockedCode =
  | "IMPORT_JOB_NOT_IN_PROGRESS"
  | "IMPORT_JOB_NOT_STALE"
  | "IMPORT_JOB_NOT_ACTIVE_LOCK";

type RecoveryDecision =
  | {
      ok: true;
      datasetStatus: "failed";
      importStatus: "failed";
      errorMessage: string;
    }
  | {
      ok: false;
      code: RecoveryBlockedCode;
      message: string;
    };

function toTime(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function canFailStaleImportJob(job: ImportJobRecoveryState, now = new Date()): RecoveryDecision {
  if (job.status !== "in_progress") {
    return {
      ok: false,
      code: "IMPORT_JOB_NOT_IN_PROGRESS",
      message: "Only in-progress import jobs can be failed as stale.",
    };
  }

  if (job.datasetStatus !== "importing" || job.activeImportId !== job.id) {
    return {
      ok: false,
      code: "IMPORT_JOB_NOT_ACTIVE_LOCK",
      message: "Import job is no longer the active import lock for this dataset.",
    };
  }

  const ageMs = now.getTime() - toTime(job.createdAt);
  if (!Number.isFinite(ageMs) || ageMs < IMPORT_STALE_RECOVERY_MIN_AGE_MS) {
    return {
      ok: false,
      code: "IMPORT_JOB_NOT_STALE",
      message: "Import job is not old enough for explicit stale recovery.",
    };
  }

  return {
    ok: true,
    datasetStatus: "failed",
    importStatus: "failed",
    errorMessage: `Marked failed by admin stale-import recovery after at least 24 hours; partial rows preserved.`,
  };
}
