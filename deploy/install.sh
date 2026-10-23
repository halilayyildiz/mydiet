#!/usr/bin/env bash
# One-time setup on the Ubuntu server that already runs Wealth Tracker behind Caddy:
#   ssh ubuntu@SERVER 'bash -s' < deploy/install.sh
# Then put the env file at /etc/mydiet.env and the Firestore key at /var/lib/mydiet/service-account.json.
set -euo pipefail
# SSH URL: the repo is private; the server reads it with a read-only deploy key (see README).
REPO="${REPO:-git@github.com:halilayyildiz/mydiet.git}"
BRANCH="${BRANCH:-main}"

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3-venv >/dev/null

# App user, code and data directories.
id mydiet >/dev/null 2>&1 || sudo useradd --system --home /var/lib/mydiet --shell /usr/sbin/nologin mydiet
sudo install -d -o mydiet -g mydiet -m 750 /var/lib/mydiet
sudo install -d -o mydiet -g mydiet -m 755 /opt/mydiet
# Read-only deploy key for the private GitHub repo.
KEY=/var/lib/mydiet/.ssh/id_ed25519
if [ ! -f "$KEY" ]; then
  sudo -u mydiet -H mkdir -p -m 700 /var/lib/mydiet/.ssh
  sudo -u mydiet -H ssh-keygen -q -t ed25519 -N "" -C "mydiet deploy (read-only)" -f "$KEY"
  sudo -u mydiet -H sh -c "ssh-keyscan -t ed25519 github.com 2>/dev/null >> /var/lib/mydiet/.ssh/known_hosts"
fi
if [ ! -d /opt/mydiet/.git ] && ! sudo -u mydiet -H git clone -q -b "$BRANCH" "$REPO" /opt/mydiet; then
  echo
  echo "Can't read $REPO. Add this key in GitHub → repo Settings → Deploy keys (leave write access off), then run install.sh again:"
  sudo cat "$KEY.pub"
  exit 1
fi
cd /opt/mydiet
sudo -u mydiet -H python3 -m venv .venv
sudo -u mydiet -H .venv/bin/pip install -q -e .
sudo -u mydiet -H mkdir -p uploads

sudo install -m 644 deploy/mydiet.service /etc/systemd/system/
sudo systemctl daemon-reload

# Serve the site from the same Caddy as Wealth Tracker (Caddy routes by domain name).
grep -q mydiet.halilayyildiz.com /etc/caddy/Caddyfile || { echo; cat deploy/Caddyfile; } | sudo tee -a /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

echo "Installed. Next: /etc/mydiet.env (mode 640, group mydiet) and /var/lib/mydiet/service-account.json,"
echo "then: sudo systemctl enable --now mydiet && sudo systemctl reload caddy"
