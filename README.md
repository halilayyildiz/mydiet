# MyDiet

Personal diet tracker for `mydiet.halilayyildiz.com`.

The app is a small Flask service that keeps its data in a local SQLite file. Daily free-text food/activity notes
and optional images are sent to Claude, which estimates:

- calories eaten
- active calories burned
- total daily calories burned
- calorie deficit
- rough macros, confidence, summary, and assumptions

## Local setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
mydiet
```

Open `http://localhost:8080`.

## Environment

```bash
APP_ENV=staging
APP_PASSWORD_HASH=generate-a-password-hash
FLASK_SECRET_KEY=replace-with-a-random-secret
ANTHROPIC_API_KEY=your-anthropic-key
SINGLE_USER_ID=halil
USE_MEMORY_REPOSITORY=false
MYDIET_DB=data/mydiet.db
```

Generate `APP_PASSWORD_HASH` with:

```bash
.venv/bin/python -c "from werkzeug.security import generate_password_hash; import getpass; print(generate_password_hash(getpass.getpass()))"
```

`APP_PASSWORD` is still supported for quick local testing, but `APP_PASSWORD_HASH` is better for the VM.

## Claude connector

`/mcp/<MCP_TOKEN>` is a small MCP server (tools `save_day`, `get_day`, `list_days`, `log_weight`) so the
claude.ai chat where meals are discussed can save each day with the calories it already worked out;
MyDiet only sums them up (no second analysis). Set `MCP_TOKEN` to a long random string and add
`https://mydiet.halilayyildiz.com/mcp/<MCP_TOKEN>` in claude.ai → Settings → Connectors → Add custom connector.
The secret path is the only credential, so keep the URL private.

## Storage

SQLite at `MYDIET_DB` (default `data/mydiet.db`): tables `profiles`, `daily_entries` and `weight_logs`,
each row a JSON document keyed by user and `YYYY-MM-DD`.

## Deployment

Runs on the same Ubuntu server as Wealth Tracker: gunicorn on `127.0.0.1:8080` as the `mydiet`
systemd service with its SQLite database at `/var/lib/mydiet/mydiet.db`, behind the server's existing Caddy, which routes `mydiet.halilayyildiz.com` here and
handles HTTPS.

```bash
# once, from your machine. The repo is private: the first run prints a read-only deploy key to add in
# GitHub → Settings → Deploy keys; then run it again.
ssh ubuntu@SERVER 'bash -s' < deploy/install.sh
sudo install -m 640 -g mydiet .env /etc/mydiet.env
sudo systemctl enable --now mydiet && sudo systemctl reload caddy

# later updates
/opt/mydiet/deploy/update.sh
```

Point the `mydiet` DNS A record at the server; Caddy gets the certificate on the first request.

For a throwaway in-memory run, set `USE_MEMORY_REPOSITORY=true`.
