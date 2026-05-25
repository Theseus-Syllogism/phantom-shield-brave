#!/usr/bin/env sh
# Lightweight tests for scripts/install.sh.
# Does not actually install mitmproxy; runs --help / --check / shellcheck only.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/install.sh"
fail=0

t() { printf '... %s ... ' "$1"; }
# assert <name> <cmd...>: runs cmd, prints OK/FAIL. Uses if/then so a failing
# cmd under set -e doesn't abort the harness.
assert() {
  name="$1"; shift
  t "$name"
  if "$@" >/dev/null 2>&1; then echo OK; else echo FAIL; fail=1; fi
}

assert 'install.sh exists and is executable' test -x "$SCRIPT"
assert 'install.sh --help exits 0' "$SCRIPT" --help

t 'install.sh --bogus exits 2'
# set -e is active; capture the expected non-zero exit without aborting.
rc=0; "$SCRIPT" --bogus 2>/dev/null || rc=$?
if [ "$rc" -eq 2 ]; then echo OK; else echo FAIL; fail=1; fi

assert 'uninstall.sh exists and is executable' test -x "$ROOT/scripts/uninstall.sh"

if command -v shellcheck >/dev/null 2>&1; then
  assert 'shellcheck install.sh' shellcheck "$SCRIPT"
  assert 'shellcheck uninstall.sh' shellcheck "$ROOT/scripts/uninstall.sh"
else
  echo '(shellcheck not installed; skipping lint checks)'
fi

exit $fail
