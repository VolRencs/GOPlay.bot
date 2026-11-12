# Contributing to GOPlay.bot

**Language: English | [Русский](CONTRIBUTING.ru.md)**

Thanks for your interest in the project! A few short rules to get your PRs merged quickly.

## Stack and commands

- Node ≥ 26, pnpm 12.18.0, ffmpeg with libopus. `ytrust` is installed as a native pnpm dependency.
- `pnpm i --frozen-lockfile` — install.
- `cp .env.example .env` — fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
  `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- `pnpm dev` — run (bot + web together, `http://localhost:3000`).
- `pnpm check` (`next typegen && tsc --noEmit`) and `pnpm test` (`node --test test/*.test.ts`) —
  required before every PR. CI runs the same plus `pnpm build`.

## How to format changes

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`. One commit — one logical change.
- PR: what was done, why, how it was verified (`check`/`test` output). The template
  is applied automatically (`.github/PULL_REQUEST_TEMPLATE.md`).
- Never commit: `.env`, `cookies.txt`, `*.pem`/`*.key`, `data/*.sqlite*`,
  `data/logs/`, `data/uploads/`, `.next/`, `*.tsbuildinfo`.

## Where to change what

- Bot slash commands: `src/bot/commands.ts` (RU description +
  `description_localizations` for EN).
- Bot strings RU/EN: `src/lib/i18n/` (`core.ts`, `bot.ts`, `bot/*.ts`).
  Add every new string in both languages at once.
- DB schema: numbered SQL files in `src/db/migrations/`, applied in order by
  `src/db/database.ts` and tracked in the `_migrations` table. Add a new
  `NNN_*.sql` migration for every schema change; never edit an already-applied
  migration. The baseline `001_init.sql` is for fresh databases only.
  Never touch better-auth tables — they are managed by `scripts/migrate-auth.ts`.
- Dashboard API: `app/api/guilds/[guildId]/*/route.ts`. Every new endpoint must
  go through the public wrappers in `src/lib/guild-access.ts` (`guildRoute`/`adminRoute`)
  and validate every channel/role/message ID from the request via
  `src/lib/guild-resources.ts` before saving or sending.
  Write to the audit log via `src/lib/dashboard-audit.ts` where applicable.
- Dashboard panels: `src/components/dashboard/*.tsx` + types in `types.ts`.
- Embed fields/limits: `src/contracts/embeds.ts`; message and event composers share this model.
- Music (`src/lib/player/`): the resolver never leaves the YouTube domain allowlist;
  new sources only with equivalent restrictions (see the SSRF comments).

## Tests

- Unit tests: `test/*.test.ts`, runner `node --test`.
- Cover new pure logic (parsing, detectors, queues) with a test in the same style.
- Whatever tests don't cover, verify manually: bot on a test Discord server
  + dashboard in the browser.

## Releases and production

- `pnpm build && pnpm start`; nginx example — `deploy/nginx-ip-https.conf`.
- Back up before schema changes: copy `data/bot.sqlite`.
