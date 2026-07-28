# Spec: Performance + JSONL Upload

## Goal

Improve the hosted/local review annotation app where users perceive slow backend loads and janky sidebar tab transitions, and support uploading newline-delimited JSON files such as `/Users/haido/Downloads/output_data.jsonl`.

## Scope

- Dataset upload and append import must accept JSON array `.json` files and newline-delimited `.jsonl` files.
- Large dataset imports should avoid one massive insert statement and avoid fetching all existing rows just to compute the append offset.
- Hosted login/sidebar navigation should not make unnecessary local-dev API probes.
- Sidebar navigation should keep stable dimensions and use low-cost visual state transitions.

## Testable Behaviors

- `parseDatasetRows` parses `.jsonl` one JSON object per non-empty line, preserving current JSON-array behavior.
- Invalid JSONL reports the line number that failed.
- Dataset create and append paths insert rows in chunks.
- Append import offset uses aggregate max row id, not a full row scan.
- Browser smoke can log in, switch sidebar tabs, and reach dashboard/datasets/rubrics without request status `>= 400`.

## Parallelization Strategy

Implementation parallelism: Parallel lanes
Reason: JSONL parser/import, backend query batching, and sidebar visual transition are independent write scopes.

Can parallelize: yes, but local agent spawning is unavailable due thread limit, so controller executes lanes sequentially.

Implementation lanes:
- Lane A: `src/lib/datasets/import-validation.ts`, dataset tests, dataset upload/append UI accept/parsing.
- Lane B: `src/app/api/datasets/*`, chunked insert and append offset performance.
- Lane C: `src/components/app-sidebar.tsx`, `src/components/app-mobile-nav.tsx`, optional shell/header render cleanup.

Sequential dependencies:
- Parser behavior must land before UI/API JSONL wiring.
- Final browser smoke requires the integrated build.

Verification:
- `pnpm test:datasets` or `pnpm run test:datasets`.
- `pnpm run typecheck`.
- Playwright smoke against localhost for login + sidebar navigation + dataset inspect with JSONL sample.

Recommended Phase 3 Agent Split Gate input: Local only
Reason: agent spawn failed due thread limit; sequential controller execution avoids half-applied patches.
