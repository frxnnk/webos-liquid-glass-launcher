#!/bin/sh
# Starts the Auto watcher (auto-sync.js) when its switch is on. Safe to call at any time: it exits
# quietly when Auto is off, when the watcher already runs, or when anything it needs is missing.
set -u
umask 077
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

DIR=$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd) || exit 0
NODE=/usr/bin/node
WATCH=$DIR/auto-sync.js
PIDFILE=/tmp/mipantalla-auto.pid
LOGFILE=/tmp/mipantalla-auto.log
CONFIG=/var/lib/mipantalla-maintenance/auto-sync/config.json

[ -x "$NODE" ] || exit 0
[ -r "$WATCH" ] || exit 0
grep -q '"enabled":true' "$CONFIG" 2>/dev/null || exit 0

if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || true)
  case "$OLD" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$OLD" -gt 1 ] && [ -r "/proc/$OLD/cmdline" ] &&
         tr '\000' '\n' < "/proc/$OLD/cmdline" 2>/dev/null | grep -Fx "$WATCH" >/dev/null 2>&1; then
        exit 0
      fi
      ;;
  esac
  rm -f "$PIDFILE"
fi

export NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs
if command -v nohup >/dev/null 2>&1; then
  nohup "$NODE" "$WATCH" --watch >>"$LOGFILE" 2>&1 &
else
  "$NODE" "$WATCH" --watch >>"$LOGFILE" 2>&1 &
fi
exit 0
