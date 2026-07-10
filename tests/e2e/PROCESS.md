# E2E Coverage Process — Sourdaw

> **Resume instruction:** To continue e2e coverage work, say:
> *"Continue e2e coverage — read tests/e2e/PROCESS.md and tests/e2e/COVERAGE.md, then pick up the next incomplete batch."*

This document is the persistent playbook for achieving full-app e2e coverage.
Each session reads it, finds the next incomplete batch in `COVERAGE.md`, and
works through the full PR lifecycle below.

---

## Architecture decisions

- **Framework:** Playwright (already installed). Config: `playwright.config.ts`.
- **Runtime target:** Browser-only (`pnpm dev` at `localhost:5173`). Tauri-only
  flows (native file dialogs, plugin hosting) are marked `[TAURI-ONLY]` in the
  coverage manifest and skipped.
- **Test depth:** Full user journeys — every route, major interaction flow,
  dialog, and panel. Not exhaustive per-button edge cases.
- **Selectors:** Accessibility-driven (`role`, `aria-label`, `aria-pressed`,
  text). Matches existing spec conventions. Prefer semantic locators over
  CSS selectors or `data-testid` (unless already present).
- **Shared harness:** All tests use `setupWorkspace` + `launch_new_project` (or
  `launch_from_template`) from `./e2eUtils`. Follow the pattern in existing specs.

---

## Batch lifecycle (one PR per batch)

Each batch follows this exact sequence:

### 1. Branch
```bash
git checkout main
git pull origin main
git checkout -b e2e/batch-NN-<slug>
```
Example: `e2e/batch-01-launch-project-flows`

### 2. Write specs
- Create `.spec.ts` file(s) in `tests/e2e/`.
- Follow existing spec conventions (imports from `./e2eUtils`, `beforeEach`
  setup, `test.describe` blocks with clear names).
- One `test()` per user-flow scenario. Group related flows in one `.spec.ts`.
- Use `expect()` assertions, not just `waitFor`. Tests should **verify** state,
  not just check that elements exist.

### 3. Run and verify
```bash
pnpm test:e2e -- --grep "<spec name or describe block>"
```
- Every test must pass locally before proceeding.
- If a test reveals a **bug**: fix the bug in the same branch (see Bug Fix
  Policy below).
- If a test is **flaky**: stabilize it before merging (no `.skip` without a
  tracked issue note in COVERAGE.md).

### 4. Commit
```bash
git add tests/e2e/<spec>.spec.ts [src/path/to/fix.ts]
git commit -m "test(e2e): <batch description>"
```
- If bug fixes are included, add a second commit:
  `fix(<area>): <fix description>`

### 5. Push and open PR
```bash
git push -u origin e2e/batch-NN-<slug>
gh pr create --title "test(e2e): <batch>" --body "<description>"
```
- PR body should list what's covered and any bugs fixed.

### 6. Revolver review (subagent-driven)
Spawn reviewer subagents one at a time, each with a distinct adversarial
stance from the rotation below. After each reviewer:
1. Collect findings.
2. Accept findings with concrete evidence; reject refuted ones with a reason.
3. Apply accepted fixes.
4. Commit fixes.
5. The next reviewer sees the revised code.

**Stance pool (minimum 6, rotate one per round):**
1. **Requirement coverage** — does each test verify a real user journey end-to-end?
2. **Flakiness/realism** — will these tests pass reliably in CI? Timeouts,
   races, selector fragility, missing `waitFor`?
3. **Selector robustness** — are locators accessible and stable? Brittle CSS
   paths, positional selectors, text that may change?
4. **Assertion quality** — do tests assert actual behavior, not just
   existence? Are wait conditions meaningful?
5. **Test isolation** — does each test start from clean state? Cross-test
   contamination? localStorage/session pollution?
6. **Bug fix correctness** — if fixes were included, are they correct,
   complete, and don't introduce regressions?

Additional stances by risk:
- **Accessibility** — does the test surface verify a11y properties correctly?
- **Architecture** — do any fixes respect module boundaries?

**Cycle rules:**
- One full rotation (all 6 stances) is the minimum.
- Repeat up to 3 cycles.
- Stop when a full rotation surfaces no new accepted findings.

### 7. Address findings & merge
- Apply all accepted fixes from the review cycle.
- Push final state.
- Merge the PR:
```bash
gh pr merge --squash --delete-branch
```
- Return to `main` and pull.

### 8. Update COVERAGE.md
- Mark completed items in the checklist.
- Note any deferred/skipped items with reason.
- Record bugs found and fixed.

---

## Bug Fix Policy

When a test surfaces a real bug:

1. **Reproduce first.** Confirm the bug exists before fixing.
2. **Minimal fix.** Fix the root cause, not the symptom. Don't broaden scope.
3. **Same branch, separate commit.** `fix(<area>): <description>` after the
   test commit.
4. **Verify the fix.** Re-run the test. Run `pnpm typecheck` and
   `pnpm deps:validate` if source files changed.
5. **Document in COVERAGE.md.** Under the batch entry, note: bug description,
   root cause, fix summary.
6. **Flag in PR description.** Reviewer subagents scrutinize fixes with the
   "Bug fix correctness" stance.

**Do NOT fix:**
- Pre-existing architecture issues unrelated to the test surface.
- Cosmetic issues (naming, formatting) — note in COVERAGE.md instead.
- Tauri-only issues (can't test browser-side).

---

## Session resume protocol

When resuming in a new session:

1. Read `tests/e2e/PROCESS.md` (this file).
2. Read `tests/e2e/COVERAGE.md` — find the first batch with unchecked items.
3. Check git state: `git status`, `git branch`, confirm on `main` and clean.
4. If a previous batch's branch is unmerged, finish it first (review → merge).
5. Start the next batch from step 1 of the Batch lifecycle.

**Current session state** is tracked at the bottom of `COVERAGE.md` in the
`## Session Log` section.

---

## Conventions reference

### Test file naming
```
tests/e2e/<featureArea>.spec.ts
```

### Standard test structure
```typescript
import { test, expect } from '@playwright/test';
import { setupWorkspace, launch_new_project, wait_for_workspace_ready } from './e2eUtils';

test.describe('Feature Area Name', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Can <do something meaningful>', async ({ page }) => {
        // Act
        // Assert
    });
});
```

### Template-based tests (when pre-populated tracks are needed)
```typescript
test.beforeEach(async ({ page }) => {
    await setupWorkspace(page);
    await launch_from_template({ page, template_name: /EDM/i });
});
```

### Keyboard shortcuts
```typescript
// Mod key = Meta on macOS, Control on others
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
await page.keyboard.press(`${mod}+k`);
```
