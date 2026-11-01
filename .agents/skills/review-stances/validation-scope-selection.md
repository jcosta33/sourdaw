# Standing probes: validation scope, selection and failure reporting

Defects where a CI scope decision, test selector or failure reporter covers a different set of files or jobs than
the ones that actually run or fail: Playwright collects a file the planner never selects, a graph walk leaves its
requested root, a diagnostic launches from a checkout that lacks it, a decision needing only the API waits on a
clone, or a scheduled reporter cannot see a failing job. Each probe names the input to plant, the comparison to
make and the check that must go red. Baseline for every probe: revert the admission change and run the named
planner or workflow-contract spec; a green result means the spec does not guard this boundary.

## Standing probes

1. **Collector admission parity (#4854, #5056).** #4854's `scripts/prValidationScope.ts` used a
   `.spec.ts`/`.spec.tsx` predicate in `listSpecs` and argument validation while `playwright.config.ts` left
   Playwright's default `testMatch` (also `.test.*` and JS/TS variants), so `tests/e2e/new-default.test.ts`
   reached Playwright but not the required matrix. The first #5056 candidate reused Vitest's case-sensitive regex
   and a case-sensitive `__tests__` ignore, the reverse of the installed matcher, which accepts
   `tests/e2e/nested/fourth.TEST.ts` and ignores `tests/e2e/__TESTS__/ignored.test.ts`. Trace `testDir`,
   `testMatch` and `testIgnore` to the planner's filesystem inventory, changed-file classification and runner
   argument validation. In a disposable Git planner fixture plant one ordinary file for every admitted filename
   family, both case variants and one excluded path, invoke `plan` and compare with `playwright test --list` or
   the installed collector; each selected CLI argument matches only its intended file. Keep Vitest's
   case-sensitive collection contract separate.
2. **Direct, broad and deleted selection.** For a changed browser file prove direct selection. For a product or
   unknown path prove the complete non-smoke inventory reaches the matrix once, with the separate smoke and
   hardware rules intact. A deleted or moved-away file must still trigger broad coverage.
3. **Node-only tooling exemptions classify the complete diff (#4484 `4504a698`, #4932 `33c27947`, #4933
   `d03336ec`).** Those PRs added Node-only files without completing the opt-ins. Classify the actual diff,
   including root and nested specs, helpers and corpus inputs: known tooling keeps static and security checks with
   an empty browser matrix; mixed product, config and unknown paths keep broad browser coverage.
4. **A graph walk stays inside its requested root (#5284, #5291).** The installed affected-E2E graph loader passed a
   fixture's config filename but not the cruise API's parsed TypeScript configuration, so its resolver used the
   checkout's working directory as alias base and traversed checkout modules; the published probe asserted only the
   opaque selection. Run the actual installed producer against a distinct fixture root with aliased imports and
   require the graph to contain exactly the fixture sources with alias edges resolving to them, for explicit,
   absent and inherited `baseUrl`; malformed configuration stays fail-closed. #5291's first repair still followed
   a root-level shadow when implicit `paths` sat in a nested extended config: plant that shadow beside a real
   nested target importing a changed feature, keep surrounding imports valid, and require the producer to follow
   the declaring base or select full before traversal. A correct full-selection result cannot prove root scope.
5. **An advisory selector must run against a head that predates it (#5140).** The E2E shadow job launched its CLI
   from the candidate checkout; an older head such as #5119's `a36a2751182fadfb55bc5e4a45b7bd798d6bc489` has no
   shadow CLI and failed with `MODULE_NOT_FOUND` before writing a report. Run the real CLI against distinct Git
   checkouts: a candidate from before the capability, a trusted base control with its own dependencies, and the
   integration merge carrying the authoritative scope. An older head reports unsupported with the full inventory
   and zero measured reduction; a partial or malformed declared capability still fails, and no case writes
   `GITHUB_OUTPUT` or changes required Gate selection.
6. **Capability history spans every merge parent and binds the collection policy (#5206).** A path-limited default
   `git log` can prune the second parent when the merge tree matches an absent first parent: use full history and
   a real two-parent CLI fixture declaring the capability only on the second parent. Bind the integration merge's
   Playwright collection policy to the control revision before claiming a complete inventory: a later first-parent
   `testMatch` change can admit a file the control collector omits while selector and planner bytes match. Both
   cases fail closed; genuine older absence still reports unsupported with zero measured reduction.
7. **A declared capability must contain code (#5206).** A regular head-bound TypeScript capability with no
   statements (empty or comment-only) passes transpile diagnostics. In the real candidate/integration/control CLI
   fixture replace one declared capability with each code-free form and require a failed report before
   measurement, keeping the never-declared older head on its unsupported full-inventory route. This probes
   declaration admission, not execution of candidate code.
8. **An API-only scope decision needs no repository acquisition (#2700 `933159de5c`, #3119, #5818).** #2700 put
   checkout before changed-path filtering and #3119 moved it into reusable validation; #5818's run 40751724067
   cancelled during that fetch before filtering (the fetch latency itself is unproven). Enumerate every
   reusable-workflow caller with its event and effective permissions, and trace the pinned action's token, inline
   configuration, pagination and cleanup routes. Execute the actual filter entry and the inline resolver with
   mocked API pages and renamed files in an empty directory while denying subprocesses and network.
   Reintroducing checkout must fail the named repository-independence contract; missing verdicts and failed or
   skipped selected jobs must still fail the aggregates.
9. **A scheduled reporter must see every report-producing job (#5001; #3119, #3170).** #3119 fixed the reporter's
   `needs` list before #3170 added the separate `e2e-report` job, and the nightly split carried the list forward,
   so a merge or upload failure after a successful `e2e` was outside both `failure()` and `toJSON(needs)`. Trace
   every report-producing job to the reporter's direct `needs`, its job-level condition and the serialized
   payload. Give the actual reporter command a payload whose only failed entry is `e2e-report`, run it with issue
   creation stubbed, and require the body to name it; separately prove the condition admits the scheduled run and
   excludes other events. Removing `e2e-report` from the direct `needs` must fail the workflow contract check,
   while the scheduled-only condition and the deploy job's own dependency policy stay intact.
10. **A workflow comment about where a check runs must match every workflow (#3170 `f68bbf3c8a2`, #4854
    `14b7a8a4266`).** The nightly comment described CodeQL as absent from pull requests after #4854 added
    scope-selected CodeQL to the required Health gates workflow. Compare each such comment with the active
    triggers, job conditions and required Gate dependencies in every workflow that supplies the check; a comment
    describing one workflow must not imply the check is absent from the others.
