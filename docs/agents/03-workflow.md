# Agent workflow

Step-by-step execution flow for agent sessions in this repo.

---

## 1. Start a sandbox

Use the launcher to create an isolated worktree for the task:

```bash
anew "Implement limiter DSP backend"
# or
npm run agents:new -- "Implement limiter DSP backend"
```

This creates:

- a dedicated branch (`agent/implement-limiter-dsp-backend`)
- an isolated worktree (`../webdaw--implement-limiter-dsp-backend`)
- a task file at `.agents/tasks/implement-limiter-dsp-backend.md`

See `docs/08-agents.md` for the full launcher reference.

---

## 2. Read the task file

The task file was created from the template. Before doing anything else:

- Fill in **Objective** — what this session must accomplish
- Fill in **Relevant docs** — list any specs, audits, or research that applies
- Fill in **Constraints** — anything this session must not do

Do not start work without a written objective.

---

## 3. Decide what documentation is needed

Read the objective. Ask:

**Do I need research?**
→ Yes if the task involves an algorithm, API, standard, library, or technology you do not already have accurate findings for.
→ Check `.agents/research/` for existing findings. If none exist and it is needed, you are empowered and expected to perform research yourself. Aggressively search the codebase and internet to validate your assumptions and document durable findings in a new research file.

**Do I need an audit?**
→ Yes if the task involves changing, migrating, or fixing an area you have not examined in this session.
→ Yes if there is a known audit for this area in `.agents/audits/` — read it first, update it if stale.
→ Create or update a file in `.agents/audits/`.

**Do I need a spec?**
→ Yes if the task is implementing a feature with non-trivial scope, involves design choices, or needs to be verified by someone else.
→ Yes if there is already a spec in `.agents/specs/` for this area — read it before writing any code.
→ Create or update a file in `.agents/specs/`.

**Do I need to load skills?**
→ Check `.agents/skills/` for any skill whose description matches the domain you are about to work in.
→ Load all relevant skills before touching code in that domain.

When in doubt: document first.

---

## 4. Check existing artifacts

Before creating new documents, check whether relevant ones already exist:

```
.agents/audits/        — existing codebase audits
.agents/specs/         — existing feature specs
.agents/research/      — existing research findings
.agents/research/done/ — completed/applied research
.agents/skills/        — domain knowledge distillations
```

Do not duplicate existing documents. Update them instead if they are stale.

---

## 5. Establish readiness to implement

Do not begin implementation until:

- [ ] Objective is written in the task file
- [ ] Relevant skills have been loaded
- [ ] Relevant specs have been read (or written if none existed)
- [ ] Relevant audits have been read (or written if the area is unfamiliar)
- [ ] All critical open questions in the spec are resolved
- [ ] The plan is written in the task file

If there are unresolved critical questions in a spec, record them in `## Open questions` and surface them before proceeding. Do not silently make design decisions that belong in the spec.

---

## 6. Implement

Follow the plan. Follow `AGENTS.md` — architecture rules, React conventions, Rust/Tauri constraints, state management rules. These are hard constraints, not suggestions.

During implementation:

- Update `## Progress log` in the task file as you go
- Record any new assumptions in `## Assumptions`
- Record any blockers immediately in `## Blockers` — do not work around a blocker silently
- If the plan changes significantly, update `## Plan` to reflect reality
- Run `pnpm deps:validate` after touching cross-module imports

If an audit or spec turns out to be wrong or incomplete, update the document. The document should reflect reality at all times.

---

## 7. Validate

Before declaring the task done:

- Run `pnpm deps:validate` — must pass with zero architectural violations
- Verify each acceptance criterion in the spec (if one exists)
- Check that nothing was pushed, merged, or committed to the wrong branch

---

## 8. Update the audit

After any implementation that changes the observable state of the codebase, the relevant audit should be updated:

- Resolved issues marked as such (with branch/date reference)
- New issues discovered during implementation added
- If no audit exists for the area and the work was non-trivial, create one now

An audit that still lists fixed issues as open, or omits new problems discovered during implementation, misleads the next session.

---

## 9. Close out the task file

Complete `## Self-review` in the task file before ending the session (every question answered, verification outputs pasted). Task templates do not use a separate `## Handoff` section — the file is self-contained. Capture what was done, what was not, risks, and doc updates in **Decisions**, **Findings**, **Next steps**, and Self-review so the next session can start from the task file without reconstructing context.

---

## Allowed and disallowed workflow sequences

Not every task needs all five document types, but some combinations are never valid.

Documentation scales with scope. Trivial single-file fixes require no docs.

**Allowed sequences:**

| Sequence                                        | When it applies                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Research → Spec → Task → Implementation → Audit | Non-trivial feature with external technical dependencies                                 |
| Spec → Task → Implementation → Audit            | Non-trivial work, no external research needed                                            |
| Task → Implementation → Audit                   | Localised change with design choices but contained scope                                 |
| Implementation only                             | Trivial fix: single file, obviously correct, no design decisions, no cross-module impact |

**Disallowed sequences:**

| Sequence                                     | Why it is forbidden                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Research → Implementation (no spec)          | Research is input, not a spec — findings must be translated before code is written |
| Research → Task without spec                 | Same reason                                                                        |
| Spec → Implementation without task           | A spec in place means the work has enough scope to warrant tracking                |
| Implementation without task when spec exists | The spec demands it                                                                |

**Special case — research triggers spec requirement:**
If research files exist for the area being worked on and no spec exists, the spec must be written before implementation begins. Do not implement directly from research.

---

## When to skip steps

Steps can be skipped when there is a genuine reason, not by default.

| Step         | Acceptable reason to skip                                                 |
| ------------ | ------------------------------------------------------------------------- |
| Task file    | The change is trivial — single file, no design choices, obviously correct |
| Research     | Knowledge already captured in an existing research file or skill          |
| Audit (pre)  | Single isolated change with no cross-module impact                        |
| Spec         | Trivial fix with no design choices                                        |
| Skills       | No skill exists for the relevant domain                                   |
| Audit (post) | Trivial fix that does not change observable behavior                      |

When skipping steps on a non-trivial task, explicitly document the reason in the task file or commit message. Silence is unacceptable.
