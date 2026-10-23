# MyDiet

Personal diet tracker for `mydiet.halilayyildiz.com`.

The app is a small Flask service backed by Firestore. Daily free-text food/activity notes
and optional images are sent to Gemini, which estimates:

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
GEMINI_API_KEY=your-gemini-key
SINGLE_USER_ID=halil
USE_MEMORY_REPOSITORY=false
GOOGLE_APPLICATION_CREDENTIALS=/opt/mydiet/service-account.json
```

Generate `APP_PASSWORD_HASH` with:

```bash
.venv/bin/python -c "from werkzeug.security import generate_password_hash; import getpass; print(generate_password_hash(getpass.getpass()))"
```

`APP_PASSWORD` is still supported for quick local testing, but `APP_PASSWORD_HASH` is better for the VM.

Firestore project/database values live in `config/app_settings.json`, matching the pattern used by
`bayidipfiyat`.

## Firestore layout

```text
users/{user_id}/profile/current
users/{user_id}/daily_entries/{YYYY-MM-DD}
users/{user_id}/weight_logs/{YYYY-MM-DD}
```

## Deployment

Runs on the same Ubuntu server as Wealth Tracker: gunicorn on `127.0.0.1:8080` as the `mydiet`
systemd service, behind the server's existing Caddy, which routes `mydiet.halilayyildiz.com` here and
handles HTTPS.

```bash
# once, from your machine. The repo is private: the first run prints a read-only deploy key to add in
# GitHub → Settings → Deploy keys; then run it again.
ssh ubuntu@SERVER 'bash -s' < deploy/install.sh
# env file (GOOGLE_APPLICATION_CREDENTIALS=/var/lib/mydiet/service-account.json) and Firestore key:
sudo install -m 640 -g mydiet .env /etc/mydiet.env
sudo install -m 640 -o mydiet -g mydiet service-account.json /var/lib/mydiet/service-account.json
sudo systemctl enable --now mydiet && sudo systemctl reload caddy

# later updates
/opt/mydiet/deploy/update.sh
```

Point the `mydiet` DNS A record at the server; Caddy gets the certificate on the first request.

For a quick local UI-only run without Firestore credentials, set `USE_MEMORY_REPOSITORY=true`.
