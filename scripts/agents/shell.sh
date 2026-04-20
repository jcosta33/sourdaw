#!/usr/bin/env bash
# scripts/agents/shell.sh — optional shell integration for the agents launcher
#
# Usage (from the repo root, or anywhere after sourcing):
#   source /path/to/repo/scripts/agents/shell.sh
#
# Or add to ~/.zshrc / ~/.bashrc:
#   source /path/to/repo/scripts/agents/shell.sh
#
# Provides short functions so you can skip "npm run" entirely.

# Resolve the repo root relative to this file's location.
# Works correctly when sourced in both bash and zsh.
if [ -n "$ZSH_VERSION" ]; then
  # zsh: ${(%):-%x} gives the path of the currently-sourced file
  _AGENTS_REPO="$(cd "$(dirname "${(%):-%x}")/../.." && pwd)"
else
  # bash: BASH_SOURCE[0] gives the path of the sourced file
  _AGENTS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
_AGENTS_BIN="node --experimental-strip-types $_AGENTS_REPO/scripts/agents.ts"

# ─── Core ────────────────────────────────────────────────────────────────────

# Create or reopen a sandbox
# Usage: anew "Title"  |  anew claude "Title"  |  anew gemini "Title"
anew() { $_AGENTS_BIN new "$@"; }

# Open an existing sandbox by slug
# Usage: aopen <slug>  |  aopen <slug> codex
aopen() { $_AGENTS_BIN open "$@"; }

# List all active sandboxes
# Usage: alist  |  alist --dirty-only
alist() { $_AGENTS_BIN list "$@"; }

# Show detailed info for a sandbox
# Usage: ashow <slug>
ashow() { $_AGENTS_BIN show "$@"; }

# Update task metadata or append notes
# Usage: atask <slug> --append "note"
atask() { $_AGENTS_BIN task "$@"; }

# Remove a sandbox
# Usage: arm <slug>  |  arm <slug> --force
arm() { $_AGENTS_BIN remove "$@"; }

# Clean stale worktree metadata
aprune() { $_AGENTS_BIN prune "$@"; }

# Preflight checks
adoctor() { $_AGENTS_BIN doctor "$@"; }

# ─── QOL ─────────────────────────────────────────────────────────────────────

# fzf picker — select a sandbox interactively then open it
# Usage: apick  |  apick --agent codex
apick() { $_AGENTS_BIN pick "$@"; }

# Open sandbox worktree in editor
# Usage: afocus <slug>  |  afocus <slug> --editor=zed
afocus() { $_AGENTS_BIN focus "$@"; }

# Print worktree path (safe for $() capture)
# Usage: apath <slug>  |  cd $(apath <slug>)
apath() { $_AGENTS_BIN path "$@"; }

# ─── Per-agent shortcuts ─────────────────────────────────────────────────────

# Usage: anewc "Title"   (claude, the default)
anewc() { $_AGENTS_BIN new claude "$@"; }

# Usage: anewg "Title"   (gemini)
anewg() { $_AGENTS_BIN new gemini "$@"; }

# Usage: anewx "Title"   (codex)
anewx() { $_AGENTS_BIN new codex "$@"; }

# ─── Convenience ─────────────────────────────────────────────────────────────

# cd into a sandbox worktree
# Usage: acd <slug>
acd() {
  local worktree_path
  worktree_path=$($_AGENTS_BIN path "$1" 2>/dev/null)
  if [ -z "$worktree_path" ]; then
    echo "No sandbox found for: $1" >&2
    return 1
  fi
  cd "$worktree_path" || return 1
}
