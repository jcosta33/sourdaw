# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: refactor

---

> ⚠️ **REFACTOR SESSION** — Run `{{cmdValidateDeps}}` after every 10 files. Do not declare done until it passes with zero violations. No codemods. No automated mutations. Every file change is individual and deliberate.
>
> **PERSONA:** Load `.agents/skills/personas/SKILL.md` and adopt **The Janitor** persona.

---

## Objective

What this session must accomplish. One paragraph maximum. Be specific.

---

## Linked docs

- Audit: `{{specFile}}`

---

## Before state

<before_state>

Describe the current structure being changed. What does it look like now?

</before_state>

---

## After state

<after_state>

Describe the target structure. What will it look like when done?

</after_state>

---

## Shim contracts

<shim_contracts>

Every public path you add a compatibility shim to. Do not remove a shim until all consumers are migrated.

| Shim path | Forwards to | Safe to remove when |
| --------- | ----------- | ------------------- |
|           |             |                     |

</shim_contracts>

---

## Constraints

- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not merge, rebase, or push unless explicitly instructed
- Run `{{cmdInstall}}` to install dependencies
- **Run `{{cmdValidateDeps}}` after every 10 files — mandatory, not optional**
- No codemods, no automated mutations, no shell loops over files
- Document every shim contract in the table above before continuing
- **Proactively research and read related docs.** If context from another spec, research, or bug file is needed, you are empowered to browse `.agents/specs/`, `.agents/research/`, or `.agents/bugs/` on your own to confirm your hypotheses and make informed decisions. Any other codebase docs (`docs/`, `AGENTS.md`, `.agents/skills/`, `.agents/audits/`) are also fair game.

---

## Progress checklist

- [ ] Fill in before state
- [ ] Fill in after state
- [ ] Identify all affected files
- [ ] Begin refactor
- [ ] `{{cmdValidateDeps}}` checkpoint 1
- [ ] `{{cmdValidateDeps}}` checkpoint 2
- [ ] `{{cmdValidateDeps}}` — final pass, zero violations
- [ ] `{{cmdTypecheck}}` passes
- [ ] All shim contracts documented
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Architecture answered
- [ ] Self-review: Completeness answered
- [ ] Self-review: Shim contracts answered
- [ ] Self-review: Behaviour preservation answered
- [ ] Self-review: Primary deliverable and related work answered

---

## Decisions

- ***

## Findings

- ***

## Assumptions

- [pending]

---

## Blockers

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete.

- ***

## Self-review

<self_review>

Stop. Refactors are high-risk: they touch many files, they drift from intent, and they leave subtle breakage that only shows up later. Act as a senior engineer who did not write this refactor and is about to approve or reject it.

> **Hard gate.** The task is not complete until every question below has a written answer directly beneath it. An unanswered question is a skipped check. Incomplete Self-review is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm agents:validate` (last 2 lines):

### Architecture — the non-negotiable

- Zero validation errors (see pasted output above)? Any new architectural violations introduced while cleaning up old ones — cross-module internals, disallowed barrels (anything other than module root `index.ts`), wrong import paths?
  Answer:

### Completeness

- Is there anything still in the old location that should have moved? (grep for the old paths — do not assume) Any empty directories, dead files, or orphaned imports? Every module in scope fully migrated?
  Answer:

### Shim contracts

- Every shim documented in the table? All shim targets point to the new location? Is it obvious from this task file which shims are still live and which consumers must act?
  Answer:

### Behaviour preservation

- Did you change any behaviour while restructuring? Restructuring means moving and renaming, not rewriting. Did you delete anything still needed somewhere?
  Answer:

### Primary deliverable and related work

- The refactor plan is the main job. If you fixed or improved something beyond it, note it in **Findings** or **Decisions** so the branch stays reviewable. Do not revert correct work only because it was extra.
  Answer:

### Final Polish

- Did you ask yourself: "What else could I do? How can I make this even better, more stable, or more bug-free?" Do not second-guess every decision, but do not leave the work without this final adversarial pass.
  Answer:

Only when every answer above is written is this task complete.

</self_review>
