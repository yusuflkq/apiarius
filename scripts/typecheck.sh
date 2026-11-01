#!/usr/bin/env bash
# Type-checks the mod with tsc, against the types Claude Code writes for its
# own version, as CI does.
#
#   scripts/typecheck.sh                    tsc on the types in .claude-plugin/types
#   scripts/typecheck.sh --fresh            write those types again first
#   CLAUDE=/path/to/claude scripts/typecheck.sh --fresh
#
# Claude Code writes the types (.claude-plugin/types, not committed) when it
# loads the mod in an interactive session. With --fresh, or when there are
# none yet, this starts one in a pseudo-terminal for a few seconds: signed
# out, in a scratch config folder with the first-run screens answered, with
# no prompt typed. It stops the session once the types are there.
#
# Needs bash, `script` (macOS or Linux) and npx. Exits 1 when tsc finds an
# error, 2 when it could not check at all.
set -u

cd "$(dirname "$0")/.." || exit 2
claude=${CLAUDE:-claude}
types=.claude-plugin/types
made=(claude-code/index.d.ts claude-code-tools/index.d.ts claude-code-mcp/index.d.ts tsconfig.json)

has_types() {
  for file in "${made[@]}"; do [ -f "$types/$file" ] || return 1; done
}

if [ "${1:-}" = "--fresh" ] || ! has_types; then
  if ! command -v "$claude" >/dev/null 2>&1; then
    echo "scripts/typecheck.sh: no Claude Code at '$claude'; install it, or set CLAUDE to its path" >&2
    exit 2
  fi
  claude=$(command -v "$claude")
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/apiarius-types.XXXXXX") || exit 2
  printf '{"hasCompletedOnboarding":true,"projects":{"%s":{"hasTrustDialogAccepted":true}}}\n' "$PWD" >"$scratch/.claude.json"
  rm -rf "$types"
  # a clean environment, so the session loads this folder alone (no CLAUDE_CODE_PLUGIN_DIRS of yours)
  run=(env -i "HOME=$scratch" "PATH=$PATH" TERM=xterm-256color "CLAUDE_CONFIG_DIR=$scratch" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL=1)
  # its own process group, so it all stops together; stdin held open, or the session reads its end and quits
  set -m
  if script --version >/dev/null 2>&1; then
    sleep 120 | "${run[@]}" script -q -e -c "'$claude' --plugin-dir ." /dev/null >/dev/null 2>&1 &
  else
    sleep 120 | "${run[@]}" script -q /dev/null "$claude" --plugin-dir . >/dev/null 2>&1 &
  fi
  session=$!
  group=$(jobs -p %%)
  set +m
  for _ in $(seq 60); do
    has_types && break
    sleep 1
  done
  # a second more, so the last file is whole; then the session (in script's terminal), script and the sleep,
  # and the scratch folder once the session has finished writing its last files there
  sleep 1
  inner=$(pgrep -P "$session")
  pkill -P "$session" >/dev/null 2>&1
  kill -- "-$group" >/dev/null 2>&1
  wait "$session" 2>/dev/null
  for pid in $inner; do
    for _ in $(seq 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
  done
  rm -rf "$scratch"
  if ! has_types; then
    echo "scripts/typecheck.sh: Claude Code wrote no types in 60 s" >&2
    exit 2
  fi
fi

npx --yes --package typescript@5.6.3 tsc -p . || exit 1
echo "tsc found no errors"
