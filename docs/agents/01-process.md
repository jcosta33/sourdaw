# Agent process — documentation-first workflow

> **Superseded — this repo adopted Corpus.** Specs, audits, research, tasks, reviews, findings, and decisions now live in the Corpus workspace (`../sourdaw-works`), not in the `.agents/` tree here. The canonical loop (Pull -> Spec -> Task -> Run -> Review -> Close) and its guides are `../sourdaw-works/AGENTS.md` and `../sourdaw-works/.agents/skills/`. The writing principles below still hold; the artifact locations moved (see the directory map in the root `AGENTS.md`). Domain skills (`.agents/skills/`) and worktree task scratch (`.agents/tasks/`) still live in this repo.

## Why this exists

Agentic coding sessions fail in predictable ways: agents start implementing before they understand the codebase, make assumptions they never surface, produce work that conflicts with existing architecture, and leave no trail for the next session to follow.

This repo counters that with a documentation-first constraint. Before writing significant code, an agent is expected to read, produce, or update a document that captures what it knows, what it found, what it decided, and what it is about to do. This makes assumptions visible, keeps work reviewable, and gives every handoff a clean starting point.

The goal is not process for its own sake. The goal is to not waste effort on work that conflicts with the existing system, can't be reviewed, or can't be resumed.

---

## Three tiers of documentation

This repo uses three distinct tiers. Understanding the distinction matters:

**Canonical process and templates** — `docs/agents/`
Written for humans. Defines the workflow, file types, standards, and templates. Shared across all agents and sessions. The authoritative reference for how the system works. Changes here are intentional and reviewed.

**Durable work products** — Corpus workspace (`../sourdaw-works`): specs co-locate their audit and research under `../sourdaw-works/specs/<feature>/` (`spec.md`, `audit.md`, `research.md`); whole-module audits land in `../sourdaw-works/inventory/<Module>.md`; multi-feature research sources go to `../sourdaw-works/intake/`
Generated artifacts that accumulate over the life of the project. Specs, audits, and research are persistent, reviewable, and shared across worktrees. They outlive individual sessions.

**Local execution scaffolding** — `.agents/tasks/`
Runtime-only working notes for an active agent session. Task files are local, gitignored, and worktree-specific. They record progress, assumptions, decisions, blockers, and handoff notes. They are not the canonical documentation layer — they support the workflow, not replace it. When a session ends, the task file's durable findings should be reflected in audits, specs, or research where appropriate.

---

## The five document types

Specs, audits, and research now live in the Corpus workspace (`../sourdaw-works`); skills and tasks stay in this repo. Each has a specific role:

| Directory                                                                                                      | Type     | Tier                                               |
| -------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `../sourdaw-works/specs/<feature>/audit.md` (one feature) or `../sourdaw-works/inventory/<Module>.md` (whole module) | Audit    | Durable work product                               |
| `../sourdaw-works/specs/<feature>/spec.md`                                                                        | Spec     | Durable work product                               |
| `../sourdaw-works/specs/<feature>/research.md` (one feature) or `../sourdaw-works/intake/` (multi-feature)           | Research | Durable work product (agent or developer-authored) |
| `.agents/skills/`                                                                                              | Skill    | Durable work product                               |
| `.agents/tasks/`                                                                                               | Task     | Local execution scaffolding                        |

Full definitions, required sections, and what "done" looks like for each type: see `docs/agents/02-file-types.md`.

---

## The order that matters

Not every task needs all five. But when in doubt, the order is:

```
Research → Spec → Task → Implementation → Audit update
```

**Research** answers: what does the wider world know about this problem?
**Spec** answers: exactly what are we building, and how will we know it works?
**Task** records: objective, plan, decisions, and progress for this session.
**Implementation** follows only when the spec is complete and all critical open questions are resolved.
**Audit** is updated (or created) after implementation to reflect the new codebase state.

Documentation is proportionate to scope. A trivial bug fix — a single isolated file, obviously correct, no design choices — needs none of this. The system exists to prevent wasted effort on non-trivial work, not to add overhead to obvious changes. When the task is small enough that skipping documentation is clearly the right call, skip it.

When the task is non-trivial, skipping should be a deliberate decision, not a default.

**Research ownership:** Agents are empowered and expected to perform research. If you need to understand an API, fix a complex bug, or evaluate a technical approach, you should aggressively search the codebase and the internet. Agents can and should create new research files in the Corpus workspace — co-located at `../sourdaw-works/specs/<feature>/research.md` for a single feature, or `../sourdaw-works/intake/` for multi-feature sources — to document durable domain knowledge discovered during a session. Do not endlessly ruminate; validate your assumptions with sources.

---

## Operating constraints

These apply to all agents in all worktrees:

- Work only inside the assigned worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Do not assume silence means approval — surface blockers
- Do not hide uncertainty — record it in the task file
- Keep documents updated as work evolves, not just at the start
- Run `pnpm deps:validate` constantly during cross-module work (see `AGENTS.md`)

---

## Tooling

> **Retired.** The in-repo `agents:*` worktree launcher has been removed. Isolated
> worktrees and task delegation are now owned by the Corpus workspace
> (`../sourdaw-works`) + Claude Code. Start from the task packet you were given in
> `../sourdaw-works/tasks/` (see `../sourdaw-works/AGENTS.md`); worktree-local task scratch
> still lives at `.agents/tasks/`.
