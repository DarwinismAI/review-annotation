# Dataset List Search Filter Design

## Goal

Improve the admin Datasets page with practical list controls: pagination, metadata search, status filter, domain filter, and page-size selection.

This scope intentionally excludes metric CRUD and domain/sub-domain CRUD. Metrics continue to apply at the parent domain level already used by the dataset workflow.

## Current Context

- UI route: `src/app/admin/datasets/page.tsx`
- List API: `src/app/api/datasets/route.ts`
- The UI already has a table, fixed `PAGE_SIZE = 50`, and previous/next pagination.
- The API already accepts `page` and `pageSize`, computes totals, row counts, metric counts, latest import, and summary counts.
- Search/filter are not currently exposed in the UI or API.

## User Decisions

- Dataset search should only search metadata, not row content.
- Metadata search includes dataset name and latest/import filename.
- Layout should use a compact toolbar above the table, not a left filter panel.
- Domain CRUD and metric/domain CRUD are out of scope for this implementation.

## UX Design

The Datasets page keeps its current table-first layout. A compact toolbar sits between the page heading and table:

- Search input with placeholder `Tìm dataset hoặc file import`.
- Domain dropdown with `Tất cả lĩnh vực` plus existing domain labels.
- Status dropdown with `Tất cả trạng thái`, `ready`, and `importing`.
- Page-size dropdown with `25`, `50`, `100`.
- Optional clear/reset button appears when any filter is active.

The page summary should remain concise:

- Heading: `Datasets`
- Subtext: `Hiển thị X-Y / N dataset.`
- Pagination footer: `Trang P / T`, with `Trước` and `Sau`.

Interactions:

- Changing `q`, `domain`, `status`, or `pageSize` resets `page` to `1`.
- Pagination changes only `page`.
- Filter state is stored in the URL so reload/share/back navigation preserve the current view.
- Empty state distinguishes between no datasets and no datasets matching filters.

## URL Contract

The admin route should use these query params:

```text
/admin/datasets?q=output&domain=safety_compliance&status=ready&page=2&pageSize=50
```

Supported params:

- `q`: optional string. Trimmed. Empty value is treated as absent.
- `domain`: optional domain key. Invalid values return `400`.
- `status`: optional dataset status. Supported values for this scope: `ready`, `importing`.
- `page`: positive integer, default `1`.
- `pageSize`: one of `25`, `50`, `100`, default `50`.

## API Contract

`GET /api/datasets` accepts:

- `page`
- `pageSize`
- `q`
- `domain`
- `status`

Response keeps the existing shape:

```ts
{
  datasets: Array<{
    id: string;
    name: string;
    domain: string;
    status: string;
    rowCount: number;
    metricCount: number;
    latestImport: string | null;
    createdAt: string | number;
  }>;
  page: number;
  pageSize: number;
  total: number;
  summary: {
    datasetCount: number;
    rowCount: number;
    metricCount: number;
    readyCount: number;
    importingCount: number;
  };
}
```

Filtering rules:

- `domain` filters `datasets.domain`.
- `status` filters `datasets.status`.
- `q` matches `datasets.name` or any import filename for that dataset.
- `total` is the filtered total, not the global total.
- `summary` remains global so the top-level admin summary is stable; the UI list count comes from `total`.

Search implementation should avoid row-content joins. Matching import filename can be implemented with an import subquery or `exists` predicate against `dataset_imports`.

## Performance Requirements

- Do not fetch rows from `dataset_rows` to search.
- Keep pagination server-side.
- Keep row count and metric count grouped only for the datasets on the current page.
- Avoid per-dataset N+1 queries for counts or latest import.
- Page size must be capped at `100`.

Recommended query shape:

1. Build a reusable dataset filter predicate from `q`, `domain`, and `status`.
2. Query filtered count.
3. Query filtered page of datasets ordered by newest first.
4. For page dataset IDs only, batch row counts, metric counts, and latest import.

## Error Handling

- Invalid `page` falls back to `1`.
- Invalid `pageSize` falls back to `50`.
- Invalid `status` or `domain` returns `400` with a readable error.
- UI shows the existing red error alert for API failures.
- During loading, the existing table skeleton remains.

## Testing

Dataset/API tests:

- Default list returns page 1 with default page size.
- `pageSize=25/50/100` is honored.
- Invalid page size falls back to `50`.
- Invalid domain or status returns `400`.
- Search by dataset name returns matching datasets.
- Search by import filename returns matching datasets.
- Status filter returns only matching status.
- Domain filter returns only matching domain.
- Combined search + filter returns the correct filtered `total`.

E2E tests:

- Admin can search by dataset name.
- Admin can search by latest/import filename.
- Admin can filter by status and domain.
- Admin can change page size.
- URL query state survives reload.

## Non-Goals

- No row-content search.
- No full-text index or external search service.
- No metric CRUD changes.
- No domain or sub-domain CRUD.
- No changes to dataset import, assign, annotation, or export behavior.
