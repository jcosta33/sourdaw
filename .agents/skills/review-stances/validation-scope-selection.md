# Standing probes: validation scope, selection and failure reporting

Defects where a CI scope decision, test selector or failure reporter covers a different set of files or jobs than
the ones that actually run or fail: Playwright collects a file the planner never selects, a graph walk leaves its
requested root, a decision needing only the API waits on a clone, a scheduled reporter cannot see a failing job, or
a workflow comment misstates where a check runs. Each probe names the input to plant, the comparison to make and the
check that must go red. Baseline for every probe: revert the admission change and run the named planner or
workflow-contract spec under `pnpm guard --profile focused -- pnpm test:run <spec>`; a green result means the spec
does not guard this boundary.

## Standing probes

1. **Collector admission parity (#4854, #5056).** The planner (`scripts/prValidationScope.ts`) must admit exactly
   the files Playwright collects. A `.spec.ts`/`.spec.tsx` predicate in `listSpecs` and argument validation misses
   files Playwright's default `testMatch` collects (also `.test.*` and JS/TS variants), such as
   `tests/e2e/new-default.test.ts`; a case-sensitive regex and a case-sensitive `__tests__` ignore reverse the
   installed matcher, which accepts `tests/e2e/nested/fourth.TEST.ts` and ignores
   `tests/e2e/__TESTS__/ignored.test.ts`. Trace `testDir`, `testMatch` and `testIgnore` in `playwright.config.ts`
   to the planner's filesystem inventory, changed-file classification and runner argument validation. In a
   disposable Git planner fixture in `scripts/__tests__/prValidationScope.spec.ts`, plant one ordinary file for
   every admitted filename family, both case variants and one excluded path, invoke `plan` and compare with the
   installed collector's matcher; each selected CLI argument matches only its intended file. Keep Vitest's
   case-sensitive collection contract separate.
2. **Direct, broad and deleted selection.** For a changed browser file prove direct selection. For a product or
   unknown path prove the complete non-smoke inventory reaches the matrix once, with the separate smoke and
   hardware rules intact. A deleted or moved-away product file must still trigger broad coverage: in a
   `prValidationScope.spec.ts` planner fixture, delete and separately rename a product file and require the full
   browser suite; classifying either like an in-place edit must turn that case red.
3. **Node-only tooling exemptions classify the complete diff (#4484, #4932, #4933).** A diff that adds Node-only
   files without completing the opt-ins narrows coverage it should keep. Classify the actual diff, including root
   and nested specs, helpers and corpus inputs: known tooling keeps static and security checks with an empty
   browser matrix; mixed product, config and unknown paths keep broad browser coverage.
4. **A graph walk stays inside its requested root (#5284, #5291).** A loader that passes a fixture's config
   filename but not the parsed TypeScript configuration lets the resolver use the checkout's working directory as
   alias base and traverse checkout modules, while an assertion on the opaque selection stays green. Run the
   installed producer (`scripts/e2eAffectedGraph.ts`) against a distinct fixture root with aliased imports and
   require the graph to contain exactly the fixture sources with alias edges resolving to them, for explicit,
   absent and inherited `baseUrl`; malformed configuration stays fail-closed. When implicit `paths` sit in a
   nested extended config, plant a root-level shadow beside a real nested target importing a changed feature,
   keep surrounding imports valid, and require the producer to follow the declaring base or select full before
   traversal ("refuses inherited implicit alias bases before a shadow graph can narrow selection" in
   `scripts/__tests__/e2eAffectedGraph.spec.ts`). Inherited explicit `baseUrl` coverage alone does not establish
   implicit alias inheritance, and a correct full-selection result cannot prove root scope.
5. **An API-only scope decision needs no repository acquisition (#2700, #3119, #5818).** A checkout placed before
   changed-path filtering makes the scope decision wait on, and be cancellable during, a fetch it does not need.
   Enumerate every reusable-workflow caller with its event and effective permissions, and trace the pinned
   action's token, inline configuration, pagination and cleanup routes. Execute the actual filter entry and the
   inline resolver with mocked API pages and renamed files in an empty directory while denying subprocesses and
   network. Reintroducing checkout must fail "resolves PR scope without a repository checkout for every validation
   caller" in `scripts/__tests__/healthGatesWorkflow.spec.ts`; missing verdicts and failed or skipped selected jobs
   must still fail the aggregates.
6. **A scheduled reporter must see every report-producing job (#5001; #3119, #3170).** A job added after the
   reporter's `needs` list was written (`e2e-report` beside `e2e`) leaves a merge or upload failure outside both
   `failure()` and `toJSON(needs)`. Trace every report-producing job in `.github/workflows/nightly.yml` to the
   reporter's direct `needs`, its job-level condition and the serialized payload. Give the actual reporter
   command a payload whose only failed entry is `e2e-report`, run it with issue creation stubbed, and require the
   body to name it; separately prove the condition admits the scheduled run and excludes other events. Removing
   `e2e-report` from the direct `needs` must fail "reports a sole nightly E2E report failure on scheduled runs" in
   `scripts/__tests__/healthGatesWorkflow.spec.ts`, while the scheduled-only condition and the deploy job's own
   dependency policy stay intact.
7. **A workflow comment about where a check runs must match every workflow (#3170, #4854).** A comment that
   describes CodeQL as absent from pull requests contradicts scope-selected CodeQL in the required Health gates
   workflow. Compare each such comment with the active triggers, job conditions and required `Gate` dependencies
   in every workflow that supplies the check; a comment describing one workflow must not imply the check is
   absent from the others.

8. **CI's declared worker limit must reach the isolated child (#3170, #3119, #5274).** The unit workflows
   declared four workers despite the repository's two-worker policy, and the isolated launcher separately
   imposed four in its clean child environment. Trace both workflow callers through `runIsolatedUnitShard.ts`
   to `vite.config.ts`; assert both workflows and the actual spawned shard environment use at most two, while
   sequential guard specs use one and the four-way matrix remains intact. Raising either workflow or the
   launcher to four must fail `scripts/__tests__/healthGatesWorkflow.spec.ts` or
   `scripts/__tests__/runIsolatedUnitShard.spec.ts`, respectively.

## Retired lessons

- Tooling paths missing from the browser selector or validation path filter (#4854, #4902, #4484, #4932, #4933) →
  enforced by `scripts/__tests__/prValidationScope.spec.ts` "keeps known review tooling security checked without
  browser execution" and "admits exact review helper source and matching spec %s".
