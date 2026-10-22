#!/bin/sh
set -u
umask 077
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

SELF=$0
while [ -L "$SELF" ]; do
  TARGET=$(readlink "$SELF") || break
  case "$TARGET" in
    /*) SELF=$TARGET ;;
    *) SELF=$(dirname "$SELF")/$TARGET ;;
  esac
done
DIR=$(cd "$(dirname "$SELF")" >/dev/null 2>&1 && pwd) || exit 0

NODE=/usr/bin/node
WATCH=$DIR/home-watch.js
PIDFILE=/tmp/mipantalla-home.pid
LOGFILE=/tmp/mipantalla-home.log
POLL_MS=${MIPANTALLA_HOME_POLL_MS:-100}
set --
if [ "${MIPANTALLA_HOME_NATIVE:-0}" = 1 ] ||
   [ -f /var/lib/mipantalla-maintenance/native-home/enabled ]; then
  set -- --native-home
fi

case "$POLL_MS" in
  ''|*[!0-9]*) POLL_MS=100 ;;
esac
[ "$POLL_MS" -ge 16 ] 2>/dev/null || POLL_MS=100
[ "$POLL_MS" -le 1000 ] 2>/dev/null || POLL_MS=100

[ -x "$NODE" ] || exit 0
[ -r "$WATCH" ] || exit 0

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
  nohup "$NODE" "$WATCH" --boot --watch --poll-ms="$POLL_MS" "$@" >>"$LOGFILE" 2>&1 &
else
  "$NODE" "$WATCH" --boot --watch --poll-ms="$POLL_MS" "$@" >>"$LOGFILE" 2>&1 &
fi

# Auto mode (opt-in): its own script decides whether anything needs to start.
[ -r "$DIR/auto-autostart.sh" ] && /bin/sh "$DIR/auto-autostart.sh" >/dev/null 2>&1 || true
exit 0
