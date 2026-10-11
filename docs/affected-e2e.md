# Affected browser selection

The required pull-request scope step emits explicit Playwright filenames in
`pr-validation-scope.json`. Its browser matrix runs those files; the validation workflow runs
`tests/e2e/smoke.spec.ts` separately whenever browser work is selected. Nightly runs the full suite.

For a clean checkout of the candidate head or its integration merge, the planner compares immutable
base and head commits. It includes any additional paths changed by the integration merge. A changed
feature presentation file can select fewer browser suites only when dependency-cruiser resolves its
production file graph and every reverse-transitive consumer remains in a feature presentation tree.
The two composition endpoints, `src/app/bootstrap.ts` and
`src/modules/WorkspaceShell/presentations/views/AppShell.tsx`, stop traversal when reached from a
feature; editing either directly selects the full suite. The app shell imports feature panels to
mount them, so continuing reverse traversal through it would make every panel change appear to
affect the whole application. A consumer in another layer, an uncurated owner, or an opaque dynamic
import widens to the full suite. Business logic, stores, engine code, shared UI, configuration,
dependency changes, and unknown paths likewise select full coverage. Deletions and renames select
full coverage because the current graph cannot reconstruct their old consumer edges.

`scripts/e2eSuiteOwners.json` lists **filenames**, with one or more feature owners per suite. Add an
owner only after reading the suite's assertions and tracing them to the owning feature presentation.
When a mapped suite begins exercising another feature, add that owner or remove its mapping. A new or
unmapped spec is always selected; mixed workflows may deliberately remain unmapped. A missing,
duplicate, or invalid mapped filename invalidates narrow selection and selects the full suite. The
manifest does not infer ownership from a filename prefix. Selected Browser AI proofs also trigger
the separate hardware admission job; an unowned browser-AI proof stays selected and triggers it.

Direct edits to a collected E2E spec select that spec, alongside any browser work selected for other
changed paths. Documentation and recognized review tooling keep their existing no-browser route.
The planner retains the broad validation profile for product changes, CodeQL selection, anchored
literal filenames at the runner boundary, and the required Gate's selected-job checks. A failed
graph or missing dependency installation must never produce an empty or silently narrowed matrix.

This follows the affected-task pattern of comparing Git changes with reverse dependencies described
by [Nx](https://nx.dev/docs/features/ci-features/affected), using the already installed
dependency-cruiser rather than adopting Nx. Google's [TAP account](https://abseil.io/resources/swe-book/html/ch23.html)
describes the value of a fast selected presubmit plus later, broader testing. Playwright calls its
own [changed-test selection](https://playwright.dev/docs/ci#fail-fast) heuristic and recommends a
subsequent full run. Here, explicit suite inputs, conservative widening, and nightly full coverage
provide that broader check.
