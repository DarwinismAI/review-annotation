# API Fast Path And Admin Row Navigation Design

**Date:** 2026-07-31  
**Status:** Approved design  
**Scope:** Review Annotation API latency, reviewed findings, and admin row navigation

## Context

Production navigation now renders the route shell quickly, but direct uncached API probes remain slow:

| Endpoint | Baseline |
| --- | ---: |
| `GET /api/admin/members` | 1,204 ms |
| `GET /api/rubrics` | 1,449 ms |
| `GET /api/datasets?page=1&pageSize=50&counts=1` | 1,680 ms |
| `GET /api/datasets?page=1&pageSize=5&summary=1&counts=1` | 2,173 ms |

The measured payloads are only 451 bytes to 2.7 KB. The dominant cost is request round-trips:

1. Every protected API calls Supabase `auth.getUser()`.
2. Every protected API then reads `profiles` through Supabase REST.
3. The application handler performs one or more PostgreSQL query waves.
4. Some pages call overlapping APIs that repeat auth and database reads.

The source-grounded architecture graph is available in:

- `docs/architecture/review-annotation-api-performance.excalidraw`
- `docs/architecture/review-annotation-api-performance.png`

## Goals

- Make direct uncached hot read APIs as fast as the current stack permits, with a target p95 of 150 ms on warmed functions in dev and production.
- Keep visible navigation feedback at or below 150 ms.
- Measure cold starts separately so client caching cannot hide backend latency.
- Preserve authoritative server-side role checks.
- Preserve transactional annotation draft, submit, skip, adjudication, assignment, import, and role mutation behavior.
- Fix all actionable findings from the 2026-07-30 review.
- Let admins move quickly between dataset rows without losing unsaved adjudication input.
- Keep the solution inside the existing Next.js, Supabase, PostgreSQL, Drizzle, and Vercel stack.

## Non-Goals

- Adding Redis, Vercel KV, a queue, or a new backend service.
- Replacing Supabase Auth.
- Building a generic caching framework.
- Changing annotation assignment or overlap semantics.
- Adding random row navigation for admins in this iteration.
- Weakening authorization to meet a latency target.

## Architecture Decision

Use a surgical fast path:

1. Co-locate Vercel Functions with the Supabase PostgreSQL region.
2. Verify Supabase JWTs with `auth.getClaims()` instead of making an Auth server request on every API call.
3. Read the authoritative application role directly from PostgreSQL.
4. Reduce each hot read endpoint to at most one or two database round-trips.
5. Keep all mutations uncached and transactional.
6. Add no external cache service.

### JWT Verification Gate

`getClaims()` is locally fast only when the Supabase project uses an asymmetric signing key.

- Inspect the active token algorithm and Supabase JWKS availability without logging token contents.
- If the project uses an asymmetric key, switch the shared auth helper to `getClaims()`.
- If the project still uses a symmetric key, rotate to an asymmetric signing key before enabling the fast path.
- Never decode an unverified JWT.
- Continue reading the application role from `profiles`; do not trust a browser-provided role.

### Region Alignment

- Measure the active Vercel function region and the Supabase database region.
- Configure one Vercel function region nearest to the database for both dev and production.
- Confirm that both GitHub branches deploy with the intended region.
- Record `VERCEL_REGION` and timing phase names, but never secrets, in benchmark artifacts.

## Auth And Request Flow

The shared protected-route helper will perform:

1. Read the Supabase access token from the request cookie.
2. Verify identity using `getClaims()`.
3. Query `profiles` through the existing Drizzle/PostgreSQL connection for the current role.
4. Apply `requireAdmin`, `requireSuperAdmin`, or `requireAnnotator`.
5. Invoke the route handler.

The helper will expose phase timing for:

- `auth`
- `profile`
- `sql`
- `total`

Timings will be emitted through `Server-Timing`. They must not include user IDs, emails, tokens, SQL values, or connection strings.

## API Query Design

### Datasets List And Dashboard

- Replace separate page and total queries with a bounded query using a window count or equivalent CTE.
- Compute row, metric, and latest-import values for the selected page inside the same database round-trip.
- Add a dashboard snapshot endpoint that returns recent datasets, global counts, and active annotator count after one auth evaluation.
- Keep the existing list response fields stable unless the frontend and tests are changed in the same commit.

### Dataset Row List

- Build the search and completion predicate before pagination.
- Return `total` for the filtered result, not the whole dataset.
- Paginate only after the filtered row set is established.
- Compute assignment progress and agreement for only the selected page.
- Preserve list-field projection and avoid loading unused detail fields.

### Admin Row Detail

- Keep one row-detail GET endpoint.
- Include existing adjudication data in that response.
- Remove the duplicate adjudication GET from the page.
- Load dataset metadata and row identity together.
- Load metrics, assignments, results, adjudication, and navigation neighbors in parallel after row validation.
- Return:

