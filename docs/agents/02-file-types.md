# File types

Definitions, placement rules, required sections, and completion criteria for each document type used in this repo.

---

## Audit

**Purpose:** A report on the current state of a specific area of the codebase relative to a concrete goal. Audits are used to identify what exists, what is broken, what drifts from standards, and what work is blocked on other work.

An audit is not a to-do list. It is an honest description of reality. It may contain a prioritised issue list, but the primary job is accurate observation — not prescription.

**When to create one:**

- Before refactoring, migrating, or significantly changing an area you do not already understand
- When a feature area has known UX, architecture, or quality problems that need to be made legible before work begins
- When handing off an area to another agent or session

**Where it lives:** `.agents/audits/<area>/<name>.md` or `.agents/audits/<name>.md` for repo-wide audits

**Required sections:**

```
# <Title>

## Scope
What area, goal, or initiative this audit covers. What it explicitly excludes.

## Goal
What "good" looks like for this area.

## Relevant code paths
Key files and modules the reader should know about.

## Current behavior
What exists and how it behaves today. Specific file references.

## Findings
Key observations not obvious from reading individual files.

## Priorities
Ordered list of highest-impact issues.

## Open issues
Numbered. Each includes: problem, representative files, what is needed to resolve it.

## Open questions
Things that could not be determined or that require a decision before work begins.

## Risks
What could go wrong if issues are left unaddressed.

## Suggested approaches
High-level direction for tackling issues. Not implementation instructions.

## Recommendation
Which issue to address first and what the next step is.

## Resolved
Issues addressed. Format: ~~description~~ — resolved in <branch> on <date>
```

**What "done" looks like:**
The audit accurately reflects the current state of the area it covers. A reader can immediately understand what exists, what is broken, what the risks are, and where to start. It does not contain work that hasn't happened yet presented as if it has.

---

## Spec

**Purpose:** A precise description of what a feature or change must do, how it must behave, what constraints it must respect, and how to know when it is complete. Specs are forward-looking — they describe what will be true after implementation.

A spec is the contract between intent and code. An agent implementing from a spec should be able to verify completion mechanically against acceptance criteria.

**When to create one:**

- Before implementing any feature with more than trivial scope
- When multiple agents or sessions need to work toward the same goal without diverging
- When the implementation has real design choices that need to be made explicit before code is written

**Where it lives:** `.agents/specs/<name>.md`

**Required sections:**

```
# <Feature name>

## Context
Why this feature exists. Reference relevant research if any.

## Goal
One or two sentences: what will be true when this is done.

## User-visible behavior
What the user or system experiences — behavior described from the outside in.

## Scope
In scope and non-goals (explicitly out of scope).

## Requirements
Numbered list. Each must be unambiguous and testable.

## Constraints
Architecture, performance, platform, or design constraints that must hold.

## Design decisions
Significant choices made during spec-writing and why alternatives were rejected.

## Acceptance criteria
Concrete, verifiable checklist. "It works" is not an acceptance criterion.

## Implementation notes
Known tricky areas, suggested approach, relevant existing patterns.

## Test plan
How to verify the feature works end-to-end after implementation.

## Open questions
Decisions not yet made. [CRITICAL] items block implementation.

## Tradeoffs and risks
What was considered and rejected. What could go wrong.
```

**What "done" looks like:**
Every acceptance criterion is met. Open questions either have answers recorded or were resolved to "out of scope." Another agent reading the spec can verify it was implemented correctly without asking anyone.

---

## Research

**Purpose:** Technical findings gathered from external sources — libraries, papers, APIs, standards, other codebases, documentation, benchmarks. Research files are evidence-based and cite their sources.

Research files are not opinion pieces. They synthesise external information and make it usable. They end with specific actionable recommendations or a decision relevant to the task that prompted the research.

**Ownership:** Research can be developer-authored or agent-authored. Agents are empowered and expected to perform research when external domain knowledge needs to be captured before implementation can begin. If you need to understand an API, fix a complex bug, or evaluate a technical approach, do not endlessly ruminate or guess; aggressively use your tools to search the codebase and the internet, and document your findings.

**Relationship to other types:** Research is upstream of spec. If research exists for an area, a spec must also exist before implementation begins. The spec translates research findings into specific requirements and acceptance criteria.

**When a developer creates one:**

- When implementing a DSP algorithm with published math
- When choosing between external libraries or approaches
- When implementation depends on understanding a standard, protocol, or API
- When the decision would benefit from documented precedent from other products

