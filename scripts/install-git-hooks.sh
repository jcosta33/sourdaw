#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
checkout_root=$(CDPATH= cd "$script_dir/.." && pwd)

if ! worktree_state=$(git -C "$checkout_root" rev-parse --is-inside-work-tree 2>/dev/null); then
    if [ -e "$checkout_root/.git" ]; then
        printf '%s\n' "error: invalid Git checkout at $checkout_root" >&2
        exit 1
    fi

    printf '%s\n' 'Skipping Git hook installation: not inside a Git checkout'
    exit 0
fi

if [ "$worktree_state" != 'true' ]; then
    printf '%s\n' 'error: install-git-hooks.sh requires a non-bare Git checkout' >&2
    exit 1
fi

if ! repo_root=$(git -C "$checkout_root" rev-parse --show-toplevel 2>/dev/null); then
    printf '%s\n' "error: unable to resolve Git checkout at $checkout_root" >&2
    exit 1
fi

hooks_path="$repo_root/.githooks"
if [ ! -x "$hooks_path/pre-push" ]; then
    printf '%s\n' "error: expected executable hook at $hooks_path/pre-push" >&2
    exit 1
fi

git -C "$repo_root" config --local core.hooksPath .githooks
if worktree_config=$(git -C "$repo_root" config --local --type=bool --get extensions.worktreeConfig 2>/dev/null); then
    if [ "$worktree_config" = 'true' ]; then
        git -C "$repo_root" config --worktree core.hooksPath .githooks
    fi
fi
printf '%s\n' 'Configured Git hooks path: .githooks'
