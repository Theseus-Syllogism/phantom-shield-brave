#!/usr/bin/env sh
# Phantom Browser launcher (Linux). Starts the user's installed Brave as an
# isolated Phantom Shield instance: own profile, own proxy, own CA trust, with
# a session-scoped mitmproxy bridge that is torn down on exit.
set -eu

PRINT_CMD=0
PORT=""
BRAVE_OVERRIDE=""

usage() {
  cat <<USAGE
Usage: phantom-browser.sh [options]

  --print-cmd     Print the Brave command line and exit (no bridge, no browser).
  --port <N>      Force the bridge/proxy port (default: first free of 8118-8120).
  --brave <path>  Path to the Brave binary (default: autodetect; or set BRAVE_BIN).
  --help          This help.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --print-cmd) PRINT_CMD=1 ;;
    --port) shift; PORT="${1:?--port requires a value}" ;;
    --brave) shift; BRAVE_OVERRIDE="${1:?--brave requires a value}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ -n "$PORT" ]; then
  case "$PORT" in ''|*[!0-9]*) echo "--port must be numeric (got: $PORT)" >&2; exit 2 ;; esac
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/.local/share/phantom-shield"
INSTALL_DIR="$DATA_DIR/bridge"
PHANTOM_HOME="$DATA_DIR/home"
PROFILE_DIR="$PHANTOM_HOME/profile"
LOG_DIR="$PHANTOM_HOME/logs"
NSSDB="$PHANTOM_HOME/.pki/nssdb"
PIDFILE="$PHANTOM_HOME/bridge.pid"
LOCKFILE="$PHANTOM_HOME/phantom.lock"
MITM_CA_PEM="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
EXT_DIR="$REPO_ROOT"

# Chromium refuses to run as root without --no-sandbox. Detect root and pass it
# (with a warning before launch) so the launcher works in root-only setups;
# non-root users keep the sandbox.
SANDBOX_FLAG=""
[ "$(id -u)" -eq 0 ] && SANDBOX_FLAG="--no-sandbox"

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

find_brave() {
  if [ -n "$BRAVE_OVERRIDE" ]; then printf '%s\n' "$BRAVE_OVERRIDE"; return 0; fi
  if [ -n "${BRAVE_BIN:-}" ]; then printf '%s\n' "$BRAVE_BIN"; return 0; fi
  for c in brave brave-browser brave-browser-stable; do
    p="$(command -v "$c" 2>/dev/null || true)"
    [ -n "$p" ] && { printf '%s\n' "$p"; return 0; }
  done
  for p in /usr/bin/brave-browser /usr/bin/brave /snap/bin/brave \
           /var/lib/flatpak/exports/bin/com.brave.Browser; do
    [ -x "$p" ] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}

port_free() {
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1$"; then return 1; fi
    return 0
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then return 1; fi
    return 0
  else
    return 0
  fi
}

pick_port() {
  for p in 8118 8119 8120; do
    if port_free "$p"; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}

resolve_port() {
  if [ -n "$PORT" ]; then printf '%s\n' "$PORT"; else pick_port; fi
}

build_brave_cmd() {
  # $1 = brave path, $2 = port. Prints the launch line for inspection/tests only.
  # NOT shell-safe to copy-paste: unquoted, so paths containing spaces would
  # split. The real launch in main() invokes Brave directly with quoted args.
  printf 'HOME=%s %s --user-data-dir=%s --load-extension=%s --proxy-server=127.0.0.1:%s --proxy-bypass-list=127.0.0.1,localhost,<local> --no-default-browser-check --no-first-run%s\n' \
    "$PHANTOM_HOME" "$1" "$PROFILE_DIR" "$EXT_DIR" "$2" "${SANDBOX_FLAG:+ $SANDBOX_FLAG}"
}

ensure_provisioned() {
  if [ -x "$INSTALL_DIR/venv/bin/mitmdump" ] && [ -f "$INSTALL_DIR/addon.py" ] \
     && [ -f "$MITM_CA_PEM" ]; then
    return 0
  fi
  log "First run: provisioning the bridge (one-time, may take a minute)..."
  "$REPO_ROOT/scripts/install.sh" --no-service --no-ca
}

