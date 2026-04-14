# Agents — multi-agent workspace launcher

This doc covers the local agent launcher built into this repo. It manages git worktrees, task files, and terminal sessions so you can spin up isolated agent sandboxes in seconds and switch between them without thinking about git plumbing.

---

## The core idea

Each agent task gets its own:

- **git worktree** — a full checkout of the repo at a separate path, on its own branch, completely isolated from your main working directory
- **task file** — a markdown file you can fill in with context, constraints, and notes for the agent
- **state file** — machine-readable metadata tracking what's open, what agent is assigned, and when it was last used

The workflow is: you describe a task, the tool creates the sandbox, drops you into a terminal inside it with the agent already running. The agent sees only that worktree. It can't accidentally touch your main branch or other tasks.

---

## Setup

Everything is already committed. The only optional step is shell integration.

### Optional: shell functions (recommended)

Add one line to your `~/.zshrc` or `~/.bashrc`:

```bash
source /path/to/webdaw/agents/shell.sh
```

This gives you short functions (`anew`, `aopen`, `alist`, etc.) so you don't have to type `npm run` for every command. The rest of this doc shows both forms.

---

## Quick start

```bash
# Create a sandbox and launch Claude
npm run agents:new -- "Fix auth redirect loop"

# Same, via shell integration
anew "Fix auth redirect loop"
```

That's it. The tool will:

1. Turn the title into a slug: `fix-auth-redirect-loop`
2. Create branch `agent/fix-auth-redirect-loop` off `main`
3. Create a worktree at `../webdaw--fix-auth-redirect-loop`
4. Create `agents/tasks/fix-auth-redirect-loop.md` with a template for you to fill in
5. Open a new Terminal window inside that worktree
6. Launch Claude with a session name matching the slug

You'll be looking at Claude's interactive prompt, inside the isolated worktree, ready to go.

---

## Choosing an agent

Default is Claude. To use a different one:

```bash
# Positional form (shortest)
npm run agents:new -- gemini "Refactor settings page"
npm run agents:new -- codex "Investigate flaky test"

# Per-agent npm scripts
npm run agents:new:claude -- "Fix auth redirect loop"
npm run agents:new:gemini -- "Refactor settings page"
npm run agents:new:codex  -- "Investigate flaky test"

# Shell integration
anew "Fix auth redirect loop"          # defaults to claude
anew gemini "Refactor settings page"
anewc "Fix auth"   # claude shortcut
anewg "Refactor"   # gemini shortcut
anewx "Investigate" # codex shortcut
```

---

## Resuming a sandbox

Running the same task title again reopens the existing sandbox instead of creating a duplicate:

```bash
npm run agents:new -- "Fix auth redirect loop"
# → Sandbox "fix-auth-redirect-loop" already exists — reopening.
```

To open by slug directly:

```bash
npm run agents:open -- fix-auth-redirect-loop

# Shell
aopen fix-auth-redirect-loop
```

To reopen with a different agent than last time:

```bash
npm run agents:open -- fix-auth-redirect-loop codex

# Shell
aopen fix-auth-redirect-loop codex
```

---

## Seeing what's open

```bash
npm run agents:list
alist
```

Output:

```
SLUG                    AGENT   BRANCH                        WORKTREE                                             STATUS
----------------------  ------  ----------------------------  ---------------------------------------------------  ------
fix-auth-redirect-loop  claude  agent/fix-auth-redirect-loop  /Users/you/dev/webdaw--fix-auth-redirect-loop  clean
refactor-settings-page  gemini  agent/refactor-settings-page  /Users/you/dev/webdaw--refactor-settings-page  dirty (3 changes)
```

For more detail on one sandbox:

```bash
npm run agents:show -- fix-auth-redirect-loop
ashow fix-auth-redirect-loop
```

---

## The task file

When you create a sandbox, `.agents/tasks/<slug>.md` is created from the template in `scripts/agents/templates/task.md`. Open it and fill in **Objective** before you hand the task to the agent — it's the most important context you can give.

```markdown
# Fix auth redirect loop

## Metadata

- Slug: fix-auth-redirect-loop
- Agent: claude
- Branch: agent/fix-auth-redirect-loop
  ...

## Objective

After login, users are redirected to /login again instead of /dashboard.
Happens only when coming from an OAuth callback. Investigate the middleware
stack in src/modules/Auth and fix the redirect logic.

## Constraints

- Stay inside this worktree only.
- Do not switch branches.
- Do not merge.
- Do not push unless explicitly asked.

## Notes

- Might be related to the recent session middleware refactor (commit 97c46d0)

## Self-review

_(Complete before ending the session — see `scripts/agents/templates/task.md`.)_
```

