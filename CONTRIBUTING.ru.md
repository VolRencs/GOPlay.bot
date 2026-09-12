# Contributing to GOPlay.bot

**Язык: [English](CONTRIBUTING.md) | Русский**

Спасибо за интерес к проекту! Короткие правила, чтобы PR принимались быстро.

## Стек и команды

- Node ≥ 26, pnpm 12.4.1, ffmpeg с libopus, yt-dlp в PATH.
- `pnpm i --frozen-lockfile` — установка.
- `cp .env.example .env` — заполнить `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
  `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- `pnpm migrate:auth && pnpm dev` — запуск (бот + веб, `http://localhost:3000`).
- `pnpm check` (`tsc --noEmit`) и `pnpm test` (`node --test test/*.test.ts`) —
  обязательны перед каждым PR. CI выполняет то же самое плюс `pnpm build`.

## Как оформлять изменения

- Коммиты в стиле conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`. Один коммит — одна логическая правка.
- PR: что сделано, зачем, как проверено (`check`/`test` вывод). Шаблон подставится
  автоматически (`.github/PULL_REQUEST_TEMPLATE.md`).
- Не коммитьте: `.env`, `cookies.txt`, `*.pem`/`*.key`, `data/*.sqlite*`,
  `data/logs/`, `public/uploads/`, `.next/`, `*.tsbuildinfo`.

## Где что менять

- Slash-команды бота: `src/bot/index.ts` (массив `commands`, RU-описание +
  `description_localizations` для EN).
- Тексты бота RU/EN: `src/lib/i18n/` (`core.ts`, `bot.ts`, `bot/*.ts`).
  Новую строку добавляйте сразу в оба языка.
- Миграции БД: новый файл `src/db/migrations/NNN_name.sql`
  (применяется автоматически через `src/db/database.ts`, таблица `_migrations`).
  Таблицы better-auth трогать нельзя — ими управляет `scripts/migrate-auth.ts`.
- API дашборда: `app/api/guilds/[guildId]/*/route.ts`. Любая новая точка обязана
  идти через проверки из `src/lib/guild-access.ts` (`requireUser`/`withGuild`)
  и писать в журнал через `src/lib/dashboard-audit.ts`, где это уместно.
- Панели дашборда: `src/components/dashboard/*.tsx` + типы в `types.ts`.
- Музыка (`src/lib/player/`):Resolver не выходит за allowlist YouTube-доменов;
  новые источники — только с аналогичными ограничениями (см. SSRF-комментарии).

## Тесты

- Юнит-тесты: `test/*.test.ts`, раннер `node --test`.
- Новую чистую логику (парсинг, детекторы, очереди) покрывайте тестом в том же стиле.
- Что не покрыто тестами, проверяйте вручную: бот на тестовом сервере Discord
  + дашборд в браузере.

## Релизы и прод

- `pnpm build && pnpm start`; пример nginx — `deploy/nginx-ip-https.conf`.
- Бекап перед миграциями: скопировать `data/bot.sqlite`.
