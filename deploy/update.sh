#!/usr/bin/env bash
# Pull the latest code from GitHub, rebuild and restart. Run on the server: /opt/mydiet/deploy/update.sh
set -euo pipefail
cd /opt/mydiet
# Pull first, then run the freshly pulled copy of this script, so changes to the deploy steps apply right away.
if [ -z "${MYDIET_PULLED:-}" ]; then
  sudo -u mydiet -H git pull --ff-only
  MYDIET_PULLED=1 exec /opt/mydiet/deploy/update.sh
fi
# The server runs TypeScript directly, which needs Node 22.18+ (the official build in /usr/local/bin, as for Wealth Tracker).
/usr/local/bin/node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)" ||
  { echo "Node 22.18+ is needed at /usr/local/bin/node"; exit 1; }
sudo -u mydiet -H npm ci --no-audit --no-fund
sudo -u mydiet -H npm run build
sudo -u mydiet -H mkdir -p uploads
# One copy of the database from before the move to Node, taken while the app is stopped.
if [ ! -f /var/lib/mydiet/mydiet.db.pre-node ] && [ -f /var/lib/mydiet/mydiet.db ]; then
  sudo systemctl stop mydiet
  for f in mydiet.db mydiet.db-wal mydiet.db-shm; do
    [ -f "/var/lib/mydiet/$f" ] && sudo -u mydiet cp -p "/var/lib/mydiet/$f" "/var/lib/mydiet/${f/mydiet.db/mydiet.db.pre-node}"
  done
fi
sudo install -m 644 deploy/mydiet.service deploy/mydiet-backup.service deploy/mydiet-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
# Nightly backup (deploy/backup.sh). The Google Drive copy uses the rclone remote set up once for Wealth Tracker
# (its README → Off-server backups): copied here the first time it exists, so there is nothing to set up per app.
command -v rclone >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone >/dev/null
RCLONE_SRC=/var/lib/wealth-tracker/.config/rclone/rclone.conf
if ! sudo test -f /var/lib/mydiet/.config/rclone/rclone.conf && sudo test -f "$RCLONE_SRC"; then
  sudo install -d -o mydiet -g mydiet -m 700 /var/lib/mydiet/.config /var/lib/mydiet/.config/rclone
  sudo install -o mydiet -g mydiet -m 600 "$RCLONE_SRC" /var/lib/mydiet/.config/rclone/rclone.conf
fi
sudo systemctl enable --now mydiet-backup.timer >/dev/null
sudo systemctl restart mydiet
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -o /dev/null http://127.0.0.1:8080/api/health && break
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:8080/api/health && echo "Updated to $(sudo -u mydiet git log -1 --format='%h %s')" || { sudo journalctl -u mydiet -n 30 --no-pager; exit 1; }
