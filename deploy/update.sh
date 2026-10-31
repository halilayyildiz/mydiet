#!/usr/bin/env bash
# Pull the latest code from GitHub, reinstall and restart. Run on the server: /opt/mydiet/deploy/update.sh
set -euo pipefail
cd /opt/mydiet
# Pull first, then run the freshly pulled copy of this script, so changes to the deploy steps apply right away.
if [ -z "${MYDIET_PULLED:-}" ]; then
  sudo -u mydiet -H git pull --ff-only
  MYDIET_PULLED=1 exec /opt/mydiet/deploy/update.sh
fi
sudo -u mydiet -H .venv/bin/pip install -q -e .
sudo install -m 644 deploy/mydiet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart mydiet
sleep 3
systemctl is-active --quiet mydiet && echo "Updated to $(sudo -u mydiet git log -1 --format='%h %s')" || { sudo journalctl -u mydiet -n 30 --no-pager; exit 1; }
