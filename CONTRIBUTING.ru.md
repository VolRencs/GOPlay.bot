# Contributing to GOPlay.bot

**Язык: [English](CONTRIBUTING.md) | Русский**

Спасибо за интерес к проекту! Короткие правила, чтобы PR принимались быстро.

## Стек и команды

- Node ≥ 26, pnpm 12.19.0, ffmpeg с libopus. `ytrust 1.0.0` ставится как нативная зависимость pnpm.
- `pnpm i --frozen-lockfile` — установка.
- `cp .env.example .env` — заполнить `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
  `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- `pnpm dev` — запуск (бот + веб вместе, `http://localhost:3000`).
- `pnpm check` (`next typegen && tsc --noEmit`) и `pnpm test` (`node --test test/*.test.ts`) —
  обязательны перед каждым PR. CI выполняет то же самое плюс `pnpm build`.

## Как оформлять изменения

- Коммиты в стиле conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`. Один коммит — одна логическая правка.
- PR: что сделано, зачем, как проверено (`check`/`test` вывод). Шаблон подставится
  автоматически (`.github/PULL_REQUEST_TEMPLATE.md`).
- Не коммитьте: `.env`, `cookies.txt`, `*.pem`/`*.key`, `data/*.sqlite*`,
  `data/logs/`, `data/uploads/`, `.next/`, `*.tsbuildinfo`.

## Где что менять

- Slash-команды бота: `src/bot/commands.ts` (RU-описание +
  `description_localizations` для EN).
- Тексты бота RU/EN: `src/lib/i18n/` (`core.ts`, `bot.ts`, `bot/*.ts`).
  Новую строку добавляйте сразу в оба языка.
- Схема БД: нумерованные SQL-файлы в `src/db/migrations/`, применяются по порядку
  через `src/db/database.ts` с отметкой в таблице `_migrations`. Для любого
  изменения схемы добавляйте новую миграцию `NNN_*.sql`; уже применённые
  миграции редактировать нельзя. `001_init.sql` — база для свежих установок.
  Таблицы better-auth трогать нельзя — ими управляет `scripts/migrate-auth.ts`.
- API дашборда: `app/api/guilds/[guildId]/*/route.ts`. Любая новая точка обязана
  идти через публичные обёртки из `src/lib/guild-access.ts` (`guildRoute`/`adminRoute`)
  и проверять все channel/role/message ID из запроса через
  `src/lib/guild-resources.ts` до сохранения или отправки.
  Писать в журнал через `src/lib/dashboard-audit.ts`, где это уместно.
- Панели дашборда: `src/components/dashboard/*.tsx` + типы в `types.ts`.
- Поля и лимиты embed: `src/contracts/embeds.ts`; композеры сообщений и событий используют общую модель.
- Музыка (`src/lib/player/`): резолвер не выходит за allowlist YouTube-доменов;
  новые источники — только с аналогичными ограничениями (см. SSRF-комментарии).

## Тесты

- Юнит-тесты: `test/*.test.ts`, раннер `node --test`.
- Новую чистую логику (парсинг, детекторы, очереди) покрывайте тестом в том же стиле.
- Что не покрыто тестами, проверяйте вручную: бот на тестовом сервере Discord
  + дашборд в браузере.

## Релизы и прод

- `pnpm build && pnpm start`; пример nginx — `deploy/nginx-ip-https.conf`.
- Бекап перед изменениями схемы: скопировать `data/bot.sqlite`.
