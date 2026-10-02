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

Empty list (web):

![empty](https://github.com/user-attachments/assets/5c88d815-d213-4eb1-a40d-b30b4c77c036)

Events list (web):

![events](https://github.com/user-attachments/assets/62941dd8-1256-4265-b9bd-d9986e64a8f5)
![events](https://github.com/user-attachments/assets/d91dfe7e-1389-4b9c-a51a-43fa48e54a4c)
![events](https://github.com/user-attachments/assets/c122140f-171e-4f8f-974b-376938e7afbf)

Events API:

![api](https://github.com/user-attachments/assets/a907d02e-6b25-4a6f-9f88-9ab0a7b82e14)

## License

Apache-2.0, see [LICENSE](LICENSE).
