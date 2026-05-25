#!/usr/bin/env sh
# Tests for scripts/phantom-browser.sh. Uses --print-cmd + a stub Brave so no
# real browser is launched for the construction tests.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
L="$ROOT/scripts/phantom-browser.sh"
fail=0

t() { printf '... %s ... ' "$1"; }
assert_contains() {
  t "$1"
  case "$2" in
    *"$3"*) echo OK ;;
    *) echo "FAIL (missing: $3)"; fail=1 ;;
  esac
}

# --- command construction --------------------------------------------------
OUT="$("$L" --print-cmd --port 8118 --brave /usr/bin/true)"
assert_contains 'print-cmd: user-data-dir'  "$OUT" '--user-data-dir='
assert_contains 'print-cmd: load-extension' "$OUT" "--load-extension=$ROOT"
assert_contains 'print-cmd: proxy 8118'     "$OUT" '--proxy-server=127.0.0.1:8118'
assert_contains 'print-cmd: isolated HOME'  "$OUT" 'HOME='
assert_contains 'print-cmd: bypass list'    "$OUT" '--proxy-bypass-list=127.0.0.1,localhost,<local>'

# --- port rollover (ambient-independent) -----------------------------------
# Occupy whatever port the launcher currently picks, then assert it rolls to a
# higher one. Skipped cleanly when there's no headroom (P1 is already the top
# candidate, 8120) or when python3 isn't available, so external port pressure
# can't cause a spurious failure.
extract_port() { printf '%s\n' "$1" | grep -o 'proxy-server=127.0.0.1:[0-9]*' | grep -o '[0-9]*$'; }
P1="$(extract_port "$("$L" --print-cmd --brave /usr/bin/true)")"
if ! command -v python3 >/dev/null 2>&1; then
  echo '... port rollover ... SKIP (python3 unavailable)'
elif [ -z "$P1" ] || [ "$P1" -ge 8120 ]; then
  echo "... port rollover ... SKIP (no headroom above $P1)"
else
  python3 -c "import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',$P1));s.listen(1);time.sleep(8)" &
  DUMMY=$!
  trap 'kill $DUMMY 2>/dev/null || true' EXIT
  sleep 1
  P2="$(extract_port "$("$L" --print-cmd --brave /usr/bin/true)")"
  kill $DUMMY 2>/dev/null || true; wait $DUMMY 2>/dev/null || true
  trap - EXIT
  t 'port rollover picks a different higher port'
  if [ -n "$P2" ] && [ "$P2" -gt "$P1" ]; then echo OK; else echo "FAIL (P1=$P1 P2=$P2)"; fail=1; fi
fi

# --- E2E: no-orphan + isolated-NSS (requires a provisioned bridge) ----------
INSTALL_DIR="$HOME/.local/share/phantom-shield/bridge"
PHANTOM_HOME="$HOME/.local/share/phantom-shield/home"
if [ -x "$INSTALL_DIR/venv/bin/mitmdump" ] && command -v certutil >/dev/null 2>&1; then
  # Stub Brave: a script that exits immediately.
  STUB="$(mktemp)"; printf '#!/bin/sh\nexit 0\n' > "$STUB"; chmod +x "$STUB"
  "$L" --brave "$STUB" >/tmp/phantom-e2e.log 2>&1 || true
  rm -f "$STUB"
  PORT_USED="$(grep -o 'on 127.0.0.1:[0-9]*' /tmp/phantom-e2e.log | grep -o '[0-9]*$' || true)"

  t 'no orphaned mitmdump after browser exit'
  if [ -z "$PORT_USED" ]; then
    # Couldn't determine the bridge port -> the bridge likely never started or
    # the log line changed. Fail loudly so a real orphan regression can't pass.
    echo "FAIL (could not determine bridge port from log)"; fail=1
  elif ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PORT_USED$"; then
    echo "FAIL (mitmdump still on $PORT_USED)"; fail=1
  else
    echo OK
  fi

  assert_contains 'CA present in isolated nssdb' \
    "$(certutil -d "sql:$PHANTOM_HOME/.pki/nssdb" -L 2>/dev/null || true)" 'phantom-shield'

  # Single-instance: hold the lock with a live pid, expect refusal.
  t 'second instance refused while lock held'
  mkdir -p "$PHANTOM_HOME"; sleep 30 & HOLD=$!; echo "$HOLD" > "$PHANTOM_HOME/phantom.lock"
  trap 'kill $HOLD 2>/dev/null || true' EXIT   # don't leak the holder if we abort
  if "$L" --brave /usr/bin/true >/tmp/phantom-lock.log 2>&1; then
    echo "FAIL (second instance was allowed)"; fail=1
  else
    if grep -qi 'already running' /tmp/phantom-lock.log; then echo OK; else echo "FAIL (wrong error)"; fail=1; fi
  fi
  kill $HOLD 2>/dev/null || true; rm -f "$PHANTOM_HOME/phantom.lock"
  trap - EXIT
else
  echo '(bridge not provisioned or certutil missing; skipping E2E tests)'
fi

exit $fail
