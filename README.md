# Swarm Evolution CLI

The Swarm Evolution CLI (`agents`) is a powerful, autonomous, and zero-dependency orchestration toolkit designed to manage intelligent software engineering agents. It provides a structured, sandboxed environment for AI agents to analyze, refactor, test, and release code across large codebases.

Built for scale and safety, the CLI enforces strict worktree isolation, ensuring that agents operate in parallel without colliding with human developers or each other.

---

## 🚀 Quick Start

The CLI is integrated into the project's package scripts. To see the full list of available commands, run:

```bash
pnpm agents --help
```

To create a new agent sandbox and assign it a task:

```bash
pnpm agents new my-feature-branch "Implement the new billing module"
```

This will:
1. Create a new Git worktree.
2. Check out `my-feature-branch`.
3. Generate a task file at `.agents/tasks/my-feature-branch.md`.
4. Prompt you to launch an agent to begin work.

---

## 🧠 Core Concepts

- **Sandboxing (Worktrees):** Agents never work directly in your main repository directory. The CLI provisions dedicated `git worktree` environments. This prevents agents from accidentally breaking your active workspace or conflicting with uncommitted changes.
- **Task-Driven:** Every agent session is driven by a Markdown task file (e.g., `.agents/tasks/<slug>.md`). This file contains the objective, constraints, and a strict verification checklist that the agent must complete before declaring the task done.
- **Empirical Verification:** Agents are required to prove their work. They must paste actual console output from tests, linters, and compilers into their task files to verify correctness.
- **State Management:** The CLI tracks all active sandboxes, their PIDs, and their current status in `.agents/state.json`.

---

## 🛠️ Command Reference

The Swarm CLI is organized into evolutionary "waves" of capabilities, from basic workspace management to enterprise-scale production engineering.

### Core Subcommands

Manage the lifecycle of agent sandboxes.

- `new [slug] [title]` - Create a new sandbox worktree and task file.
- `open <slug>` - Reopen an existing sandbox terminal.
- `list` - List all active sandboxes and their status.
- `show <slug>` - Show detailed metadata and history for a specific sandbox.
- `task <slug>` - Interactive prompt to append human feedback/hints to the task file.
- `validate` - Run configured linters and typechecks, truncating output for LLM context limits.
- `test` - Run the test runner (Vitest) with smart log truncation.
- `test-radius <file>` - Calculate the blast radius of a file and run only the impacted specs.
- `pr <slug>` - Auto-commit changes and generate a GitHub Pull Request based on the completed task file.
- `screenshot [url]` - Capture a screenshot of the running app using Playwright for visual validation by an LLM.
- `ui` - Launch the real-time persistent Swarm Terminal UI dashboard.

### Context & RAG (V3)

Tools for deep codebase understanding, context compression, and security analysis.

- `compress <file>` - Strip function bodies from a TypeScript file to save LLM context tokens while retaining signatures.
- `graph <file>` - Extract and map the import/export dependencies of a module.
- `references <symbol>` - Fast codebase scan to find usages of a specific symbol or class.
- `docs <file>` - Extract and format JSDoc blocks from a module.
- `complexity <file>` - Calculate cyclomatic complexity heuristics to enforce maintainability invariants.
- `audit-sec <file>` - Scan for common dangerous patterns, secrets, and vulnerabilities.
- `dead-code <file>` - Find exported symbols that are never imported anywhere in the project.
- `format <file>` - Wrapper for Prettier/ESLint autofixes with truncated output.
- `logs <slug>` - View the execution output logs of a running agent session.
- `health` - Run pre-flight environment checks for the Swarm.
- `context [dir]` - Generate a semantic map of exported symbols for Retrieval-Augmented Generation (RAG).
- `memory <get|set|list>` - Global memory bank for cross-agent invariant tracking and learned preferences.

### Autonomous Lifecycles (V4)

Tools for independent agent collaboration, planning, and self-healing.

- `epic <file>` - Decompose a high-level markdown list into individual, actionable child tasks.
- `triage <file>` - Convert an unstructured bug report into a strict, verifiable technical spec.
- `arch` - Lint and enforce cross-module boundary invariants and architectural rules.
- `review <slug>` - Spawn an adversarial peer-review agent session to critique another agent's work.
- `chat <slug> [msg]` - Send or read an IPC message with another running agent.
- `repro` - Verify that test files were modified *before* source code to enforce Test-Driven Development.
- `find <type> <target>` - Semantic search across the codebase (e.g., find all classes that implement an interface).
- `mock <file> <Name>` - Instantly generate a TypeScript mock factory for a specific interface.
- `daemon` - Background watcher that automatically runs `test-radius` when human developers save files.
- `heal` - Self-healing hotfix generator that triggers automatically on CI branch failures.

### Production Scale (V5)

Enterprise-scale orchestration tools for massive refactors and reliability engineering.

- `refactor <dir> <goal>` - Break a massive refactor into 5-file chunks and distribute them as tasks.
- `deps` - Find outdated packages, fetch release notes, and generate upgrade tasks.
- `migrate <file> <lang>` - Spawn a Translator and Verifier agent pair to rewrite code into a new language/framework.
- `fuzz <file> <func>` - Generate and execute unexpected test permutations (nulls, NaNs, etc.) against a function signature.
- `chaos <start|stop>` - Inject latency and mock network failures into the local environment to test resilience.
- `visual <baseline|compare>` - Screenshot-based visual regression comparison loop.
- `knowledge <query>` - Semantic vector-like search across past tasks, PRs, and specs.
- `telemetry` - Dashboard tracking Swarm resource/token usage, time-to-completion, and success rates.
- `profile <cmd>` - Analyze a Node process for bottlenecks and assign a Performance Engineer agent to optimize them.
- `release` - Auto-bump semantic version, generate a changelog from git history, and draft release notes.

### Workspace Management

Utilities for maintaining a clean Swarm environment.

- `ast rename` - Structural rename utility for safely modifying symbols across the project.
- `remove <slug>` - Forcefully remove a sandbox and delete its worktree.
- `prune` - Clean up and remove merged or orphaned sandboxes.
- `doctor` - Run diagnostic preflight checks on the CLI and workspace.
- `path <slug>` - Print the absolute filesystem path to a specific sandbox worktree.
- `focus <slug>` - Open the specified sandbox worktree in your default editor.
- `pick` - Interactive fuzzy-finder menu to select tasks for `new`, `open`, `focus`, or `remove`.

---

## 🔒 Safety & Permissions

The Swarm CLI operates under a strict "Show, Don't Tell" philosophy. Agents are required to provide empirical proof (console output) of their success. The CLI defaults to non-destructive actions, but agents have full filesystem access within their isolated worktrees.

When an agent completes a task, human review is typically performed by reading the self-review section of the task file and running `pnpm agents pr <slug>` to merge the verified code back into the main repository.
