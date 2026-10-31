#!/usr/bin/env bash
# One-time setup on the Ubuntu server that already runs Wealth Tracker behind Caddy:
#   ssh ubuntu@SERVER 'bash -s' < deploy/install.sh
# Then put the env file at /etc/mydiet.env; data lives in /var/lib/mydiet/mydiet.db (SQLite).
set -euo pipefail
# SSH URL: the repo is private; the server reads it with a read-only deploy key (see README).
REPO="${REPO:-git@github.com:halilayyildiz/mydiet.git}"
BRANCH="${BRANCH:-main}"

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl xz-utils >/dev/null

# Official Node.js LTS (the distro build leaves out TypeScript type stripping, which the server relies on).
# Wealth Tracker's install.sh puts the same Node in /usr/local; this step is skipped when it is already there.
NODE_MAJOR="${NODE_MAJOR:-24}"
if ! /usr/local/bin/node -e "process.exit(+process.versions.node.split('.')[0] >= $NODE_MAJOR ? 0 : 1)" 2>/dev/null; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "unsupported arch"; exit 1 ;; esac
  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  TARBALL=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -o "node-v[0-9.]*-linux-$ARCH.tar.xz" | head -1)
  TMP=$(mktemp -d)
  curl -fsSL "$BASE/$TARBALL" -o "$TMP/$TARBALL"
  (cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $TARBALL\$" | sha256sum -c --quiet)
  sudo tar -xJf "$TMP/$TARBALL" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
  rm -rf "$TMP"
fi
export PATH=/usr/local/bin:$PATH

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
sudo -u mydiet -H npm ci --no-audit --no-fund
sudo -u mydiet -H npm run build
sudo -u mydiet -H mkdir -p uploads

sudo install -m 644 deploy/mydiet.service /etc/systemd/system/
sudo systemctl daemon-reload

# Serve the site from the same Caddy as Wealth Tracker (Caddy routes by domain name).
grep -q mydiet.halilayyildiz.com /etc/caddy/Caddyfile || { echo; cat deploy/Caddyfile; } | sudo tee -a /etc/caddy/Caddyfile >/dev/null
# The Wealth block takes its domain from the env var Caddy gets from systemd.
sudo env $(sed -n "s/^Environment=//p" /etc/systemd/system/caddy.service.d/*.conf) caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

echo "Installed. Next: /etc/mydiet.env (mode 640, group mydiet),"
echo "then: sudo systemctl enable --now mydiet && sudo systemctl reload caddy"
