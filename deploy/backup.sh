#!/usr/bin/env bash
# Nightly backup of MyDiet: the SQLite database (a consistent copy, taken while the app runs) and the uploaded images.
# One .tar.gz a day in $DIR, keeping the newest $KEEP. Then the newest goes to Google Drive with rclone
# ($REMOTE, copies older than $KEEP_DAYS days are deleted there); skipped quietly while no remote is set up.
# Run by deploy/mydiet-backup.timer as the mydiet user. Restore: unpack it and put the files back with the app stopped.
set -euo pipefail
APP=mydiet
DATA="${BACKUP_DATA:-/var/lib/mydiet}"
DIR="${BACKUP_DIR:-$DATA/backups}"
KEEP="${BACKUP_KEEP:-30}"
REMOTE="${BACKUP_REMOTE:-gdrive:mydiet-backups}"
KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-90}"
# A consistent copy of a live SQLite database (VACUUM INTO works while the app keeps writing).
snapshot() {
  "${NODE:-/usr/local/bin/node}" --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dest] = process.argv.slice(1);
    new DatabaseSync(src).exec("VACUUM INTO \x27" + dest.replaceAll("\x27", "\x27\x27") + "\x27");
  ' "$1" "$2"
}

day=$(date -u +%F)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
out="$work/$APP-$day"
mkdir -p "$out" "$DIR"
snapshot "$DATA/mydiet.db" "$out/mydiet.db"
UPLOADS="${UPLOADS:-/opt/mydiet/uploads}"
if [ -d "$UPLOADS" ]; then cp -a "$UPLOADS" "$out/uploads"; fi
tar -C "$work" -czf "$DIR/.$APP-$day.tar.gz" "$APP-$day"
mv "$DIR/.$APP-$day.tar.gz" "$DIR/$APP-$day.tar.gz"
ls -1 "$DIR"/$APP-*.tar.gz | sort | head -n -"$KEEP" | xargs -r rm --
echo "Backup written to $DIR/$APP-$day.tar.gz"

if ! command -v rclone >/dev/null || ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"; then
  echo "No rclone remote '${REMOTE%%:*}' set up; skipping the off-server copy."
  exit 0
fi
rclone copyto "$DIR/$APP-$day.tar.gz" "$REMOTE/$APP-$day.tar.gz"
rclone delete "$REMOTE" --include "$APP-*.tar.gz" --min-age "${KEEP_DAYS}d"
echo "Copied to $REMOTE (keeping $KEEP_DAYS days there)."
