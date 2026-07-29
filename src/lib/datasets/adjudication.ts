export interface ReviewerAdjudication {
  rowId: string;
  metricId: string;
  metricKey: string;
  reviewerId: string | null;
  reviewerName: string | null;
  value: string | null;
  note: string | null;
  updatedAt: string;
}

export function buildAdjudicationMap(adjudications: ReviewerAdjudication[]) {
  return Object.fromEntries(
    adjudications.map((item) => [
      item.metricKey,
      {
        metric_id: item.metricId,
        reviewer: { id: item.reviewerId, name: item.reviewerName },
        value: item.value,
        note: item.note,
        updated_at: item.updatedAt,
      },
    ]),
  );
}

export function attachAdjudicationToExport<T extends object>(row: T, adjudications: ReviewerAdjudication[]) {
  return { ...row, adjudication: buildAdjudicationMap(adjudications) };
}
