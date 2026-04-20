---
name: documentation-gatekeeper
description: Load before any non-trivial session. Decides what documentation is required given the scope of the task, enforces sequencing rules, and gates on what must exist before code is written.
---

# SKILL: documentation-gatekeeper

## Purpose

This skill encodes the sequencing invariants of the documentation-first workflow. It exists because agents that skip documentation produce work that conflicts with existing architecture, cannot be reviewed, and cannot be resumed.

Full process explanation for humans: `docs/agents/01-process.md`.
Full workflow steps: `docs/agents/03-workflow.md`.
File type definitions: `docs/agents/02-file-types.md`.

---

## First: assess scope

Before applying any rule, decide whether the task is trivial.

A task is trivial if it is: a single isolated file, obviously correct, no design choices, no cross-module impact, no user-visible behavior change. A typo fix, a constant rename, a missing null-check. For trivial tasks, none of the documentation below is required. Just make the change.

If there is any doubt about whether a task is trivial, treat it as non-trivial.

---

## Sequencing rules

These apply to non-trivial tasks. They are hard constraints, not suggestions.

1. **Task file if scope warrants it.** If the task has enough scope that you might lose track of what you're doing or need to hand it off, create a task file. Load `manage-task`. If it is a trivial fix, skip this.

2. **No implementation without a spec** (for non-trivial work). Non-trivial means: more than a single isolated function, involves design choices, or affects more than one file. Load the `write-spec` skill before writing a spec. If a spec already exists, read it first.

3. **Research exists → spec is mandatory.** If research files exist in `.agents/research/` for the area you are working in, a spec must also exist before implementation begins. Research is upstream input that must be translated into a spec. Do not implement directly from research.

4. **No spec without grounding.** A spec must be grounded in either existing research (`.agents/research/`) or clear prior knowledge already in the codebase. Do not spec from assumption.

5. **Update audits after implementation.** After making changes that affect the observable state of the codebase, update (or create) the relevant audit. Load the `write-audit` skill. Mark resolved issues. Add new ones discovered.

6. **Load domain skills before touching domain code.** Check `.agents/skills/` for any skill whose description matches the area you are about to work in. Read the `description` field of each `SKILL.md` to decide relevance. Work that crosses **`src/modules/*` boundaries** (imports between modules, root `index.ts`, `pnpm deps:validate`) must load **`architecture-violations`** and the canonical **`docs/architecture/03-typescript-module.md`** §3.3–§5.1 (including **same module = relative imports**, **other modules = `#/modules/<Module>` only**, **`index.ts` exports only for external consumers**).

7. **Task files are not a substitute for durable docs.** A task file records execution state for one session. It does not replace audits, specs, or research. Findings discovered in a session that belong in a durable artifact must be written there — not left only in the task file.

---

## Proactive Research

**You are empowered and expected to perform research.** If you need to understand an API, fix a complex bug, or evaluate a technical approach, do not endlessly ruminate or guess. 
- Use your tools to search the codebase and the internet.
- Finding sources is crucial for decision making. 
- You may create new research files in `.agents/research/` if your findings represent durable domain knowledge that should be kept. Do not fabricate findings; back them up with real documentation, codebase reality, or internet sources.

---

## Pre-implementation checklist (non-trivial tasks)

Skip this for trivial changes. For everything else, before writing the first line of code:

- [ ] Scope assessed — confirmed non-trivial
- [ ] Relevant skills loaded (check all `description` fields in `.agents/skills/`)
- [ ] Task file created with Objective and Plan (if scope warrants tracking)
- [ ] Relevant spec read or written (load `write-spec` if writing)
- [ ] If adding or moving tests: placement follows `docs/06-testing.md` §3 (`__tests__/` folders); load `.agents/skills/testing-file-layout/SKILL.md` if needed
- [ ] Relevant audit read (update if stale, create if absent and scope warrants it)
- [ ] All `[CRITICAL]` open questions in the spec resolved
- [ ] No unverified assumptions driving design decisions

---

## Post-implementation checklist (non-trivial tasks)

- [ ] `pnpm deps:validate` passes with zero violations
- [ ] All spec acceptance criteria verified (if spec exists)
- [ ] Audit updated if observable behavior changed (if audit is relevant)
- [ ] Task file Self-review complete (if task file exists)
- [ ] No pushed branches, no merged code, no commits to wrong branch

---

## Anti-patterns

- Starting to code and noting "I'll write the spec later" — the spec is how you know what to code.
- Implementing directly from a research file without a spec — research is input, not a spec.
- Writing research because none exists — surface the gap as a blocker.
- Using the task file as a substitute for writing an audit or spec — findings in a task file that belong in a durable artifact must be moved there.
- Declaring a task done with incomplete Self-review.
- Leaving audits stale after making changes they cover.
- Loading skills only when their domain causes a problem — load them proactively.
