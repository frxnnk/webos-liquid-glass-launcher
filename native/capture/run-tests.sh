#!/bin/sh
set -eu
cd "$(dirname "$0")"
SOURCE=${1:-patched}
BUILD=$(mktemp -d /tmp/mipantalla-capture-test.XXXXXX)
trap 'rm -rf "$BUILD"' EXIT HUP INT TERM
case "${SANITIZE:-none}" in
  none) SAN="" ;;
  address) SAN="-fsanitize=address,undefined -fno-omit-frame-pointer" ;;
  thread) SAN="-fsanitize=thread -fno-omit-frame-pointer" ;;
  *) echo 'Unknown sanitizer mode' >&2; exit 2 ;;
esac
if [ "$SOURCE" = patched ]; then
  cp -R upstream "$BUILD/source"
  python3 prepare-source.py "$BUILD/source"
  SOURCE="$BUILD/source"
fi
cc -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -Wno-format -pthread $SAN \
  -Itests -I"$SOURCE/unicapture" -I"$SOURCE/src" \
  -Dpthread_cond_wait=test_cond_wait -Dpthread_cond_signal=test_cond_signal \
  -c "$SOURCE/unicapture/unicapture.c" -o "$BUILD/unicapture.o"
cc -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -pthread $SAN \
  -Itests -I"$SOURCE/unicapture" -I"$SOURCE/src" \
  tests/lifetime.c tests/support.c "$BUILD/unicapture.o" -ldl -o "$BUILD/lifetime"
"$BUILD/lifetime"
cc -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -Wno-format -pthread $SAN \
  -Itests -I"$SOURCE/unicapture" -I"$SOURCE/src" -Dpthread_join=test_join \
  -c "$SOURCE/unicapture/unicapture.c" -o "$BUILD/lifecycle.o"
cc -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -pthread $SAN \
  -Itests -I"$SOURCE/unicapture" -I"$SOURCE/src" \
  tests/lifecycle.c tests/support.c "$BUILD/lifecycle.o" -ldl -o "$BUILD/lifecycle"
for CASE in metrics callback-stop wait-stop restart invalid invalid-nv12 nv12 vsync-disabled self-stop; do
  "$BUILD/lifecycle" "$CASE"
done