The metadata block is managed automatically. Your body content (Objective, Plan, Notes, Self-review, etc.) outside `## Metadata` is preserved by the tool except when you explicitly overwrite the file.

To append a note without opening the file:

```bash
npm run agents:task -- fix-auth-redirect-loop --append "Also check the cookie SameSite setting"
atask fix-auth-redirect-loop --append "Also check the cookie SameSite setting"
```

To update status:

```bash
npm run agents:task -- fix-auth-redirect-loop --set-status blocked
atask fix-auth-redirect-loop --set-status blocked
```

---

## Navigating to a sandbox

Open the worktree in your editor:

```bash
npm run agents:focus -- fix-auth-redirect-loop
afocus fix-auth-redirect-loop
```

This opens the worktree directory in whatever editor is configured (see [Configuration](#configuration)). Auto-detects Cursor, VS Code, Zed, Sublime Text in that order, falls back to Finder.

Jump to the worktree in your current terminal:

```bash
cd $(npm run --silent agents:path -- fix-auth-redirect-loop)

# Shell — much cleaner
acd fix-auth-redirect-loop
```

---

## Fuzzy-picking a sandbox

If you have fzf installed (`brew install fzf`), you can pick a sandbox interactively with a preview panel:

```bash
npm run agents:pick
apick
```

Shows all active sandboxes in fzf, with a detail view on the right. Select with Enter, cancel with Escape.

To pick and open with a specific agent:

```bash
npm run agents:pick -- --agent codex
apick --agent codex
```

---

## Multiple parallel attempts

Sometimes you want two agents attacking the same problem independently. Use `--duplicate`:

```bash
npm run agents:new -- --duplicate "Fix auth redirect loop"
# Creates: fix-auth-redirect-loop-2
```

Run it again for a third:

```bash
npm run agents:new -- --duplicate "Fix auth redirect loop"
# Creates: fix-auth-redirect-loop-3
```

Each gets its own branch, worktree, and task file.

---

## Branching from somewhere other than main

```bash
npm run agents:new -- --base develop "Refactor settings page"
anew gemini --base develop "Refactor settings page"
```

---

## Create without launching

Useful for setting up several sandboxes in batch, or when you want to fill in the task file before the agent starts:

```bash
npm run agents:new -- --no-launch "Investigate flaky checkout test"
npm run agents:new -- --no-launch "Review perf regression in transport"

# Edit both task files
# Then open them when ready
npm run agents:open -- investigate-flaky-checkout-test
npm run agents:open -- review-perf-regression-in-transport
```

---

## Archiving finished work

When a task is done but you're not ready to delete the branch yet:

```bash
npm run agents:archive -- fix-auth-redirect-loop
aarchive fix-auth-redirect-loop
```

Archived sandboxes are hidden from `agents:list` by default. The worktree and branch are untouched.

```bash
alist          # archived hidden
alist --all    # everything
alist --archived  # only archived
```

To restore:

```bash
atask fix-auth-redirect-loop --set-status active
```

---

## Removing a sandbox

```bash
npm run agents:remove -- fix-auth-redirect-loop
arm fix-auth-redirect-loop
```

Refuses if the worktree has uncommitted changes. To force:

```bash
arm fix-auth-redirect-loop --force
```

Remove runs `git worktree remove`, deletes the task file, state file, and log file. It does not delete the branch — that's intentional, in case there's work worth keeping.

---

## Cleaning up stale metadata

If a worktree was deleted manually (or `--force` removed left a dangling reference):

```bash
npm run agents:prune
aprune
```

Runs `git worktree prune` and removes any registry entries whose paths no longer exist.

---

## Preflight check

Before starting a new machine or debugging a weird failure:

```bash
npm run agents:doctor
adoctor
```

Checks:

- Inside a git repo
- `git` installed
- `agents/config.json` valid
- Runtime directories exist
- Worktree parent directory writable
- Configured terminal backend available
- Agent CLI on PATH
- `fzf` available (soft warning if not)

---

## Configuration

`agents/config.json` is committed and shared. Reasonable defaults are already set.

```json
{
    "defaultBaseBranch": "main",
    "worktreeDirPattern": "../{repoName}--{slug}",
    "defaultTerminal": "auto",
    "defaultAgent": "claude",
    "agents": {
        "claude": { "command": "claude", "args": [] },
        "gemini": { "command": "gemini", "args": [] },
        "codex": { "command": "codex", "args": [] }
    },
    "reuseExistingByDefault": true,
    "writeTaskTemplateOnCreate": true,
    "slugMaxLen": 60
}
```

Fields worth knowing:

| Field                    | What it controls                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `defaultAgent`           | Which agent `anew "title"` launches without an explicit name                                                     |
| `defaultBaseBranch`      | Branch worktrees are created from by default                                                                     |
| `worktreeDirPattern`     | Where worktrees land. `{repoName}` and `{slug}` are substituted                                                  |
| `defaultTerminal`        | `auto` picks Terminal.app on macOS, falls back to current session. Other options: `current`, `terminal`, `iterm` |
| `reuseExistingByDefault` | If true, `anew "same title"` reopens instead of erroring                                                         |
| `slugMaxLen`             | Truncation length for generated slugs                                                                            |
| `preferredEditor`        | Set to `"cursor"`, `"code"`, `"zed"`, etc. to pin `agents:focus`. If absent, auto-detects                        |

All config values can be overridden per-command with flags.

---

## Terminal backends

| Backend    | Behavior                                                |
| ---------- | ------------------------------------------------------- |
| `auto`     | Terminal.app on macOS, `current` everywhere else        |
| `terminal` | Opens a new Terminal.app window                         |
| `iterm`    | Opens a new iTerm2 tab (requires iTerm2)                |
| `current`  | Stays in the current terminal session, agent takes over |

`current` is the fastest option if you're already in the right place or prefer not to open a new window:

```bash
npm run agents:open -- fix-auth-redirect-loop --terminal=current
```

---

## Passing extra args to the agent

```bash
npm run agents:new -- claude --agent-args="--verbose" "Fix auth redirect loop"
```

The raw string is appended to the agent command after the launcher's own args.

---

## File layout

```
agents/
  config.json          — committed config
  templates/task.md    — task file template (edit to customise)
  shell.sh             — optional shell integration (source this)
  README.md            — quick reference
  tasks/               — gitignored, one .md per sandbox
  state/               — gitignored, one .json per sandbox
  logs/                — gitignored, reserved for future use

scripts/
  agents.mjs           — CLI entry point
  agents/
    config.mjs         — config loading
    slug.mjs           — slug normalisation
    git.mjs            — worktree operations
    state.mjs          — state file read/write
    template.mjs       — task file creation and update
    terminal.mjs       — terminal backend dispatch
    adapters/
      claude.mjs
      gemini.mjs
      codex.mjs
```

`agents/tasks/` and `agents/state/` are gitignored. The structure is committed (via `.gitkeep` files), the content is not.

---

## What this tool deliberately does not do

- Auto-merge branches
- Auto-commit changes
- Auto-push to remote
- Auto-send the first prompt to the agent
- Auto-delete worktrees
- Make branching strategy decisions

These may exist as opt-in features in future. For now, the agent does whatever it does inside its sandbox, and you decide what to do with the result.

---

## Command reference

| npm script                               | Shell alias                     | What it does               |
| ---------------------------------------- | ------------------------------- | -------------------------- |
| `agents:new -- [agent] "title"`          | `anew [agent] "title"`          | Create or reopen a sandbox |
| `agents:new:claude -- "title"`           | `anewc "title"`                 | Create with Claude         |
| `agents:new:gemini -- "title"`           | `anewg "title"`                 | Create with Gemini         |
| `agents:new:codex -- "title"`            | `anewx "title"`                 | Create with Codex          |
| `agents:open -- <slug> [agent]`          | `aopen <slug> [agent]`          | Reopen a sandbox           |
| `agents:list`                            | `alist`                         | List active sandboxes      |
| `agents:show -- <slug>`                  | `ashow <slug>`                  | Detailed info              |
| `agents:task -- <slug> --append "note"`  | `atask <slug> --append "note"`  | Append note to task file   |
| `agents:task -- <slug> --set-status <s>` | `atask <slug> --set-status <s>` | Update status              |
| `agents:remove -- <slug>`                | `arm <slug>`                    | Remove sandbox             |
| `agents:archive -- <slug>`               | `aarchive <slug>`               | Archive without deleting   |
| `agents:prune`                           | `aprune`                        | Clean stale metadata       |
| `agents:doctor`                          | `adoctor`                       | Preflight checks           |
| `agents:pick`                            | `apick`                         | fzf picker                 |
| `agents:focus -- <slug>`                 | `afocus <slug>`                 | Open in editor             |
| `agents:path -- <slug>`                  | `apath <slug>`                  | Print worktree path        |
| —                                        | `acd <slug>`                    | cd into worktree           |
