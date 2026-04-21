# Agent Ecosystem: Vast Improvements Plan

This document outlines a comprehensive architectural and UX roadmap to take the `agents` CLI ecosystem to the "next level." The goal is to move from a set of helpful bash/node wrappers to a fully autonomous, self-healing, and deeply integrated multi-agent orchestration framework.

## 1. Orchestration & Review Loop (The "Closed Loop")
Currently, the Delegator (Lead Engineer) orchestrates workers and runs `delegator:review`, but it relies on the LLM to manually read the review output, summarize it, and append it to the worker's task file. This is prone to context-window exhaustion and hallucination.

- **Auto-Inject Reviews:** Modify `pnpm delegator:review <slug> --feedback` to automatically run the diffs, typechecks, and dependency validations, format them neatly, and *append them directly* to the worker's `.agents/tasks/<slug>.md` file. The Lead Engineer just runs the command, and the system handles the IPC (Inter-Process Communication) via the filesystem.
- **Dynamic Base Branching:** `delegator:review` currently hardcodes `git diff main...HEAD`. It should read the worker's `baseBranch` from its task file or git config to allow nested delegations (e.g., Lead Engineer creates a feature branch, and workers branch off *that* feature branch).
- **Validation Wrapper:** Create a unified `pnpm agents:validate` command that runs tests, linters, and typechecks, truncating output smartly for LLMs (e.g., showing only the first 50 lines of a compiler error). Replace the raw `pnpm typecheck` calls in the templates with this robust wrapper.

## 2. Worktree & State Management
Agent worktrees easily become stale as `main` advances or other agents merge their work.
- **`agents:sync <slug>`:** Introduce a command that automatically rebases an active worker's sandbox onto the latest integration branch or `main`, handling simple conflicts automatically and pausing the agent if manual intervention is required.
- **Telemetry & State (`.agents/state.json`):** Enhance `agents:list` to show actual agent telemetry. Instead of just showing Git status, track the PID of the running agent, its last known activity timestamp, and whether it exited cleanly or crashed due to token limits.
- **Aggressive Garbage Collection:** Enhance `agents:prune` to not only delete merged worktrees but also archive/compress their corresponding `.agents/tasks/<slug>.md` files to keep the active tasks directory clean.

## 3. Template Modernization & Dynamic Skill Injection
The templates (`task-feature.md`, `task-fix.md`) are static. We can make them context-aware.
- **Dynamic Skills:** Extend `scripts/agents/task-types.json` to define default "Skills" (e.g., `ui-patterns`, `state-and-write-paths`). When `agents:new` generates a task file, it should automatically read the project's codebase, detect the languages/frameworks used, and inject the relevant `<activated_skill>` XML blocks directly into the `.agents/tasks/<slug>.md` file.
- **XML Tagging:** Wrap the "Acceptance criteria", "Module plan", and "Self-review" sections in strict XML tags (e.g., `<acceptance_criteria>`) to force the LLMs to parse and update them more rigidly, reducing format drift during long sessions.
- **Pre-flight Planning:** Introduce a "Planning Phase" where the task template forces the agent to use `update_topic` to write out its module plan *before* it is allowed to write any code.

## 4. Project-Agnostic Configuration
The ecosystem currently hardcodes `pnpm i`, `pnpm deps:validate`, and `pnpm typecheck` in the templates and review scripts.
- **Configurable Commands:** Move these into `scripts/agents/config.json`:
  ```json
  {
    "commands": {
      "install": "pnpm i",
      "typecheck": "pnpm typecheck",
      "validateDeps": "pnpm deps:validate",
      "test": "pnpm test"
    }
  }
  ```
- Update `agents/template.ts` to inject these commands dynamically. This makes the `agents` CLI portable to Rust (`cargo check`), Python (`ruff`), or Go projects without modifying the core scripts.

## 5. Shared CLI Framework
We started this by extracting `scripts/agents/cli.ts`.
- **Standardized Logging:** Create a `logger.ts` that handles all stdout/stderr, ensuring that when output is piped to JSON (`--json`), no stray `console.log` breaks the parser.
- **Unified Argument Parsing:** Migrate `delegator.ts` and any future scripts to strictly use the `parseArgs` and interactive `fzf` components from `cli.ts`.

## Next Steps
If this plan aligns with your vision, I suggest we tackle it in phases:
1. **Phase 1 (The Closed Loop):** Implement `agents:validate`, `delegator:review --feedback`, and dynamic base branching.
2. **Phase 2 (Templates & Config):** Move hardcoded commands to `config.json` and modernize the markdown templates with XML and dynamic skills.
3. **Phase 3 (Worktrees & State):** Implement `agents:sync` and the telemetry state tracker.