#!/bin/sh
set -eu

if ! repo_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    printf '%s\n' 'error: install-git-hooks.sh must run inside a Git checkout' >&2
    exit 1
fi

hooks_path="$repo_root/.githooks"
if [ ! -x "$hooks_path/pre-push" ]; then
    printf '%s\n' "error: expected executable hook at $hooks_path/pre-push" >&2
    exit 1
fi

if git config --local --get extensions.worktreeConfig >/dev/null 2>&1; then
    git config --worktree core.hooksPath "$hooks_path"
else
    git config --local core.hooksPath "$hooks_path"
fi
printf '%s\n' "Configured Git hooks path: $hooks_path"
