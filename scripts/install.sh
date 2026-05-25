#!/usr/bin/env sh
# Phantom Shield bridge installer for Linux + macOS.
# Idempotent: re-running on a working setup is a no-op.
set -eu

# --- Args ----------------------------------------------------------
CHECK_ONLY=0
PORT=8118
SKIP_CA=0
SKIP_SERVICE=0
VERBOSE=0

usage() {
  cat <<USAGE
Usage: install.sh [options]

Options:
  --check            Report state and exit (0=OK, 10=needs install, 11=service down,
                     12=CA not trusted, 13=port conflict). Makes no changes.
  --port <N>         Listen port for mitmproxy (default 8118).
  --no-ca            Skip CA trust-store installation.
  --no-service       Skip service registration (run mitmdump manually instead).
  --verbose          Print every step.
  --help             Show this help.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --port) shift; PORT="${1:?--port requires a value}" ;;
    --no-ca) SKIP_CA=1 ;;
    --no-service) SKIP_SERVICE=1 ;;
    --verbose) VERBOSE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# --- Validate ------------------------------------------------------
case "$PORT" in
  ''|*[!0-9]*) echo "--port must be a positive integer (got: $PORT)" >&2; exit 2 ;;
esac

# --- OS detection --------------------------------------------------
case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=macos ;;
  *)      echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

# --- Helpers -------------------------------------------------------
log()  { printf '%s\n' "$*"; }
# shellcheck disable=SC2015
vlog() { [ "$VERBOSE" -eq 1 ] && printf '  (verbose) %s\n' "$*" || true; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_python_version() {
  # Requires python3 with version >= "$1.$2"
  major="$(echo "$1" | cut -d. -f1)"
  minor="$(echo "$1" | cut -d. -f2)"
  python3 - "$major" "$minor" <<'PY' || die "python3 >= $1 is required"
import sys
mj, mn = (int(x) for x in sys.argv[1:3])
sys.exit(0 if sys.version_info >= (mj, mn) else 1)
PY
}

install_dir_for() {
  case "$1" in
    linux) printf '%s\n' "$HOME/.local/share/phantom-shield/bridge" ;;
    macos) printf '%s\n' "$HOME/Library/Application Support/phantom-shield/bridge" ;;
  esac
}

log_dir_for() {
  case "$1" in
    linux) printf '%s\n' "$HOME/.local/share/phantom-shield/logs" ;;
    macos) printf '%s\n' "$HOME/Library/Logs/phantom-shield" ;;
  esac
}

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$(install_dir_for "$OS")"
LOG_DIR="$(log_dir_for "$OS")"
MITM_CA_PEM="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
MITM_CA_CRT="$HOME/.mitmproxy/mitmproxy-ca-cert.cer"

# --- Preconditions -------------------------------------------------
require_cmd python3
require_python_version 3.10
require_cmd curl

# --- State reporters (used by --check) -----------------------------
state_install_dir_present() { [ -d "$INSTALL_DIR" ] && [ -x "$INSTALL_DIR/venv/bin/mitmdump" ]; }
state_addon_present()       { [ -f "$INSTALL_DIR/addon.py" ]; }
state_port_free() {
  # Returns 0 if PORT is free, 1 if taken.
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return 1
    fi
    return 0
  elif command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PORT$"; then
      return 1
    fi
    return 0
  else
    # Best effort: assume free.
    return 0
  fi
}

probe_bridge() {
  # 0 = bridge responded with X-Phantom-Bridge-Version, 1 = unreachable, 2 = no version header.
  out="$(curl --silent --max-time 3 -o /dev/null -D - \
    --proxy "http://127.0.0.1:$PORT" \
    --insecure https://phantom-shield-bridge.test/probe 2>/dev/null || true)"
  if [ -z "$out" ]; then return 1; fi
  echo "$out" | tr -d '\r' | grep -qi '^X-Phantom-Bridge-Version:' && return 0 || return 2
}

state_ca_trusted() {
  # Check for the marker file we drop during install. Grepping the PEM bundle
  # for "mitmproxy" doesn't work because subject names aren't plaintext there.
  case "$OS" in
    linux)
      [ -f /usr/local/share/ca-certificates/phantom-shield.crt ] \
        || [ -f /etc/pki/ca-trust/source/anchors/phantom-shield.pem ]
      ;;
    macos)
      security find-certificate -c "mitmproxy" /Library/Keychains/System.keychain >/dev/null 2>&1
      ;;
  esac
}

state_service_active() {
  case "$OS" in
    linux) systemctl --user is-active --quiet phantom-shield-bridge.service ;;
    macos) launchctl list 2>/dev/null | awk '{print $3}' | grep -q '^com.phantom-shield.bridge$' ;;
  esac
}