**Where it lives:** `.agents/research/<topic>.md`
Move to `.agents/research/done/<topic>.md` when the findings have been fully applied.

**Required sections:**

```
# <Topic>

## Purpose
What question this research answers. What decision it is meant to inform.

## Sources
List of sources consulted: papers, docs, repos, APIs, products.
Every claim in the findings must be traceable to a source.

## Findings
Substantive technical content. Code where it clarifies.
Organised by sub-topic if the research covers multiple areas.

## Tradeoffs / comparison
Where multiple options exist, compare them explicitly.

## Recommendation
What to do, and why. If no clear recommendation is possible, say why.

## Open questions
What the research did not resolve.
```

**What "done" looks like:**
The findings are specific enough to implement from. Every significant claim has a source. The recommendation is actionable. An agent reading this file can make a decision without doing the same research again.

---

## Skill

**Purpose:** A reusable, distilled knowledge document for a specific technical domain in this codebase. Skills capture the architectural role, rules, patterns, and anti-patterns for an area in a form agents can load as context before working in that area.

Skills are not tutorials. They are operational guides — written for an agent that is about to write or review code in that domain.

**When to create one:**

- When the same architectural rules need to be applied consistently across many sessions
- When a domain has non-obvious constraints that agents repeatedly get wrong
- When a major subsystem has enough nuance that starting work without it leads to violations

**Where it lives:** `.agents/skills/<name>/SKILL.md`

**Format:**

```
# SKILL: <name>

---

name: <name>
description: <one or two sentences — when to load this skill. Be specific about trigger conditions.>

---

## Purpose
What this skill is for. What it protects.
What this subsystem IS and IS NOT.

## Architectural role
How this subsystem fits into the overall architecture.
What it owns. What it does not own.

## Core rules
Numbered list of hard rules. No hedging. These must hold.

## Common patterns
Code patterns that are correct and should be followed.

## Anti-patterns
What looks tempting but is wrong. Why.

## Checklist
Before submitting work in this domain, verify:
- [ ] ...
```

**What "done" looks like:**
An agent that reads this skill and nothing else can make architecturally correct decisions in this domain. The rules are unambiguous. Anti-patterns are concrete, not abstract warnings.

---

## Task

**Purpose:** Local execution scaffolding for an active agent session. Task files are created at the start of a session, updated throughout, and left as a record at the end. They are worktree-specific and gitignored.

Task files are the agent's working memory for one session. They record context, decisions, blockers, findings, and progress so that nothing is lost if the session is interrupted. They are not the canonical documentation layer — they do not replace audits, specs, or research. When a session ends, any durable findings should be reflected in those artifacts.

**Relationship to other types:** A task file is the execution companion to a spec. If a spec exists, a task file must exist while implementation is in progress. The task file links back to the spec, audit, and research it was created under. When a session ends, findings that belong in a durable artifact should be written there — not left only in the task file.

**When to create one:**
At the start of any non-trivial agent session. The launcher (`anew "title"`) creates one automatically from the template.

**Where it lives:** `.agents/tasks/<slug>.md` — gitignored, local to the worktree

**Required sections:**

```
# <Task title>

## Metadata
Slug, agent, branch, base, worktree, created, status.

## Objective
What this session must accomplish. One paragraph maximum.

## Linked docs
The spec, audit, and research files this task executes under.
The skills loaded for this session.

## Constraints
What this agent must not do.

## Plan
Step-by-step plan before implementation starts.

## Progress checklist
Discrete steps tracked as they complete.

## Decisions
Key decisions made during this session and why.

## Findings
Codebase discoveries worth preserving. Anything durable here must also go into an audit or spec.

## Assumptions
Things assumed to be true. Marked [pending] or [confirmed].

## Blockers
Anything preventing progress.

## Next steps
Concrete starting points for the next session if this one ends incomplete.

## Self-review
Mandatory questions and verification outputs (`git status`, `pnpm deps:validate`, `pnpm typecheck`, etc.). The task file is self-contained — there is no separate Handoff section. Use Decisions, Findings, and Next steps for narrative the next reader needs.
```

**What "done" looks like:**
Self-review is complete (every question answered with a written trace). The Progress checklist reflects what actually happened. Decisions are recorded with rationale. Any findings that belong in audits or specs have been moved there. Blockers are recorded with enough context for the next session.
