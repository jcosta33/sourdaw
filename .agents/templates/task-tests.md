# {{title}}

## Metadata

- Slug: {{slug}}
- Agent: {{agent}}
- Branch: {{branch}}
- Base: {{baseBranch}}
- Worktree: {{worktreePath}}
- Created: {{createdAt}}
- Status: active
- Type: tests
- Team: {{team}}

---

> **READ `docs/06-testing.md` IN FULL BEFORE TOUCHING ANY TEST.** It defines the philosophy, scope, layer-by-layer examples, mock patterns, and anti-patterns for this codebase. Every test you write or modify must conform to it. If a pattern you need is not covered there, surface it as a Finding — do not improvise.

This task type covers all testing work: writing new tests for untested code, improving existing tests, closing coverage gaps, de-flaking, tightening assertions, aligning old tests with the current guide, and deleting tests that are testing the wrong thing.

---

## Mode

Which kind of testing work is this session? Check one or more — and for each, state which files are in scope in the Target files table below.

- [ ] **New tests** — source files that currently have no spec
- [ ] **Close coverage gaps** — existing specs that don't cover every exported function or edge case
- [ ] **Improve existing tests** — tighten assertions, fix mock hygiene, remove anti-patterns, align with `docs/06-testing.md`
- [ ] **De-flake** — tests that fail intermittently (real time deps, shared state, test ordering)
- [ ] **Delete wrong tests** — tests that assert implementation rather than behaviour, or test the framework/library instead of our code

---

## Objective

Which files/modules are being worked on in this session, and what the testing goal is. One paragraph maximum. Be specific — not "the Arrangement module" but "write new specs for addTrack.ts and removeTrack.ts; close gaps in existing trackTemplate.spec.ts (missing the empty-storage path)".

---

## Scope

{{teamScope}}

---

## Target files

List every source file whose spec will be created, modified, or deleted in this session. One row per file.

| Source file | Spec status   | Action                             | Layer | Notes |
| ----------- | ------------- | ---------------------------------- | ----- | ----- |
|             | none / exists | create / extend / rewrite / delete |       |       |

- **Spec status:** `none` if no spec exists yet, `exists` if a spec is already present.
- **Action:** `create` (new spec), `extend` (add missing cases to existing spec), `rewrite` (existing spec is structurally wrong and must be replaced), `delete` (existing spec is testing the wrong thing and should be removed, optionally replaced).
- **Layer** is one of: use case, repository, transformer, validator, service, store, event subscriber, presentation hook, component, engine class.

---

## Shared test utilities to create or extend

Test utilities that are new to this session. A utility is shared if more than one spec file uses it.

| Utility | Location                                    | Purpose |
| ------- | ------------------------------------------- | ------- |
|         | `<Module>/_tests/` or `src/helpers/_tests/` |         |

Examples: dummy factories (`TrackDummy`, `ClipDummy`), EventBus mock, Container reset helper, AudioContext mock extensions, Tauri `invoke` mock helpers.

---

## Out of scope

Be explicit about what you are NOT testing in this session:

- Integration tests — never in this session type
- E2E / Playwright — never in this session type
- Real Web Audio rendering, real Tauri IPC, real Automerge — always mocked
- Files not listed in the Target files table above — do not drift

---

## Constraints

- Read `docs/06-testing.md` fully before touching any file
- Work only inside this worktree
- Do not switch branches unless explicitly instructed
- Do not modify production code to make it "more testable" without documenting the change in Findings and justifying why the existing shape could not be tested as-is
- Every test file uses Vitest, `@testing-library/react` for components, `@testing-library/jest-dom` matchers (loaded via `src/setupTests.ts`)
- One test file per source file, co-located
- One `describe` per exported function, `it` blocks prefixed with `should` / `should not`
- Mock at the module boundary with `vi.mock(...)` — do not mock internal functions of the file under test
- Do not mock `DomainEvent` or `AppError` subclasses — construct them for real
- No real time dependencies: use `vi.useFakeTimers()` or explicit values for `currentTime` / `Date.now()`
- When extending or rewriting an existing spec, first run it (`pnpm test:run <path>`) to confirm its current state; do not assume green
- Run `pnpm test:run <path>` after every file — all tests in scope must pass before moving to the next
- Run `pnpm test:run` on the full suite before handoff — nothing outside your scope should have regressed
- Run `pnpm deps:validate` before handoff — test work must not introduce architectural violations
- Run `pnpm typecheck` before handoff — must be clean

---

## Progress checklist

- [ ] Read `docs/06-testing.md` in full
- [ ] Mode(s) selected above
- [ ] Target files table filled in (spec status, action, layer)
- [ ] Shared test utilities table filled in
- [ ] For each `extend`/`rewrite`/`delete` target: run the existing spec first and record its baseline
- [ ] Identify any production code that resists testing and document in Findings before refactoring
- [ ] Work through files one at a time, running `pnpm test:run <path>` after each
- [ ] All specs in scope are green
- [ ] Full suite `pnpm test:run` passes — nothing outside scope regressed
- [ ] `pnpm deps:validate` passes with zero new violations
- [ ] `pnpm typecheck` passes
- [ ] Self-review: Verification outputs pasted
- [ ] Self-review: Conformance to testing guide answered
- [ ] Self-review: Test quality answered
- [ ] Self-review: Mock hygiene answered
- [ ] Self-review: Isolation answered
- [ ] Self-review: Coverage of target answered
- [ ] Self-review: Architecture answered
- [ ] Self-review: Production code changes answered
- [ ] Self-review: Completeness answered
- [ ] Self-review: Mode-specific sections answered (extended/rewrote/deleted/de-flaked — whichever apply)
- [ ] Handoff written

