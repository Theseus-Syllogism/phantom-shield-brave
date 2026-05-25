#!/usr/bin/env sh
# Phantom Shield bridge uninstaller. Reverses install.sh.
set -eu

REMOVE_CA=0
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --remove-ca) REMOVE_CA=1 ;;
    --purge)     PURGE=1 ;;
    -h|--help)
      cat <<USAGE
Usage: uninstall.sh [--remove-ca] [--purge]

By default: stops the service, removes the service unit, leaves the install
dir + CA in place so a re-install is fast.

  --remove-ca  Also remove the mitmproxy CA from the OS trust store.
  --purge      Also delete the whole phantom-shield data dir: the bridge venv,
               and the Phantom Browser launcher's isolated profile + CA store.
USAGE
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=macos ;;
  *)      echo "unsupported OS" >&2; exit 1 ;;
esac

data_dir() {
  # Parent dir holding the bridge venv AND the Phantom Browser launcher's
  # isolated home (profile + per-instance NSS) + logs. --purge removes all of it.
  case "$OS" in
    linux) printf '%s\n' "$HOME/.local/share/phantom-shield" ;;
    macos) printf '%s\n' "$HOME/Library/Application Support/phantom-shield" ;;
  esac
}

stop_service() {
  case "$OS" in
    linux)
      systemctl --user disable --now phantom-shield-bridge.service 2>/dev/null || true
      rm -f "$HOME/.config/systemd/user/phantom-shield-bridge.service"
      systemctl --user daemon-reload
      ;;
    macos)
      launchctl bootout "gui/$(id -u)/com.phantom-shield.bridge" 2>/dev/null || true
      rm -f "$HOME/Library/LaunchAgents/com.phantom-shield.bridge.plist"
      ;;
  esac
}

remove_ca() {
  case "$OS" in
    linux)
      if [ -f /usr/local/share/ca-certificates/phantom-shield.crt ]; then
        sudo rm -f /usr/local/share/ca-certificates/phantom-shield.crt
        sudo update-ca-certificates --fresh
      fi
      if [ -f /etc/pki/ca-trust/source/anchors/phantom-shield.pem ]; then
        sudo rm -f /etc/pki/ca-trust/source/anchors/phantom-shield.pem
        sudo update-ca-trust
      fi
      # Remove from the per-user NSS db (Brave/Chromium) too.
      if command -v certutil >/dev/null 2>&1 && [ -f "$HOME/.pki/nssdb/cert9.db" ]; then
        certutil -d "sql:$HOME/.pki/nssdb" -D -n phantom-shield 2>/dev/null || true
      fi
      ;;
    macos)
      sudo security delete-certificate -c "mitmproxy" /Library/Keychains/System.keychain 2>/dev/null || true
      ;;
  esac
}

stop_service
[ "$REMOVE_CA" -eq 1 ] && remove_ca
[ "$PURGE" -eq 1 ] && rm -rf "$(data_dir)"

echo
echo "Uninstall complete. Open the Phantom Shield extension options and"
echo "click 'Clear' in the setup card to revert Brave's proxy setting."
