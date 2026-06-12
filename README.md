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

## Deployment sketch

On the GCP VM:

```bash
sudo mkdir -p /opt/mydiet
sudo chown "$USER":"$USER" /opt/mydiet
git clone <repo-url> /opt/mydiet/app
cd /opt/mydiet/app
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

For a quick local UI-only run without Firestore credentials, set `USE_MEMORY_REPOSITORY=true`.

Then install `deploy/systemd/mydiet.service` and `deploy/nginx.conf`, update paths/domains if needed,
and reload systemd/nginx.
