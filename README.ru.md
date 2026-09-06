# GOPlay.bot

**Язык: [English](README.md) | Русский**

[![CI](https://github.com/VolRencs/GOPlay.bot/actions/workflows/ci.yml/badge.svg)](https://github.com/VolRencs/GOPlay.bot/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22.12-green)
![pnpm](https://img.shields.io/badge/pnpm-12.3.4-orange)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

Discord-бот и веб-панель управления сервером в одном репозитории и одном процессе:
бот на `discord.js` + дашборд на `Next.js` с входом через Discord OAuth.

> Полная английская версия: [README.md](README.md).

## Возможности

**Бот (slash-команды, RU + EN-локализация):**
- Инфо: `play`, `ping`, `help`, `user`, `server`, `avatar`.
- Модерация: `ban`, `kick`, `timeout` / `untimeout`, `warn` / `warnings` / `clearwarn`,
  `purge`, `slowmode`, `lock` / `unlock` (команды модерации — только для администраторов).

**Модули (настраиваются из дашборда, вкладки `/dashboard/[guildId]`):**
| Вкладка | Что умеет |
|---|---|
| Статистика | Участники/онлайн, каналы, роли, активность |
| Приветствие | Текст + картинка для новых участников и прощание (шаблоны `{user}`, `{server}`, `{count}`…; рендер через resvg) |
| Автомодерация | Правила против спама, ссылок, инвайтов, флуда и дубликатов; игнор-роли, защищённый канал, эскалация наказаний |
| Роли | Самовыдача через кнопки, селекты и реакции |
| Embeds | Конструктор embed-сообщений, медиа-вложения, шаблоны |
| Музыка | YouTube в голосовом канале: `yt-dlp → ffmpeg (libopus) → voice`; очередь до 50 треков, плейлисты до 100, лимит длины 2 ч |
| События | Создание ивентов, участники, напоминания |
| Логи | Модлог: входы/выходы, редактирование/удаление сообщений, каналы, баны и т.д. |
| Временные каналы | Приватные голосовые по заходу в хаб-канал |
| Апелляции | Оспаривание наказаний через DM с кнопками |
| Журнал изменений | Кто и что менял в дашборде |
| Настройки | Язык бота (RU/EN) и параметры сервера |

Плюс: админ-панель владельца (`/admin`), вход через Discord (`better-auth`),
SQLite-хранилище (`node:sqlite`, WAL), i18n бота RU/EN, тесты `node --test`.

## Скриншоты

![Лендинг](assets/landing.png)
![Список серверов](assets/dashboard.png)
![Настройки сервера](assets/guild-settings.png)

## Быстрый старт (локально)

Требования: **Node ≥ 22.12**, **pnpm 12.3.4**, **ffmpeg с libopus**,
**yt-dlp** в PATH.

```bash
# 1. Системные зависимости (Debian/Ubuntu)
sudo apt install ffmpeg
ffmpeg -encoders | grep opus        # должен найти libopus
# yt-dlp: https://github.com/yt-dlp/yt-dlp#installation

# 2. Зависимости проекта
pnpm i --frozen-lockfile

# 3. Конфигурация
cp .env.example .env
# заполните .env (подробности — в шапке .env.example):
# DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET,
# BETTER_AUTH_SECRET (сгенерировать: openssl rand -base64 32),
# ADMIN_DISCORD_IDS (ваш Discord ID, иначе /admin отвечает 403)

# 4. Discord Developer Portal (https://discord.com/developers/applications):
# - Bot → Reset Token → включите intents Server Members и Message Content
# - OAuth2 → Redirects → http://localhost:3000/api/auth/callback/discord

# 5. Запуск (бот + веб в одном процессе, лог — data/logs/bot.log)
pnpm migrate:auth && pnpm dev
# открыть http://localhost:3000
```

Проверка перед коммитом:

```bash
pnpm check   # tsc --noEmit
pnpm test    # node --test test/*.test.ts
```

## Переменные окружения

| Переменная | Обязательность | Назначение |
|---|---|---|
| `DISCORD_TOKEN` | обязательна | Токен бота; без него процесс падает (`DISCORD_TOKEN is required`) |
| `DISCORD_CLIENT_ID` | обязательна | OAuth + invite-ссылка на лендинге |
| `DISCORD_CLIENT_SECRET` | обязательна | OAuth через Discord |
| `DATABASE_PATH` | опционально | Путь к SQLite, по умолчанию `data/bot.sqlite` |
| `NEXT_PUBLIC_APP_URL` | опционально | Публичный URL (fallback для better-auth) |
| `BETTER_AUTH_URL` | обязательна в проде | Канонический URL (`https://…` в проде) |
| `BETTER_AUTH_SECRET` | обязательна | Секрет сессий; генерация: `openssl rand -base64 32` |
| `DEBUG` | опционально | `1` включает info-логи, по умолчанию `0` |
| `DASHBOARD_ALLOWED_DISCORD_IDS` | опционально | Allowlist дашборда (пусто = любой управляющий сервером) |
| `ADMIN_DISCORD_IDS` | нужна для `/admin` | ID владельцев через запятую, иначе 403 всем |
| `YT_DLP_PATH` | опционально | Путь к `yt-dlp` (по умолчанию из PATH) |
| `FFMPEG_PATH` | опционально | Путь к `ffmpeg` (по умолчанию из PATH) |
| `YT_DLP_EXTRA_ARGS` | опционально | Доп. флаги yt-dlp, напр. `--cookies /path/to/cookies.txt` |

Никогда не коммитьте `.env`, `cookies.txt`, `*.pem` / `*.key`.
Подробные инструкции — в шапке [`.env.example`](.env.example).

## Скрипты

| Команда | Что делает |
|---|---|
| `pnpm dev` | `migrate:auth` + `next dev` и бот (`src/bot/index.ts`) через `concurrently`, лог в `data/logs/bot.log` |
| `pnpm build` | `next build` |
| `pnpm start` | `migrate:auth` + `next start` и бот, лог в `data/logs/bot.log` |
| `pnpm migrate:auth` | Миграции таблиц better-auth в той же SQLite |
| `pnpm test` | `node --test test/*.test.ts` |
| `pnpm check` | `tsc --noEmit` |

## Структура проекта

```
app/                  Next.js App Router: лендинг, /dashboard, /admin,
                      /login, API (/api/guilds, /api/admin, /api/auth),
                      раздача загрузок (/uploads/...)
src/bot/              Точка входа бота (index.ts) + модули:
                      moderation, automod, appeals, logging,
                      tempchannels, music, events, db, utils
src/db/               database.ts (node:sqlite, WAL) + migrations/*.sql
src/lib/              Общая логика: auth, guild-access, automod, welcome,
                      appeals, uploads, player/* (yt-dlp/ffmpeg стек), i18n
src/components/       React: user-menu + dashboard/* (панели вкладок)
scripts/              migrate-auth.ts, rotate-log.mjs (ротация bot.log > 5 МБ)
deploy/               nginx-ip-https.conf (пример reverse-proxy)
test/                 *.test.ts (node --test)
data/                 SQLite, логи, загрузки (не в git, кроме .gitkeep)
public/               bot-logo.png, fonts/, uploads/ (фоны приветствий, не в git)
```

## Продакшн

```bash
pnpm i --frozen-lockfile
pnpm build
pnpm start
```

- `BETTER_AUTH_URL` и `NEXT_PUBLIC_APP_URL` → `https://ВАШ_ДОМЕН`.
- В Discord Portal добавьте прод-redirect `https://ВАШ_ДОМЕН/api/auth/callback/discord`.
- Next держите только на `127.0.0.1:3000`, наружу — nginx
  (пример: [`deploy/nginx-ip-https.conf`](deploy/nginx-ip-https.conf),
  `client_max_body_size 8m`).
- Бекапьте `data/bot.sqlite` (и `-wal`/`-shm` рядом при работе).
- Ротация `data/logs/bot.log` — автоматически при старте (`scripts/rotate-log.mjs`).

## FAQ

- **`Sign in to confirm you're not a bot` при `/play`** — ограничение YouTube.
  Укажите cookies: `YT_DLP_EXTRA_ARGS=--cookies /path/to/cookies.txt`
  (файл держать вне git).
- **`missingFfmpeg` / `missingOpus`** — установите ffmpeg с libopus,
  либо укажите `FFMPEG_PATH` / `YT_DLP_PATH` явно.
- **`/admin` отвечает 403** — заполните `ADMIN_DISCORD_IDS` своим Discord ID
  (режим разработчика → копировать ID).
- **Самовыдача ролей не работает** — роль бота должна быть выше выдаваемых
  в иерархии сервера (бот пишет предупреждение в лог).
- **Пути с пробелами в `YT_DLP_EXTRA_ARGS`** — не поддерживаются
  (наивный сплит по пробелам), используйте пути без пробелов.

## Участие и безопасность

- Как контрибьютить: [`CONTRIBUTING.ru.md`](CONTRIBUTING.ru.md) ([English](CONTRIBUTING.md)).
- Куда сообщать об уязвимостях и утечках токенов: [`SECURITY.ru.md`](SECURITY.ru.md) ([English](SECURITY.md)).

## Лицензия и атрибуция

Проект под лицензией **GPL-3.0** — см. [`LICENSE`](LICENSE).
Copyright (C) 2026 VolRencs.

- Шрифты `public/fonts/NotoSans-*.ttf` — Noto Sans под SIL Open Font License.
- `public/bot-logo.png`, `app/icon.png` — собственные ассеты проекта.
