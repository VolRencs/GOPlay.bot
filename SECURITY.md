# Security Policy

**Language: English | [Русский](SECURITY.ru.md)**

## Supported versions

The project is developed on the `Dev` branch. Security fixes go into the current
code; there are no separate LTS releases yet.

## How to report a vulnerability

- **Do not open a public issue** for vulnerabilities (especially token leaks,
  access bypasses for `/api/guilds/*` or `/admin`, SSRF in the music resolver,
  or reading other guilds' uploads via `/uploads/...`).
- Contact the repository owner through a private channel:
  **GitHub → VolRencs → Security Advisories** (Private vulnerability reporting)
  for the `GOPlay.bot` repository. Describe: what, where (`file:line`), how to
  reproduce, potential impact.
- Response within 7 days; fix and disclosure timeline agreed with the reporter.

## What is already in place

- All dashboard API routes go through `src/lib/guild-access.ts`
  (`requireUser`/`requireAdmin`/`withGuild`): only server managers get access,
  admin panel only for `ADMIN_DISCORD_IDS`.
- Uploads are isolated per `guildId`, filenames are sanitized
  (`src/lib/uploads.ts`), request body limit + `client_max_body_size 8m` in nginx.
- The music resolver is restricted to the YouTube domain allowlist.
- When the bot is removed from a server, its data is wiped
  (`wipeGuildData` + `deleteGuildFiles`).

## Secret hygiene

- Never commit `.env`, `cookies.txt` (for `YT_DLP_EXTRA_ARGS`),
  `*.pem` / `*.key`, `data/*.sqlite*`.
- Leaked `DISCORD_TOKEN` → urgent Reset Token in Discord Developer Portal → Bot.
- Leaked `DISCORD_CLIENT_SECRET` → OAuth2 → Reset Secret + update redirect URLs.
- Leaked `BETTER_AUTH_SECRET` → generate a new one (`openssl rand -base64 32`),
  all sessions are invalidated.
