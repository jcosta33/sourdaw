#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    printf 'usage: %s <git-repository-path>\n' "$0" >&2
    exit 2
fi

: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"
: "${GITLEAKS_VERSION:?GITLEAKS_VERSION must be set}"
: "${GITLEAKS_SHA256:?GITLEAKS_SHA256 must be set}"

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
trusted_root=$(CDPATH= cd "$script_dir/.." && pwd)
scan_target=$1
gitleaks_config="$trusted_root/.gitleaks.toml"
gitleaks_archive="$RUNNER_TEMP/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
gitleaks_dir="$RUNNER_TEMP/gitleaks-${GITLEAKS_VERSION}"
gitleaks_url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"

if [ ! -f "$gitleaks_config" ]; then
    printf 'trusted Gitleaks config not found: %s\n' "$gitleaks_config" >&2
    exit 2
fi

umask 077
mkdir -p "$RUNNER_TEMP"

curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "$gitleaks_archive" \
    "$gitleaks_url"
printf '%s  %s\n' "$GITLEAKS_SHA256" "$gitleaks_archive" | sha256sum --check --status
printf 'Gitleaks binary verified: %s\n' "$GITLEAKS_SHA256"

mkdir -p "$gitleaks_dir"
tar -xzf "$gitleaks_archive" -C "$gitleaks_dir" gitleaks

"$gitleaks_dir/gitleaks" git \
    --config "$gitleaks_config" \
    --no-banner \
    --no-color \
    --redact=100 \
    --verbose \
    --exit-code="${GITLEAKS_EXIT_CODE:-1}" \
    --log-opts=--all \
    "$scan_target"
