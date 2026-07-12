#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/sourdaw-git-hooks.XXXXXX")
temp_root=$(CDPATH= cd "$temp_root" && pwd -P)
seed_repo="$temp_root/seed"
installer_worktree="$temp_root/installer-worktree"
remaining_worktree="$temp_root/remaining-worktree"
hook_log="$temp_root/hook.log"

cleanup() {
    rm -rf "$temp_root"
}
trap cleanup 0
trap 'exit 1' 1 2 15

git init --quiet "$seed_repo"
git -C "$seed_repo" config user.email hooks-test@example.com
git -C "$seed_repo" config user.name 'Hooks Test'
mkdir -p "$seed_repo/.githooks" "$seed_repo/scripts"
cp "$repo_root/scripts/install-git-hooks.sh" "$seed_repo/scripts/install-git-hooks.sh"
printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'git rev-parse --show-toplevel >> "$HOOK_LOG"' \
    > "$seed_repo/.githooks/pre-push"
chmod +x "$seed_repo/.githooks/pre-push" "$seed_repo/scripts/install-git-hooks.sh"
git -C "$seed_repo" add .githooks/pre-push scripts/install-git-hooks.sh
git -C "$seed_repo" commit --quiet -m 'Add hook fixture'
git -C "$seed_repo" branch installer
git -C "$seed_repo" branch remaining
git -C "$seed_repo" config extensions.worktreeConfig true
git -C "$seed_repo" worktree add --quiet "$installer_worktree" installer
git -C "$seed_repo" worktree add --quiet "$remaining_worktree" remaining

git -C "$seed_repo" config core.hooksPath "$installer_worktree/.githooks"
git -C "$installer_worktree" config --worktree core.hooksPath "$installer_worktree/.githooks"
git -C "$remaining_worktree" config --worktree core.hooksPath "$installer_worktree/.githooks"

sh "$installer_worktree/scripts/install-git-hooks.sh"
sh "$remaining_worktree/scripts/install-git-hooks.sh"

shared_path=$(git -C "$seed_repo" config --local --get core.hooksPath)
installer_path=$(git -C "$installer_worktree" config --get core.hooksPath)
remaining_path=$(git -C "$remaining_worktree" config --get core.hooksPath)
test "$shared_path" = '.githooks'
test "$installer_path" = '.githooks'
test "$remaining_path" = '.githooks'

: > "$hook_log"
HOOK_LOG="$hook_log" git -C "$installer_worktree" hook run pre-push
HOOK_LOG="$hook_log" git -C "$remaining_worktree" hook run pre-push
installer_hook_root=$(sed -n '1p' "$hook_log")
remaining_hook_root=$(sed -n '2p' "$hook_log")
test "$installer_hook_root" = "$installer_worktree"
test "$remaining_hook_root" = "$remaining_worktree"

git -C "$seed_repo" worktree remove "$installer_worktree"
: > "$hook_log"
HOOK_LOG="$hook_log" git -C "$remaining_worktree" hook run pre-push
remaining_root_after_removal=$(sed -n '1p' "$hook_log")
test "$remaining_root_after_removal" = "$remaining_worktree"

printf '%s\n' \
    "shared core.hooksPath: $shared_path" \
    "installer worktree core.hooksPath: $installer_path" \
    "remaining worktree core.hooksPath: $remaining_path" \
    "resolved installer hook root: $installer_hook_root" \
    "resolved remaining hook root: $remaining_hook_root" \
    "remaining hook root after installer removal: $remaining_root_after_removal" \
    'two-worktree hook isolation: PASS'
