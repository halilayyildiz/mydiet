#!/usr/bin/env bash
# Pull the latest code from GitHub, reinstall and restart. Run on the server: /opt/mydiet/deploy/update.sh
set -euo pipefail
cd /opt/mydiet
sudo -u mydiet -H git pull --ff-only
sudo -u mydiet -H .venv/bin/pip install -q -e .
sudo install -m 644 deploy/mydiet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart mydiet
sleep 3
systemctl is-active --quiet mydiet && echo "Updated to $(sudo -u mydiet git log -1 --format='%h %s')" || { sudo journalctl -u mydiet -n 30 --no-pager; exit 1; }
