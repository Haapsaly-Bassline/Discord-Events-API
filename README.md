# Discord Events API (Beta)

API + web page for **Discord Scheduled Events** with hashtag filtering from the event description.

## How filtering works

Hashtags in event `name` / `description`:

| Hashtag | `type` |
|---|---|
| `#IRL` | `irl` |
| `#VR`, `#VIRTUAL` | `virtual` |
| `#RADIO` | `radio` |
| anything else / no tag | `other` |

Other `#tags` are returned as-is in `tags`, links are extracted into `links` with a human label (YouTube, Twitch, Spotify, …).

## Quick start

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
# fill GUILD_ID + DISCORD_BOT_TOKEN in .env
npm start
```

Open http://localhost:3000

Without `GUILD_ID` / `DISCORD_BOT_TOKEN` the API serves mock events (useful for frontend dev).

### Windows

`dc_events_api.bat` — double-click to start (`npm start`).

## API

- `GET /api/health` — `{ ok, mock, cacheAgeMs, uptimeSec }`
- `GET /api/events?type=irl&status=live&sort=start_asc&limit=10&force=1`
  - `type`: `irl | virtual | radio | other`
  - `status`: `live | upcoming`
  - `sort`: `start_asc | start_desc`
  - `limit`: number
  - `force=1`: skip cache
- `GET /api/events/live` — only live events
- `GET /api/events/:id` — one event
- `POST /api/events/:id/interest` — `{ "action": "going" | "interested" }` (in-memory counter)

Discord timestamps like `<t:1776765840:R>` in names/descriptions are rendered as readable dates.

## Env

See [.env.example](.env.example). Never commit a real `.env` — it's in `.gitignore`.

| Var | Required | Default |
|---|---|---|
| `PORT` | no | `3000` |
| `GUILD_ID` | yes (else mock) | — |
| `DISCORD_BOT_TOKEN` | yes (else mock) | — |
| `CACHE_TTL_MS` | no | `60000` |

Bot needs access to the guild's Scheduled Events.

## Screenshots

Events API:

![api](https://github.com/user-attachments/assets/297872ee-e4b4-4a0e-bfde-8a4b45572ee8)


## License

Apache-2.0, see [LICENSE](LICENSE).
