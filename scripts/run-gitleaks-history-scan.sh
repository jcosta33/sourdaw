#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    printf 'usage: %s <git-repository-path>\n' "$0" >&2
    exit 2
fi

: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"
: "${GITLEAKS_VERSION:?GITLEAKS_VERSION must be set}"
: "${GITLEAKS_SHA256:?GITLEAKS_SHA256 must be set}"

scan_target=$1
gitleaks_archive="$RUNNER_TEMP/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
gitleaks_dir="$RUNNER_TEMP/gitleaks-${GITLEAKS_VERSION}"
gitleaks_url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"

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
    --no-banner \
    --no-color \
    --redact=100 \
    --verbose \
    --exit-code="${GITLEAKS_EXIT_CODE:-1}" \
    --log-opts=--all \
    "$scan_target"
