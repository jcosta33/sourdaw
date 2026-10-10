#!/usr/bin/env bash
set -euo pipefail

cache_hit="${1:?expected exact cache-hit output}"
toolchain_file="${2:-rust-toolchain.toml}"
case "$cache_hit" in
  true) source_name=exact-cache ;;
  false) source_name=distribution ;;
  *) printf 'invalid Rust toolchain cache-hit value: %s\n' "$cache_hit" >&2; exit 1 ;;
esac

metadata=$(python3 - "$toolchain_file" <<'PY'
import sys
import tomllib
import re

with open(sys.argv[1], 'rb') as file:
    toolchain = tomllib.load(file)['toolchain']
channel = toolchain['channel']
if not isinstance(channel, str) or not re.fullmatch(r'nightly-\d{4}-\d{2}-\d{2}', channel):
    raise ValueError('rust-toolchain.toml needs a date-pinned nightly channel')
profile = toolchain['profile']
if not isinstance(profile, str) or profile not in ('minimal', 'default', 'complete'):
    raise ValueError('rust-toolchain.toml needs a rustup profile')
print(channel, profile, sep='\t')
PY
)
IFS=$'\t' read -r pin profile <<< "$metadata"
components=$(python3 - "$toolchain_file" <<'PY'
import sys
import tomllib

with open(sys.argv[1], 'rb') as file:
    toolchain = tomllib.load(file)['toolchain']
components = toolchain['components']
if not isinstance(components, list) or not components or not all(isinstance(item, str) for item in components):
    raise ValueError('rust-toolchain.toml needs named components')
print('\n'.join(components))
PY
)

# Only a cache miss may ask rustup to install the TOML-declared toolchain.
if [ "$cache_hit" = false ]; then
  component_flags=()
  while IFS= read -r component; do
    component_flags+=(--component "$component")
  done <<< "$components"
  rustup toolchain install "$pin" --profile "$profile" "${component_flags[@]}"
fi

export RUSTUP_AUTO_INSTALL=0
active=$(rustup show active-toolchain)
active=${active%% *}
case "$active" in
  "$pin"-*) ;;
  *) printf 'restored Rust toolchain does not match pinned channel %s: %s\n' "$pin" "$active" >&2; exit 1 ;;
esac

compiler=$(rustup run "$active" rustc -vV)
host=$(printf '%s\n' "$compiler" | sed -n 's/^host: //p')
if [ -z "$host" ] || [ "$active" != "$pin-$host" ]; then
  printf 'pinned Rust compiler host does not match installed toolchain: %s\n' "$active" >&2
  exit 1
fi

installed=$(rustup component list --installed --toolchain "$active")
printf '%s\n' "$installed" | grep -Fx "rustc-$host" >/dev/null
printf '%s\n' "$installed" | grep -Fx "cargo-$host" >/dev/null
while IFS= read -r component; do
  printf '%s\n' "$installed" | grep -Fx "$component-$host" >/dev/null || {
    printf 'pinned Rust toolchain missing component: %s\n' "$component" >&2
    exit 1
  }
done <<< "$components"

rustup run "$active" cargo --version
rustup run "$active" rustfmt --version
rustup run "$active" cargo-clippy --version
printf 'pinned-rust-toolchain: source=%s toolchain=%s components=%s\n' "$source_name" "$active" "${components//$'\n'/,}"
if [ -n "${GITHUB_ENV:-}" ]; then
  printf 'RUSTUP_AUTO_INSTALL=0\n' >> "$GITHUB_ENV"
fi
