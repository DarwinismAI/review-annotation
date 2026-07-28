# expert-review Agent Notes

This repository is scoped to the Expert Review product only.

## Scope

- Keep product code, schema, migrations, scripts, docs, tests, PRD, UAT, and prototypes that support the Expert Review flow.
- Do not add project-local agent bundles, hooks, or skills from other workspaces.
- Do not add the separate guardrail annotation platform flow unless explicitly requested.

## Engineering Defaults

- Make surgical changes that are directly tied to the task.
- Prefer the existing Next.js App Router, Drizzle, Supabase, Tailwind, and shadcn/ui patterns.
- Run the smallest meaningful verification before claiming a change is done.