ensure_ca_isolated() {
  command -v certutil >/dev/null 2>&1 || die "certutil (libnss3-tools) required; install it and retry"
  mkdir -p "$NSSDB"
  [ -f "$NSSDB/cert9.db" ] || certutil -d "sql:$NSSDB" -N --empty-password >/dev/null 2>&1 || true
  if certutil -d "sql:$NSSDB" -L 2>/dev/null | grep -q '^phantom-shield '; then
    return 0
  fi
  log "Trusting the bridge CA inside the isolated Phantom store only..."
  certutil -d "sql:$NSSDB" -A -t "C,," -n phantom-shield -i "$MITM_CA_PEM"
}

BRIDGE_PID=""
cleanup() {
  # Re-entrant by design: a single EXIT INT TERM handler may fire more than once
  # (e.g. INT then EXIT). kill/wait/rm are all guarded so repeat calls on an
  # already-reaped pid or missing files are harmless no-ops.
  if [ -n "$BRIDGE_PID" ]; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi
  rm -f "$PIDFILE" "$LOCKFILE"
}

acquire_lock() {
  if [ -f "$LOCKFILE" ]; then
    oldpid="$(cat "$LOCKFILE" 2>/dev/null || true)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      die "Phantom is already running (pid $oldpid)"
    fi
  fi
  mkdir -p "$PHANTOM_HOME"
  echo "$$" > "$LOCKFILE"
}

bridge_answers() {
  out="$(curl -sS --max-time 2 -D - -o /dev/null \
    --proxy "http://127.0.0.1:$1" --insecure \
    https://phantom-shield-bridge.test/probe 2>/dev/null || true)"
  printf '%s' "$out" | tr -d '\r' | grep -qi '^X-Phantom-Bridge-Version:'
}

start_bridge() {
  port="$1"
  mkdir -p "$LOG_DIR"
  "$INSTALL_DIR/venv/bin/mitmdump" -s "$INSTALL_DIR/addon.py" \
    --listen-host 127.0.0.1 --listen-port "$port" \
    --set connection_strategy=lazy >"$LOG_DIR/bridge.log" 2>&1 &
  BRIDGE_PID=$!
  echo "$BRIDGE_PID" > "$PIDFILE"
  i=0
  while [ "$i" -lt 20 ]; do
    if bridge_answers "$port"; then return 0; fi
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      tail -n 20 "$LOG_DIR/bridge.log" >&2
      die "bridge process exited during startup"
    fi
    i=$((i + 1)); sleep 0.5
  done
  tail -n 20 "$LOG_DIR/bridge.log" >&2
  die "bridge did not become reachable on port $port"
}

main() {
  brave="$(find_brave || true)"
  [ -n "$brave" ] || die "Brave not found. Install it (https://brave.com/download) or pass --brave <path>."

  if [ "$PRINT_CMD" -eq 1 ]; then
    p="$(resolve_port)" || die "no free port in 8118-8120"
    build_brave_cmd "$brave" "$p"
    exit 0
  fi

  ensure_provisioned
  ensure_ca_isolated
  acquire_lock
  trap cleanup EXIT INT TERM
  p="$(resolve_port)" || die "no free port in 8118-8120"
  start_bridge "$p"
  [ -n "$SANDBOX_FLAG" ] && log "warning: running Brave as root with --no-sandbox (reduced isolation); a non-root user is recommended."
  log "Phantom ready on 127.0.0.1:$p - launching Brave..."
  # || true: a Brave crash or non-zero exit must not skip teardown - the EXIT
  # trap runs cleanup regardless. A desktop launcher doesn't surface Brave's
  # own exit code.
  # SC2086: $SANDBOX_FLAG is intentionally unquoted - it's a single optional
  # flag that must vanish entirely (not become an empty arg) when non-root.
  # shellcheck disable=SC2086
  HOME="$PHANTOM_HOME" "$brave" \
    --user-data-dir="$PROFILE_DIR" \
    --load-extension="$EXT_DIR" \
    --proxy-server="127.0.0.1:$p" \
    --proxy-bypass-list="127.0.0.1,localhost,<local>" \
    --no-default-browser-check --no-first-run $SANDBOX_FLAG || true
}

main