# --- --check exit codes per spec §7 --------------------------------
if [ "$CHECK_ONLY" -eq 1 ]; then
  state_install_dir_present || { log "needs install"; exit 10; }
  state_addon_present       || { log "needs install"; exit 10; }
  if ! state_service_active; then
    # Our service isn't running. If the port is free, it's simply down; if the
    # port is taken by something else, that's a conflict (a distinct failure).
    if state_port_free; then
      log "service down"; exit 11
    else
      log "port $PORT is in use by another process (not our service)"; exit 13
    fi
  fi
  state_ca_trusted          || { log "CA not trusted"; exit 12; }
  rc=0; probe_bridge || rc=$?
  case $rc in
    0) log "OK"; exit 0 ;;
    1) log "service down"; exit 11 ;;
    2) log "addon outdated (no X-Phantom-Bridge-Version header)"; exit 11 ;;
  esac
fi

# --- ensure_* steps (idempotent) -----------------------------------
ensure_install_dir() {
  if [ -d "$INSTALL_DIR" ]; then
    vlog "install dir already exists: $INSTALL_DIR"
  else
    log "creating install dir: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
  fi
  mkdir -p "$LOG_DIR"
}

ensure_venv_and_deps() {
  if [ -x "$INSTALL_DIR/venv/bin/mitmdump" ]; then
    vlog "venv already present"
    return 0
  fi
  log "creating venv at $INSTALL_DIR/venv"
  python3 -m venv "$INSTALL_DIR/venv"
  "$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
  "$INSTALL_DIR/venv/bin/pip" install --quiet -r "$REPO_ROOT/bridge/requirements.txt"
}

ensure_addon_py() {
  src="$REPO_ROOT/bridge/addon.py"
  dst="$INSTALL_DIR/addon.py"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    vlog "addon.py already up to date"
    return 0
  fi
  log "installing addon.py"
  cp "$src" "$dst"
}

ensure_ca_generated() {
  if [ -f "$MITM_CA_PEM" ]; then
    vlog "mitmproxy CA already generated"
    return 0
  fi
  log "generating mitmproxy CA (first-launch)"
  "$INSTALL_DIR/venv/bin/mitmdump" --listen-port "$PORT" --quiet >/dev/null 2>&1 &
  pid=$!
  # mitmproxy writes the CA on first start; wait briefly then stop it.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$MITM_CA_PEM" ] && break
    sleep 0.5
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  [ -f "$MITM_CA_PEM" ] || die "CA generation failed"
}

ensure_ca_trusted_linux() {
  # Two distinct trust stores matter on Linux:
  #   1. the system store (/etc/ssl/...) - used by curl, the smoke test, etc.
  #   2. the per-user NSS db (~/.pki/nssdb) - what Brave/Chromium ACTUALLY read.
  # update-ca-certificates only handles (1); the browser needs (2) as well.
  if state_ca_trusted; then
    vlog "CA already in system trust store"
  elif command -v apt-get >/dev/null 2>&1 || command -v update-ca-certificates >/dev/null 2>&1; then
    log "installing CA via update-ca-certificates (sudo required)"
    sudo cp "$MITM_CA_CRT" /usr/local/share/ca-certificates/phantom-shield.crt
    sudo update-ca-certificates
  elif command -v update-ca-trust >/dev/null 2>&1; then
    log "installing CA via update-ca-trust (sudo required)"
    sudo cp "$MITM_CA_PEM" /etc/pki/ca-trust/source/anchors/phantom-shield.pem
    sudo update-ca-trust
  else
    cat >&2 <<EOF
warn: this Linux distro is not recognized. To trust the CA manually:
  sudo cp $MITM_CA_CRT /usr/local/share/ca-certificates/phantom-shield.crt
  sudo update-ca-certificates
EOF
  fi
  # Always (re)ensure the browser's NSS store, regardless of the system-store
  # state above - this is the step that actually makes Brave trust the bridge.
  ensure_ca_trusted_nss
}

# Provide certutil (NSS tooling). Returns 0 if available afterwards.
ensure_certutil() {
  command -v certutil >/dev/null 2>&1 && return 0
  log "installing libnss3-tools (certutil) for browser CA trust (sudo required)"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y libnss3-tools >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nss-tools >/dev/null 2>&1 || true
  fi
  command -v certutil >/dev/null 2>&1
}

