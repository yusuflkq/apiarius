#!/usr/bin/env bash
# Runs the mod's engine tests one file at a time and prints a summary.
#
#   scripts/test.sh                          every tests/*.test.ts and *.test.tsx
#   scripts/test.sh web.test.ts deck.test.ts those files alone
#   CLAUDE=/path/to/claude scripts/test.sh   with another Claude Code binary
#
# `claude plugin test .` runs every test file at once, and on a busy machine
# a test can outrun the 5 s of wall time the kit gives it. So while one file
# runs, the others wait in a temporary folder; they go back when the script
# ends, an interrupt included. CI runs this same script.
#
# Needs bash: macOS, Linux, or Git Bash on Windows. Exits 1 when a test
# fails, 2 when it could not run the tests at all.
set -u
shopt -s nullglob

cd "$(dirname "$0")/.." || exit 2
claude=${CLAUDE:-claude}
if ! command -v "$claude" >/dev/null 2>&1; then
  echo "scripts/test.sh: no Claude Code at '$claude'; install it, or set CLAUDE to its path" >&2
  exit 2
fi

all=(tests/*.test.ts tests/*.test.tsx)
if [ ${#all[@]} -eq 0 ]; then
  echo "scripts/test.sh: no test files under tests/" >&2
  exit 2
fi
wanted=()
if [ $# -eq 0 ]; then
  for file in "${all[@]}"; do wanted+=("$(basename "$file")"); done
else
  for name in "$@"; do
    name=$(basename "$name")
    if [ ! -f "tests/$name" ]; then
      echo "scripts/test.sh: no tests/$name" >&2
      exit 2
    fi
    wanted+=("$name")
  done
fi

held=$(mktemp -d "${TMPDIR:-/tmp}/apiarius-tests.XXXXXX") || exit 2
# every test file back where it was, however the script ends
restore() {
  for file in "$held"/*.test.ts "$held"/*.test.tsx; do mv -f "$file" tests/; done
  rm -rf "$held"
}
trap restore EXIT
trap 'exit 130' INT TERM
mv "${all[@]}" "$held"/ || exit 2

# GitHub Actions folds each file's output; elsewhere only a failing file's shows
is_ci=${GITHUB_ACTIONS:-}
passed=0
failed=()
summary=()
started=$SECONDS
for name in "${wanted[@]}"; do
  cp "$held/$name" tests/
  log="$held/$name.log"
  if [ -n "$is_ci" ]; then echo "::group::$name"; fi
  "$claude" plugin test . >"$log" 2>&1
  code=$?
  rm -f "tests/$name"
  counts=$(grep -E '^ *[0-9]+ (pass|fail)$' "$log" | tr -s ' \n' ' ' | sed 's/^ //; s/ $//')
  if [ -n "$is_ci" ]; then
    cat "$log"
    echo "::endgroup::"
  fi
  if [ $code -eq 0 ]; then
    passed=$((passed + 1))
    summary+=("pass  $name  ${counts:-}")
  else
    if [ -z "$is_ci" ]; then cat "$log"; fi
    failed+=("$name")
    summary+=("FAIL  $name  ${counts:-exit $code}")
  fi
  echo "${summary[${#summary[@]} - 1]}"
done

echo
echo "${#wanted[@]} files in $((SECONDS - started)) s: $passed passed, ${#failed[@]} failed"
if [ ${#failed[@]} -ne 0 ]; then
  if [ -n "$is_ci" ]; then echo "::error::Failing test files: ${failed[*]}"; fi
  echo "Failing: ${failed[*]}"
  exit 1
fi