---

## Decisions

Key decisions made during this session and why. Include any decision to refactor production code for testability, with before/after and justification.

- ***

## Findings

Codebase discoveries worth preserving. In particular:

- Source files that were hard to unit-test (hidden singletons, module-level side effects, etc.) — these are architectural issues, log them here
- Gaps in `docs/06-testing.md` where you had to improvise — these should feed back into the testing guide
- Missing seams (e.g. a repository that doesn't accept injected storage) — log as a request for the owning team

- ***

## Assumptions

Things assumed to be true that were not explicitly confirmed. Mark each as `[pending]` or `[confirmed]`.

- [pending]

---

## Blockers

Anything preventing progress. What is needed to unblock.

- ***

## Next steps

Concrete starting points for the next session if this one ends incomplete. List the remaining files from the Target table that still need work, including any that were partially done (e.g. "extended but the component tests are still missing").

- ***

## Self-review

Before writing the Handoff, stop. Act as a nitpicky senior engineer reviewing these tests as if you didn't write them. You are looking for tests that will rot — flaky tests, tests that re-assert mocks, tests that test the framework instead of the code. Read every spec adversarially.

> **Hard gate.** The Handoff stays empty until every question below has a written answer directly beneath it. An unanswered question is a skipped check. A Handoff written with unanswered Self-review questions is an invalid session output. If you cannot point to a specific file/line/requirement for a finding, do not pad the list.

### Verification outputs (paste actual command output — do not paraphrase)

- `git status` →
- `pnpm test:run` (last line):
- `pnpm deps:validate` (last line):
- `pnpm typecheck` (last line):

**Conformance to the testing guide**

- Did you read `docs/06-testing.md` in full? Open it now and scroll through each section while checking your work.
- Are your examples structurally identical to the examples in the guide for each layer, or did you invent your own shape?
- Did you use any of the anti-patterns listed in §9 of the guide? React Query wrappers, snapshot tests on dynamic content, real time dependencies, leaked mock state, reliance on the Container's lazy proxy? Remove them.

**Test quality**

- Does each test have a single clear reason to fail? If a test has multiple unrelated assertions, split it.
- Are your `it` descriptions written as `should ...` / `should not ...` and do they describe the behaviour, not the implementation?
- Are you asserting on behaviour (what the function does) or on implementation (what functions it called internally)? For use cases, asserting that a repository mock was called is correct — that is the use case's contract. For a transformer, assert on the return value only.
- Are you testing the happy path AND at least one failure / edge path per exported function?

**Mock hygiene**

- Did you mock anything you should have constructed for real? `DomainEvent` and `AppError` subclasses must be real.
- Did you mock internals of the file under test? That is wrong — only mock at module boundaries.
- Does every `beforeEach` reset all mocks (`vi.resetAllMocks()` or explicit resets)? Test isolation is non-negotiable.
- Is any mock shared via mutable module-level state across tests? Fix it — each test sets up its own.

**Isolation**

- Can every test file run in isolation without the others? Run `pnpm test:run <single-file>` for each and confirm.
- Does any test depend on test ordering within its `describe`? Fix it.
- Does any test depend on real time, real timers, real network, real localStorage, real AudioContext, or real Tauri `invoke`? Fix it.

**Coverage of the target**

- For each file in your Target files table, did you cover every exported function?
- Did you test the clamping / validation paths, not just the happy path?
- For components, did you test both rendering AND user interactions?

**Architecture**

- Run `pnpm deps:validate` right now. Did your test files introduce any new architectural violations (e.g. a spec importing from another module's internals)?
- Did you create any `index.ts` files in `_tests/` folders? Don't.
- Does `pnpm typecheck` pass cleanly?

**Production code changes**

- Did you modify any source file under test? If yes, is the change documented in Decisions with a justification? Is the change minimal (a constructor parameter, an injectable dep) rather than a redesign?
- If you refactored for testability, did the original tests (if any) still pass after the refactor?

**Completeness**

- Are any `it.skip` / `it.todo` / `describe.skip` blocks left in your files? Remove or convert them to proper tests.
- Is any test marked `it.only`? Remove.

**If you extended existing specs**

- Do the original tests still pass unchanged? If you had to modify them to add new ones, was the original test wrong, or did you just make them harder to read?
- Did you keep the existing file's conventions (imports, setup, naming) instead of mixing styles?

**If you rewrote existing specs**

- Is the old behaviour coverage fully preserved? Line-by-line: for every `it` block you removed, is there an equivalent or better `it` in the new file?
- If coverage was deliberately dropped, is it documented in Decisions with justification?

**If you deleted specs**

- Is each deletion justified in Decisions (e.g. "was asserting implementation details", "was testing the framework")?
- If the underlying source file still exists and is still exported, did you leave behind a gap? Either replace the deleted spec or add the file to a follow-up Next steps entry.

**If you de-flaked**

- Can you name the specific source of non-determinism you fixed (real timer, shared mutable state, test ordering dependency, race on async work)?
- Did you re-run the affected test at least 10 times in a row to confirm it is now stable?

Only when every answer above is written should you write the Handoff.

## Handoff

> If any question in Self-review above is unanswered, stop and fill those in first. Do not write the Handoff before the Self-review is complete.

Summary for the next session or reviewer.

### Done:

### Not done:

### Watch out for:

### Docs updated:
