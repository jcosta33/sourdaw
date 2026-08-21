#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

pnpm wasm:verify
pnpm deps:validate
pnpm typecheck
pnpm typecheck:test
pnpm typecheck:scripts
pnpm census:ui -- --check
pnpm typecheck:e2e
pnpm lint:full
pnpm test:command-schema
pnpm test:release-inventory
pnpm test:collection-scope
pnpm test:barrel-mocks
pnpm test:run
pnpm build
