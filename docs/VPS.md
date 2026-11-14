# Deploying S.M.I.P on a VPS

Two supported paths: Docker (recommended) or systemd + nginx. Both assume Node 22.
Storage is Supabase over HTTPS, so the container and the host hold **no database
state**: no volume to mount, no file to back up, nothing to lose on redeploy.
Database setup lives in [`SUPABASE.md`](SUPABASE.md).

---

## 0. Before anything else: the checklist that matters

| Check | Why | How |
|---|---|---|
| `API_AUTH_TOKEN` set | Without it, anyone on the internet can create trackers and spend your AI credit. `POST/PUT/PATCH/DELETE` and the dashboard itself stay public otherwise. | `openssl rand -hex 32` |
| `AI_API_KEY` set | Without it there is no sentiment analysis, no forecast, and no search-grounded channels. The dashboard will be honestly empty. | Sakelar console |
| `.env` not in git | It holds keys. `.gitignore` already covers it. | `git check-ignore -v .env` |
| Keys only in `.env` | The app reads every secret from `process.env`. There is no settings screen and no key field: any `POST/PUT/PATCH` to `/api/*` carrying a secret-named field is rejected with `400 credentials-not-accepted`. Edit `.env` on the server, then restart. | `grep -n "credentials-not-accepted" src/server/credentials.ts` |
| Port not exposed publicly | The app speaks plain HTTP. nginx/Caddy terminates TLS. | bind `127.0.0.1:3000` |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set | Without them nothing is stored; the API serves empty data and `/api/health` says `not-configured`. | `curl -s localhost:3000/api/health` |
| `supabase/schema.sql` applied | Connected but missing tables reports `schema-missing`; writes fail. | run it once in the SQL editor |
| `SEARCH_LANGUAGE` matches your market | Search results are filtered to the last week; `en` covers English conversation, `id` also switches Google News to the Indonesian edition. | `SEARCH_LANGUAGE=id` |
| Optional collector keys | Eleven channels collect with no key at all. These only deepen them: `REDDIT_CLIENT_ID`+`SECRET` (reliable Reddit), `YOUTUBE_API_KEY` (view counts), `TWITTER_BEARER_TOKEN` (X), `TWITCH_CLIENT_ID`+`SECRET`. All free, all in `.env`. | see `.env.example` |
| `supabase/schema.sql` re-applied after upgrading | The file is idempotent and its tail adds the columns newer versions write (`engagement_score`, `query_variant`, `trackers.accounts`). Skipping it leaves writes silently narrowed. | run it again in the SQL editor |
| `SEARCH_PROVIDER` set | Without it, the channels with no public read API (TikTok, Instagram, Facebook, ...) collect nothing, however many AI tokens you have. `searxng` costs nothing and needs no key. | `SEARCH_PROVIDER=searxng`, then `docker compose up -d searxng` |
| `TRUST_PROXY=1` | Behind a proxy, rate limiting must key on the real client IP, not the proxy's. | already the default |

---

## 1. Docker path

```bash
git clone https://github.com/JohnIsDimz/Social-Media-Intelligence-Platform.git
cd Social-Media-Intelligence-Platform
cp .env.example .env
$EDITOR .env                 # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_API_KEY, API_AUTH_TOKEN
docker compose up -d --build
docker compose logs -f --tail=50
```

Verify:

```bash
curl -s localhost:3000/api/health | jq
# dashboard: open http://<host>/ and sign in with API_AUTH_TOKEN once
# scripts:   curl -H "Authorization: Bearer $TOKEN" -X POST ...
# expect: status ok, ai.enabled true, collectors.grounding true
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/nope   # 404, JSON
```

The image runs as the unprivileged `node` user, has a healthcheck wired to
`/api/health`, and caps its own log files at 3×10 MB.

## 2. systemd path (no Docker)

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin smip
sudo mkdir -p /opt/smip && sudo chown smip:smip /opt/smip
sudo -u smip git clone https://github.com/JohnIsDimz/Social-Media-Intelligence-Platform.git /opt/smip
cd /opt/smip
sudo -u smip npm ci && sudo -u smip npm run build
sudo -u smip cp .env.example .env && sudo -u smip $EDITOR .env
sudo cp deploy/smip.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now smip
journalctl -u smip -f
```

The unit runs with `ProtectSystem=strict`, `NoNewPrivileges`, a private `/tmp`,
and write access limited to `src/data`.

## 3. TLS reverse proxy

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/smip
sudo sed -i 's/smip.example.com/your.domain/g' /etc/nginx/sites-available/smip
sudo ln -s /etc/nginx/sites-available/smip /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain
```

The proxy passes `X-Forwarded-For`, and `/ws` is upgraded for the live feed.

## 4. What to watch after the first day

| Signal | Meaning | Action |
|---|---|---|
| `GET /api/channel-health` returns `503` | A network is down **and** the host has internet | Open the response; the failing channels are named with their error |
| `down` on every channel while `egress:false` | The VPS itself has no outbound access | Open the firewall / check DNS |
| `summary.needsKey` > 0 | Channels that need a credential | Add `YOUTUBE_API_KEY`, `TWITTER_BEARER_TOKEN`, `GITHUB_TOKEN` |
| `ai.enabled: false` | No AI key loaded | Check `.env`, restart, re-read `/api/health` |
| `429` in logs | AI gateway rate limit; a 2-minute cooldown starts automatically | Nothing, unless it repeats |
| `/api/health` returns `503` with `database.reason` | `unreachable` (network/URL) or `schema-missing` (tables absent) | fix the env or run `supabase/schema.sql` |
| Disk growth | Not on this host: rows live in Supabase, histories are trimmed to 1000 mentions / 200 analyses | monitor *Database size* in the Supabase dashboard |

Backups are Supabase's job now (dashboard → Database → Backups, or `pg_dump`
against the connection string). There is no local file to copy.

## 5. Reverse proxy + SPA routing

`/api/*` unknown routes return JSON 404 and never fall through to the SPA. Any
other path returns `index.html` with `Cache-Control: no-cache`, while hashed
`/assets/*` are immutable for a year. Nothing extra is needed from the proxy.

## 6. Known limits on a single VPS

- **The collector runs in-process.** One background loop refreshes the stalest
  tracker every `INGEST_INTERVAL_MS` (default 120 s). Two instances on the same
  volume would duplicate work; run one.
- **Supabase is a network hop.** Every read is an HTTPS round trip, so latency
  is the distance to the Supabase region. Pick the region closest to the VPS.
  The dashboard loads three bounded queries per view, not the whole table.
- **In-memory rate limits** reset on restart and are per-process. With more than
  one instance you would need a shared store.
- **No automatic retention.** Mentions are trimmed to 1000 rows; analysed posts
  are not trimmed.
