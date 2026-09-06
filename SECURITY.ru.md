# Security Policy

**Язык: [English](SECURITY.md) | Русский**

## Поддерживаемые версии

Проект развивается на ветке `Dev`. Исправления безопасности вносятся в актуальный
код; отдельных LTS-релизов пока нет.

## Как сообщить об уязвимости

- **Не создавайте публичный issue** для уязвимостей (особенно утечек токенов,
  обхода доступа к `/api/guilds/*` или `/admin`, SSRF в музыкальном резолвере,
  чтения чужих загрузок через `/uploads/...`).
- Напишите владельцу репозитория через приватный канал:
  **GitHub → VolRencs → Security Advisories** (Private vulnerability reporting)
  для репозитория `GOPlay.bot`. Опишите: что, где (`файл:строка`), как
  воспроизвести, возможный ущерб.
- Ответ — в течение 7 дней; фикс и раскрытие — по согласованию с репортером.

## Что уже предусмотрено в коде

- Все API-роуты дашборда идут через `src/lib/guild-access.ts`
  (`requireUser`/`requireAdmin`/`withGuild`): доступ только у управляющих
  сервером, админка — только `ADMIN_DISCORD_IDS`.
- Загрузки изолированы по `guildId`, имена файлов санитизируются
  (`src/lib/uploads.ts`), лимит тела запроса + `client_max_body_size 8m` в nginx.
- Музыкальный резолвер ограничен allowlist YouTube-доменов.
- При удалении бота с сервера данные зачищаются
  (`wipeGuildData` + `deleteGuildFiles`).

## Гигиена секретов

- Никогда не коммитьте `.env`, `cookies.txt` (для `YT_DLP_EXTRA_ARGS`),
  `*.pem` / `*.key`, `data/*.sqlite*`.
- Утёк `DISCORD_TOKEN` → срочно Reset Token в Discord Developer Portal → Bot.
- Утёк `DISCORD_CLIENT_SECRET` → OAuth2 → Reset Secret + обновить redirect URLs.
- Утёк `BETTER_AUTH_SECRET` → сгенерировать новый (`openssl rand -base64 32`),
  все сессии инвалидируются.