```ts
interface AdminRowNavigation {
  previousRowId: string | null;
  nextRowId: string | null;
  position: number;
  filteredTotal: number;
}
```

- Neighbor selection must use the current dataset search and completion filter.
- Default ordering remains `internalRowId ASC`.

### Members And Rubrics

- Keep one business query per endpoint.
- Remove Supabase REST profile lookup from their hot path.
- Add only evidence-backed indexes found missing by `EXPLAIN ANALYZE`.

## Client Cache Behavior

- Cache keys must include the authenticated session identity and URL.
- Clear all fast-resource entries on sign-in, sign-out, and session replacement.
- Never cache mutation responses.
- Do not render page N data under a page N+1 label.
- Track requested page separately from displayed response page.
- On a failed page request, retain the last successful page and its matching page number.

## Security And Migration Fixes

### Adjudication RLS

Apply an idempotent security migration:

```sql
ALTER TABLE public.annotation_adjudications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.annotation_adjudications FROM anon, authenticated;
```

The application uses server-side PostgreSQL access for adjudication. No direct browser policy is required.

### Production Index Creation

- Keep additive table and column DDL plus catalog and row-count verification transactional.
- Build new production indexes with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` outside the transaction.
- Make each phase idempotent and independently verifiable.
- Do not run a standard index build against live annotation tables.

## Admin Row Navigation UX

The row detail header will contain a compact navigation group:

- Previous row icon button
- Current position and filtered total
- Next row icon button
- Back to dataset command

The adjudication action area will contain:

- `Lưu`
- `Lưu & câu tiếp`

Behavior:

- Prefetch the next row after the current row is ready.
- Preserve dataset search and completion filter in the URL.
- Navigate only after a successful adjudication save.
- On save failure, remain on the current row and preserve all input.
- Block Previous, Next, and Back when there are unsaved changes unless the user confirms discarding them.
- Support `Alt+Left` and `Alt+Right` outside text inputs.
- Disable unavailable Previous or Next actions at the filtered boundaries.
- Keep annotator results visible and read-only to admins and superadmins.

## Data Integrity

- Draft, submit, skip, assignment, import, adjudication, and role changes remain uncached.
- Multi-metric writes remain inside a transaction.
- Navigation never treats client cache as proof that a mutation succeeded.
- `Lưu & câu tiếp` waits for a 2xx response and the returned persisted values before navigation.
- A failed mutation must not clear local values.
- Existing annotation results are never overwritten by admin adjudication.

## Verification

### Focused Tests

- Auth helper rejects missing, expired, malformed, and unverified tokens.
- Admin, superadmin, and annotator role guards retain current behavior.
- Same-tab user A to user B login does not reuse cached task groups or admin data.
- Dataset search and completion filters run before pagination and return filtered totals.
- Page transitions never display rows under the wrong page number.
- Adjudication RLS blocks direct `anon` and `authenticated` table access.
- Migration catalog, row-count invariants, and concurrent index phases pass.
- Row detail returns adjudication and correct filtered neighbors.
- Save failure preserves input and blocks navigation.
- Save and next persists data before opening the next row.

### Persona Playwright Flows

Run real browser flows on dev with isolated data:

- Superadmin: login, manage roles, open dataset, inspect row, adjudicate, save and next, logout.
- Admin: login, create/import dataset, assign, filter rows, inspect annotator results, adjudicate, navigate, export, logout.
- Annotator: login, open task group, draft, reload, submit, skip, random next, complete, logout.
- Same-tab role/account switch: cached data from the previous user must not appear.

Run the full persona suite again after deployment to production using non-destructive seeded records.

### Performance Gates

- Visible navigation acknowledgement p95: at most 150 ms.
- Warmed direct uncached hot-read API p95: target at most 150 ms.
- Cold-start API duration: measured and reported separately.
- No 5xx responses, JSON parse failures, page errors, or console errors.
- Performance tests must wait for API-backed content, not only a loading shell or optimistic navigation state.
- Compare payload shape and persisted annotation values before and after optimization.

If a hot API remains above 150 ms after region, auth, and query fixes, the next iteration must use `Server-Timing` and `EXPLAIN ANALYZE` evidence. It must not introduce Redis or denormalized counters without a separately approved design.

## Rollout Order

1. Apply RLS and safe index migration changes.
2. Add timing instrumentation and baseline evidence.
3. Align Vercel and database regions.
4. Replace remote Auth verification with the verified-claims fast path.
5. Optimize list, dashboard, and row-detail queries.
6. Fix session cache and pagination state.
7. Add admin Previous, Next, and Save & next.
8. Run focused tests, all three persona flows, data-persistence checks, and dev performance gates.
9. Deploy to production and repeat non-destructive verification.

## Rollback

- Auth fast path remains isolated behind the shared auth helper and can revert to the previous verified path without changing route handlers.
- Query response contracts remain backward-compatible during rollout.
- Security migrations are additive and must not be rolled back by disabling RLS.
- UI navigation can be reverted without changing persisted adjudication data.

