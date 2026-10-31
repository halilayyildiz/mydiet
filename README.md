# MyDiet

Personal diet tracker for `mydiet.halilayyildiz.com`.

Same stack as Wealth Tracker: a Fastify server in TypeScript (run directly by Node, no build step) with
`node:sqlite`, and a React 19 + Vite web app with Recharts. Daily free-text food/activity notes from the web form
are sent to Claude, which estimates:

- calories eaten
- active calories burned
- total daily calories burned
- calorie deficit
- rough macros, confidence, summary, and assumptions

## Local setup

Needs Node 22.18+ (Node 24 on the server).

```bash
npm install
cp .env.example .env   # fill it in, then load it: set -a; . ./.env; set +a
npm run dev            # API on :8080 and Vite on :5173 (proxies /api, /mcp, /demo, /uploads)
npm test
npm run typecheck
```

Production: `npm run build` (writes `dist/`), then `npm start`, which serves the API and `dist/` on `API_PORT`
(default 8080). Restart the server after each build: it lists the built files when it starts.

## Environment

```bash
APP_ENV=staging
APP_PASSWORD_HASH=generate-a-password-hash
FLASK_SECRET_KEY=the-old-flask-secret
ANTHROPIC_API_KEY=your-anthropic-key
SINGLE_USER_ID=halil
MCP_TOKEN=a-long-random-string
MYDIET_DB=data/mydiet.db
MYDIET_DEMO_DB=data/demo.db
```

Generate `APP_PASSWORD_HASH` with `npm run hash-password`. Older Werkzeug hashes (`scrypt:…`, `pbkdf2:…`)
still work, and `APP_PASSWORD` is still supported for quick local testing.

Logins last a year and slide forward while you use the app (`sessions` table in the database).
`FLASK_SECRET_KEY` is only needed so logins from the old Flask version keep working: such a cookie is
checked once and swapped for a new session.

## Claude connector

`/mcp/<MCP_TOKEN>` is a small MCP server (tools `save_day`, `get_day`, `list_days`, `log_weight`, `list_weights`) so the
claude.ai chat where meals are discussed can save each day with the calories it already worked out;
MyDiet only sums them up (no second analysis). Set `MCP_TOKEN` to a long random string and add
`https://mydiet.halilayyildiz.com/mcp/<MCP_TOKEN>` in claude.ai → Settings → Connectors → Add custom connector.
The secret path is the only credential, so keep the URL private.

## Apple Health weight

`POST /api/<MCP_TOKEN>/weight` with JSON `{"weight_kg": 82.4, "date": "2026-10-24"}` logs a weigh-in
(same day again replaces it; `date` defaults to today and may be a full ISO 8601 timestamp). A daily iPhone
Shortcut automation reads the latest Weight sample from Health and posts it here, so a smart scale that
syncs to Apple Health ends up in MyDiet with no extra service.

## Demo

`/demo` opens a read-only demo with made-up data: 90 days of someone going from 101 kg to 92 kg, with a few
overeating days. It runs in the same process but uses its own database (`MYDIET_DEMO_DB`, default `data/demo.db`),
rebuilt whenever its newest day is no longer today. Nothing a demo visitor does is saved, and the Claude connector
never touches it. `/demo/exit` (or the link in the demo banner) leaves it.

## Storage

SQLite at `MYDIET_DB` (default `data/mydiet.db`): tables `profiles`, `daily_entries` and `weight_logs`,
each row a JSON document keyed by user and `YYYY-MM-DD`, plus `sessions` for logins (only token hashes).

## Maintenance

Backfill old daily entries after changing the profile-based basal burn formula:

```bash
npm run backfill-bmr -- --user halil
npm run backfill-bmr -- --user halil --apply
```

The first command is a dry run and does not write to the database.

## Deployment

Runs on the same Ubuntu server as Wealth Tracker: Node (`/usr/local/bin/node server/index.ts`) on
`127.0.0.1:8080` as the `mydiet` systemd service with its SQLite database at `/var/lib/mydiet/mydiet.db`, behind the server's existing Caddy, which routes `mydiet.halilayyildiz.com` here and
handles HTTPS.

```bash
# once, from your machine (the repo is public, so the server clones it over HTTPS)
ssh ubuntu@SERVER 'REPO=https://github.com/halilayyildiz/mydiet.git bash -s' < deploy/install.sh
sudo install -m 640 -g mydiet .env /etc/mydiet.env
sudo systemctl enable --now mydiet && sudo systemctl reload caddy

# later updates (pulls, runs npm ci and the build, restarts, then checks /api/health)
/opt/mydiet/deploy/update.sh
```

The first Node deploy kept a copy of the Flask-era database at `/var/lib/mydiet/mydiet.db.pre-node`.

### Automatic deploys

`.github/workflows/deploy.yml` runs `update.sh` on the server on every push to `main` (and by hand from the
Actions tab). It uses a dedicated SSH key that the server only accepts for that one command. Set up once:

```bash
# on your machine
ssh-keygen -t ed25519 -N "" -C "github-deploy mydiet" -f ~/.ssh/mydiet_deploy
echo "command=\"/opt/mydiet/deploy/update.sh\",restrict $(cat ~/.ssh/mydiet_deploy.pub)" \
  | ssh ubuntu@SERVER 'cat >> ~/.ssh/authorized_keys'
ssh-keyscan -t ed25519 SERVER   # output goes into DEPLOY_KNOWN_HOSTS
```

Repository secrets (GitHub → Settings → Secrets and variables → Actions): `DEPLOY_SSH_KEY` (contents of
`~/.ssh/mydiet_deploy`), `DEPLOY_KNOWN_HOSTS` (the `ssh-keyscan` line) and `DEPLOY_HOST` (`ubuntu@SERVER`).

Point the `mydiet` DNS A record at the server; Caddy gets the certificate on the first request.

