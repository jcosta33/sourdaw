# Agent Sandboxes

This directory is managed by `scripts/agents.mjs`.

## Quick start

```bash
# Create a new sandbox and launch Claude
npm run agents:new -- --agent claude "Fix auth redirect loop"

# List all sandboxes
npm run agents:list

# Reopen an existing sandbox
npm run agents:open -- fix-auth-redirect-loop

# Reopen with a different agent
npm run agents:open -- fix-auth-redirect-loop --agent codex

# Show details for a sandbox
npm run agents:show -- fix-auth-redirect-loop

# Remove a sandbox (must be clean)
npm run agents:remove -- fix-auth-redirect-loop

# Remove with uncommitted changes
npm run agents:remove -- fix-auth-redirect-loop --force

# Clean stale metadata
npm run agents:prune

# Preflight checks
npm run agents:doctor
```

## Directory layout

```
agents/
  README.md          — this file (committed)
  config.json        — launcher config (committed)
  templates/
    task.md          — task file template (committed)
  tasks/             — per-task markdown files (gitignored)
  state/             — per-task JSON state files (gitignored)
  logs/              — per-task log files (gitignored)
```

## Naming rules

A human title like `"Fix auth redirect loop"` becomes:

- Slug: `fix-auth-redirect-loop`
- Branch: `agent/fix-auth-redirect-loop`
- Task file: `agents/tasks/fix-auth-redirect-loop.md`
- State file: `agents/state/fix-auth-redirect-loop.json`
- Worktree: `../webdaw--fix-auth-redirect-loop`

## Non-goals

This tool does **not**:
- auto-merge branches
- auto-commit changes
- auto-push to remote
- auto-send prompts to agents
- auto-delete dirty worktrees

These may exist as opt-in features in future versions.
