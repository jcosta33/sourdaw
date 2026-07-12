#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

pnpm deps:validate
pnpm typecheck
pnpm lint --quiet
pnpm test:run --reporter=dot --silent=passed-only
pnpm build
