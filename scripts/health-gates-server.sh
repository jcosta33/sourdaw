#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

if ! npm --prefix server ls --depth=0 --silent --include=dev >/dev/null 2>&1; then
    printf '%s\n' \
        'error: collaboration server dependencies are not installed' \
        'run: npm --prefix server ci --include=dev' >&2
    exit 1
fi

cd server
npm run build