# Add the CA to the per-user NSS db that Chromium/Brave read on Linux.
ensure_ca_trusted_nss() {
  if ! ensure_certutil; then
    cat >&2 <<EOF
warn: certutil (libnss3-tools / nss-tools) is unavailable, so the CA could not
be added to Brave/Chromium's trust store. Install it, then re-run install.sh, or
add it manually:
  certutil -d sql:\$HOME/.pki/nssdb -A -t "C,," -n phantom-shield -i $MITM_CA_PEM
EOF
    return 0
  fi
  nssdb="$HOME/.pki/nssdb"
  mkdir -p "$nssdb"
  [ -f "$nssdb/cert9.db" ] || certutil -d "sql:$nssdb" -N --empty-password >/dev/null 2>&1 || true
  if certutil -d "sql:$nssdb" -L 2>/dev/null | grep -q '^phantom-shield'; then
    vlog "CA already in Brave/Chromium NSS db"
    return 0
  fi
  log "adding CA to Brave/Chromium NSS db ($nssdb)"
  certutil -d "sql:$nssdb" -A -t "C,," -n phantom-shield -i "$MITM_CA_PEM"
}

ensure_ca_trusted_macos() {
  if state_ca_trusted; then
    vlog "CA already trusted"
    return 0
  fi
  log "installing CA into System.keychain (sudo + Touch ID required)"
  sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain "$MITM_CA_PEM"
}

ensure_ca_trusted() {
  [ "$SKIP_CA" -eq 1 ] && { log "--no-ca: skipping CA install"; return 0; }
  case "$OS" in
    linux) ensure_ca_trusted_linux ;;
    macos) ensure_ca_trusted_macos ;;
  esac
}

render_template() {
  # Usage: render_template <src> <dst>; uses INSTALL_DIR / PORT / LOG_DIR as substitutions.
  src="$1"; dst="$2"
  sed \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|__PORT__|$PORT|g" \
    "$src" > "$dst"
}

ensure_service_linux() {
  unit_dir="$HOME/.config/systemd/user"
  unit_path="$unit_dir/phantom-shield-bridge.service"
  mkdir -p "$unit_dir"
  render_template "$REPO_ROOT/bridge/systemd/phantom-shield-bridge.service.template" "$unit_path"
  systemctl --user daemon-reload
  systemctl --user enable --now phantom-shield-bridge.service
  # Best-effort linger so the service survives logout.
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" 2>/dev/null || \
      log "note: run 'sudo loginctl enable-linger $USER' to keep the bridge running after logout"
  fi
}

ensure_service_macos() {
  plist_path="$HOME/Library/LaunchAgents/com.phantom-shield.bridge.plist"
  mkdir -p "$(dirname "$plist_path")"
  render_template "$REPO_ROOT/bridge/launchd/com.phantom-shield.bridge.plist.template" "$plist_path"
  # bootstrap is idempotent only via bootout-then-bootstrap; use kickstart to refresh after edit.
  launchctl bootstrap "gui/$(id -u)" "$plist_path" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/com.phantom-shield.bridge"
}

ensure_service() {
  [ "$SKIP_SERVICE" -eq 1 ] && { log "--no-service: skipping service registration"; return 0; }
  if state_service_active; then
    vlog "service already active"
    return 0
  fi
  case "$OS" in
    linux) ensure_service_linux ;;
    macos) ensure_service_macos ;;
  esac
}

verify_proxy_works() {
  log "smoke test: HEAD probe through the bridge"
  if probe_bridge; then
    log "smoke test passed."
    return 0
  fi
  cat >&2 <<EOF
warn: smoke test failed. The bridge is installed but the probe didn't succeed.
Check:
  - 'systemctl --user status phantom-shield-bridge.service' (Linux) or
    'launchctl list | grep phantom-shield.bridge' (macOS)
  - mitmproxy logs under $LOG_DIR/
EOF
  return 0  # don't fail install; user can re-verify from the extension
}

print_next_steps() {
  cat <<EOF

Done. Bridge installed at:
  $INSTALL_DIR
Listening on 127.0.0.1:$PORT

Next: open Brave, click the Phantom Shield extension's options page, and
click "Apply browser proxy" in the setup card. The dot at the top of
the page should turn green.
EOF
  if [ "$PORT" != "8118" ]; then
    cat <<EOF

WARNING: you installed on port $PORT, but the extension's "Apply browser proxy"
button currently assumes 8118. Per-port support in the extension is future work
(X-Phantom-Port). Until then, either reinstall on 8118 or set Brave's HTTPS
proxy to 127.0.0.1:$PORT manually instead of using the setup-card button.
EOF
  fi
}

# --- Run install steps ---
log "OS: $OS  install dir: $INSTALL_DIR  port: $PORT"
ensure_install_dir
ensure_venv_and_deps
ensure_addon_py
ensure_ca_generated
ensure_ca_trusted
ensure_service
verify_proxy_works
print_next_steps
