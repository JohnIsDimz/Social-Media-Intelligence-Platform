# Deploying S.M.I.P on a VPS

Two supported paths: Docker (recommended) or systemd + nginx. Both assume Node 22
because the database uses the built-in `node:sqlite` module — there are no native
compiled dependencies left, which is what used to break fresh installs.

---

## 0. Before anything else: the checklist that matters

| Check | Why | How |
|---|---|---|
| `API_AUTH_TOKEN` set | Without it, anyone on the internet can create trackers and spend your AI credit. `POST/PUT/PATCH/DELETE` stay public otherwise. | `openssl rand -hex 32` |
| `AI_API_KEY` set | Without it there is no sentiment analysis, no forecast, and no search-grounded channels. The dashboard will be honestly empty. | Sakelar console |
| `.env` not in git | It holds keys. `.gitignore` already covers it. | `git check-ignore -v .env` |
| Port not exposed publicly | The app speaks plain HTTP. nginx/Caddy terminates TLS. | bind `127.0.0.1:3000` |
| Volume on `src/data` | The SQLite file is the only store. Lose it and you lose collected mentions. | compose volume / `ReadWritePaths` |
| `TRUST_PROXY=1` | Behind a proxy, rate limiting must key on the real client IP, not the proxy's. | already the default |

---

## 1. Docker path

```bash
git clone https://github.com/JohnIsDimz/Social-Media-Intelligence-Platform.git
cd Social-Media-Intelligence-Platform
cp .env.example .env
$EDITOR .env                 # AI_API_KEY, API_AUTH_TOKEN, APP_URL, CORS_ORIGINS
docker compose up -d --build
docker compose logs -f --tail=50
```

Verify:

```bash
curl -s localhost:3000/api/health | jq
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
| Disk growth in `src/data` | Collected mentions (capped at 1000 rows server-side) | Back up the `.sqlite` file nightly |

Backup, one line in cron:

```bash
0 3 * * * sqlite3 /var/lib/docker/volumes/smip_smip-data/_data/database.sqlite ".backup /backup/smip-$(date +\%F).sqlite"
```

## 5. Reverse proxy + SPA routing

`/api/*` unknown routes return JSON 404 and never fall through to the SPA. Any
other path returns `index.html` with `Cache-Control: no-cache`, while hashed
`/assets/*` are immutable for a year. Nothing extra is needed from the proxy.

## 6. Known limits on a single VPS

- **The collector runs in-process.** One background loop refreshes the stalest
  tracker every `INGEST_INTERVAL_MS` (default 120 s). Two instances on the same
  volume would duplicate work; run one.
- **SQLite, not Postgres.** Fine for this workload (≤1000 mentions, single
  writer). `writeDB()` still rewrites tables on each save (audit item B2) — it is
  a performance ceiling, not a correctness bug, and it is next on the list.
- **In-memory rate limits** reset on restart and are per-process. With more than
  one instance you would need a shared store.
- **No automatic retention.** Mentions are trimmed to 1000 rows; analysed posts
  are not trimmed.
