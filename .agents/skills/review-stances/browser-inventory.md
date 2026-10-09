# Lesson library: browser test inventory

Use this lesson when a change selects browser files, partitions their execution, or validates file arguments passed to Playwright.

## Standing probe

- Trace Playwright's configured `testDir`, `testMatch`, and `testIgnore` to the planner's filesystem inventory, changed-file classification, and runner argument validation. Plant one ordinary file for every admitted filename family and one excluded path, then compare the emitted plan with `playwright test --list` or the installed runner's collector. Require each selected CLI argument to match only its intended file.
- For a changed browser file, prove direct selection. For a product or unknown path, prove that the complete non-smoke inventory reaches the matrix once, with the separate smoke and hardware rules intact. A deleted or moved-away file must still trigger broad coverage.
- For explicit Node-only tooling exemptions, classify the complete actual diff, including root and nested specs, helpers, and corpus inputs. Known tooling must keep static and security checks with an empty browser matrix; mixed product, config, and unknown paths must retain broad browser coverage. PRs #4484 (`4504a698`), #4932 (`33c27947`), and #4933 (`d03336ec`) added Node-only files without completing those opt-ins; the historical reviewer stance and tier are unavailable.
- Apply the standard mechanical regression probe: revert the admission change and run the named planner spec. A green result means the spec does not guard this boundary.

## Escape lesson from PR #4854

PR #4854 introduced `scripts/prValidationScope.ts` with a `.spec.ts`/`.spec.tsx` predicate in both `listSpecs` and selected argument validation. `playwright.config.ts` left Playwright's default `testMatch` in force, which also admits `.test.*` and JS/TS variants. A new `tests/e2e/new-default.test.ts` therefore reached Playwright but did not enter the required PR matrix. The missing review probe was a filename-admission comparison from Playwright's collector through planning to execution arguments; existing planner fixtures used only `.spec.ts` names. A disposable Git fixture adding `.test.ts` and invoking `plan` exposes the omission before browser launch.

## Pre-merge catch in PR #5056

The first PR #5056 candidate and its author checks reused Vitest's case-sensitive filename regex for Playwright's default glob and matched `__tests__` with a case-sensitive ignore regex. Playwright's installed matcher accepts `tests/e2e/nested/fourth.TEST.ts` and ignores `tests/e2e/__TESTS__/ignored.test.ts`; the candidate planner did the reverse. Independent review under the collector-admission-parity stance detected this before merge and requested the repair. Plant both case variants in a disposable Git planner fixture, compare with the installed Playwright matcher, and prove direct selection, broad inventory, and literal runner arguments. Keep Vitest's case-sensitive collection contract separate.

## Escape lesson from PR #5140

PR #5140 added an advisory E2E shadow job but launched its CLI from the pull request's candidate checkout. An older head such as PR #5119's `a36a2751182fadfb55bc5e4a45b7bd798d6bc489` has no shadow CLI, so the step failed with `MODULE_NOT_FOUND` before it could write a report. The final review's candidate-control stance probed Gate dependency isolation, not whether a pre-feature head could launch the diagnostic; its matrix and inventory stance used a current-head fixture. For a new advisory selector, run the real CLI against distinct Git checkouts: a candidate from before the capability, a trusted base control with its own dependencies, and the integration merge carrying the authoritative scope. Require an older head to report unsupported with the full inventory and zero measured reduction; a partial or malformed declared capability must still fail, and no case may write `GITHUB_OUTPUT` or change required Gate selection.
