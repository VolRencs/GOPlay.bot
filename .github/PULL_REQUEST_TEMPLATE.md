## What was done

<!-- Briefly: what task, what changed -->

## Why

<!-- Why this is needed -->

## How it was verified

- [ ] `pnpm check` (tsc --noEmit)
- [ ] `pnpm test` (node --test)
- [ ] Manual check: <!-- bot on a test server / dashboard in the browser -->

## Checklist

- [ ] Bot strings added in both RU and EN (`src/lib/i18n/`)
- [ ] DB migration as a new `src/db/migrations/NNN_*.sql` file (better-auth tables untouched)
- [ ] New API routes go through the checks in `src/lib/guild-access.ts`
- [ ] No `.env`, `cookies.txt`, `*.sqlite*`, logs, or `public/uploads/*` committed
