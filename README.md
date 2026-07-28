# review-annotation

Internal tool for annotation review, scoring, inline comments, and admin progress tracking.

## Development

```bash
pnpm install
pnpm dev
```

Set `SUPERADMIN_EMAILS=a@company.com,b@company.com` to bootstrap superadmin
access without requiring a DB role migration first.

## Verification

```bash
pnpm typecheck
pnpm build
```
