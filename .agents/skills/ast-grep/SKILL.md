---
name: ast-grep
description: >-
    Run read-only ast-grep structural searches over TypeScript and Rust code.
    ALWAYS apply when the question is a syntax shape rather than text — counting
    call sites, finding multiline invocations, listing JSX or structural
    candidates. Skip filenames, literal strings, and config keys (file search /
    rg), exact symbol definitions, references, and types (LSP / language
    tooling), architectural enforcement (`pnpm deps:validate`, dependency-cruiser),
    and every form of editing: this tool is run-only here.
---

## Purpose

ast-grep matches nodes the parser recognizes, not text that looks like code. It answers shape questions — every `executeAppAction(...)` dispatch, every `vi.mock(...)` declaration, every `debug_assert!` on a real-time path — where text search over-matches (the name inside a comment or string) or under-matches (calls spread across lines). The pinned `@ast-grep/cli` devDependency keeps every agent on the same parser and version.

## Core rules

### 1. Pick the tool by the question

| Question                                                     | Tool                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Filenames, literal strings, config keys                      | File search / rg                                          |
| Syntax shapes, multiline calls, JSX or structural candidates | `pnpm exec ast-grep run` (this skill)                     |
| Exact symbol definitions, references, types                  | LSP / language tooling                                    |
| Architectural enforcement (boundaries, barrels)              | `pnpm deps:validate`, dependency-cruiser — never ast-grep |

ast-grep generates candidates; the repository's own checks enforce architecture. It never replaces them.

### 2. Run mode only — rewrite modes are forbidden

Every search is `pnpm exec ast-grep run --lang <ts|tsx|rust> -p '<pattern>' <paths>`. Rewrite and update-all modes are forbidden: repository policy bans bulk edits, and the Claude Code permission denies in `.claude/settings.json` block them for any space-separated command text naming `ast-grep` (wildcard rules), deny the deprecated `sg` alias outright, and deny `pnpm dlx` invocations of the package outright. Text rules cannot see whitespace-obscured (for example tab-separated) or `bash -c`-wrapped command text. Never pass `--rewrite` or `--update-all` to ast-grep.

### 3. Practical rules

- Use the full command name `ast-grep`, never `sg`: the alias is deprecated by the package itself (its shim prints a deprecation warning), collides with another executable on Linux hosts, and is denied outright by Claude Code permissions in every spelling.
- Single-quote patterns containing `$`: inside double quotes the shell expands `$$` to its PID, so `'vi.mock($$$ARGS)'` must never be double-quoted.
- `--lang ts` scans `.ts` files only; use `--lang tsx` for `.tsx` files, because JSX does not parse as plain TypeScript.
- A syntactic match is a candidate, not proof of semantic identity, reachability, or a defect. Read each match before claiming it means anything.

### 4. Tested recipes

Counts verified guard-wrapped on 2026-09-15 at head `a081b5d3e`; they are sanity anchors, so re-run a recipe before relying on its count.

- Action dispatch sites: `pnpm exec ast-grep run --lang ts -p 'executeAppAction($$$ARGS)' src` — 278 matches (presentation dispatch needs `--lang tsx`: 15).
- Mock declarations: `pnpm exec ast-grep run --lang ts -p 'vi.mock($$$ARGS)' src scripts` — 4942 matches (`.tsx` specs need `--lang tsx`: 1640).
- External-store binding: `pnpm exec ast-grep run --lang ts -p 'useSyncExternalStore($$$ARGS)' src` — 5 matches, all in `.ts` hook modules; `--lang tsx` finds 0.
- Real-time assertion macro: `pnpm exec ast-grep run --lang rust -p 'debug_assert!($$$ARGS)' crates` — 19 matches.

To count matches, append `--json=compact` and pipe through `python3 -c "import json,sys; print(len(json.load(sys.stdin)))"`.

## References

- [AGENTS.md](../../../AGENTS.md) — Checks section: the structural-search contract.
- `.claude/settings.json` — this change's denies: the ast-grep wildcard family and launcher shapes, wholesale denial of the deprecated `sg` alias, and `pnpm dlx` of the package.
