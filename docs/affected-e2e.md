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
Every other path under `scripts/` (including `scripts/__tests__/`), `.agents/`, top-level
`release/*.json`, Markdown outside `src/`, `public/`, and `tests/`, and per-vendor agent guidance
(`AGENTS.md` and its vendor copies) under `src/` and `tests/` selects no browser suite but
keeps the broad non-browser profile, so its unit, type, Rust, and WASM checks still run. So do Rust
sources and Cargo manifests (`crates/**/*.rs`, `crates/**/Cargo.toml`, root `Cargo.toml`, `Cargo.lock`,
`rust-toolchain.toml`), `evidence/**`, and `.github/workflows/nightly.yml`. Rust reaches the browser
only as compiled WASM under `public/wasm` and `src/modules/AudioEngine/wasm`, which select browser
coverage as their own changed paths while `wasm:verify` rejects a Rust change without regenerated
artifacts; other files under `crates/` stay on the product route because a spec may read them directly.
`evidence/**` is read only by Vitest specs and scripts, and the nightly workflow never runs on a pull
request; every other workflow shapes PR CI and keeps its own route. Generator and
build scripts reach the browser only through their outputs, which land under `src/` or `public/` and
select browser coverage there; a harness helper the browser imports from `scripts/` is proved by the
nightly full train. Vitest-collected spec files under `src/` likewise select no browser suite and
keep the broad non-browser profile: the production dependency graph excludes them and no browser
harness loads them. They are not product paths, so a feature presentation edited with its colocated
spec can still narrow. Non-spec files under `__tests__/` stay on the product route, because a browser
harness page may load them. Configuration, dependency, workflow, and product paths keep their own routes.
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

## Coverage map

Nightly also records which app source files each browser spec executes, the data test impact
analysis needs. The app loads nearly every module at boot, so a loaded file says nothing about a
spec; a file counts as executed only when a function other than its top-level module body ran.
The `e2e-coverage` job collects it with Chromium JS coverage through the fixture in
`tests/e2e/e2eTest.ts`, which is active only when `SOURDAW_E2E_COVERAGE_DIR` is set and writes one
record per test. It runs apart from the gating `e2e` train because coverage slows the browser and
could push timing-bounded specs over budget; test failures there gate nothing, but a shard fails
unless at least one of its records is complete and passed, because a fixture broken for every test
still writes one incomplete record per test.

A test's record is complete only when the test used the fixture page, that page's coverage was
collected, and no other page ran while the test did. Coverage reaches neither other pages nor
workers and worklets, so a consumer must treat code that runs there as unmapped. Every record is
written before the test body as incomplete, so a test whose teardown never runs leaves that record
behind.

`scripts/e2eCoverageMap.ts` folds the records into `e2e-coverage-map.json` (format
`e2e-coverage-map-v1`) for one commit: the sorted spec inventory, `alwaysSelect`, and for each
executed file its Git blob at that commit and the indices of the specs that executed it. Only
complete, passed records contribute files. A spec with any incomplete, failed, timed-out,
interrupted, or skipped record, and every inventoried spec without a record, is in `alwaysSelect`,
so a consumer never narrows on evidence that was not collected. The blob lets a consumer detect a
file that changed since the map was built.

## Coverage selection

When pull-request planning would otherwise select the full browser suite because of changed
product files, `scripts/e2eCoverageSelection.ts` may narrow it with the newest map, a form of
test impact analysis at function-body granularity. Every existing route keeps its result: owner
narrowing, when it applies, is kept, and directly changed specs are still selected beside the
narrowed set. The plan selects, for the changed files, the union of the specs that executed each
file, the map's `alwaysSelect`, and every collected spec the map does not list. Smoke still runs
for every browser plan, and Browser AI hardware admission follows the selected specs.

It narrows only when all of these hold; otherwise it keeps the full suite and records which rule
decided:

- The scope job's fetch step retrieved a map that a scheduled or dispatched nightly run of
  `.github/workflows/nightly.yml` on this repository's `main` uploaded, whose commit is that run's
  head, and that is at most three days old. Artifacts from pull-request runs, forks, other
  workflows, or other branches are never read.
- No changed product path is deleted, renamed, copied, or retyped, and each is a non-declaration
  TypeScript source under `src/`. Stylesheets, JSON, assets, and paths outside `src/` keep the full
  suite.
- No changed file is reachable from a worker or audio-worklet entry: a `new Worker(new URL(…))`
  target or any script imported by URL (`?worker`, `?worker&url`, `?url`). Page coverage cannot
  see those threads, and an opaque runtime edge leaves the entry set unproven.
- Each changed file's blob at the merge-base equals the map's blob, so the map describes the code
  being changed. A file the map does not list must exist unchanged at the map commit; no browser
  spec then executed any of its functions.
- The merge-base and head contents parse, their JSX pragma comments (`@jsx`, `@jsxFrag`,
  `@jsxImportSource`, `@jsxRuntime`) match, and their parse trees agree outside function bodies.
  Each side is flattened to its syntax nodes in pre-order and its tokens by kind and exact text, so
  comments and whitespace drop out while string and template-literal contents, including blank
  lines inside a template, still count, and a line break that automatic semicolon insertion parses
  differently changes the tree. Pragma comments count because the compilers apply them per file.
  Type-only declarations are dropped from both sides, and the outside comparison collapses each
  function, method, constructor, or accessor body to one placeholder. Equal full trees are a
  comment or type-only change; trees equal only outside bodies are a body change. Comparing trees
  rather than diff lines means a comment toggle that revives or retires top-level code
  stays full, whatever lines the diff touches. A body change can affect behaviour only when the
  function runs, and the map lists every spec in which some function of that file ran. Top-level
  changes stay full: module bodies run at boot in every spec, and top-level values reach functions
  in other files the map does not attribute to this one. Imports, signatures, parameters, class
  property initializers, decorators, enums, and namespaces count as top level.

A stale map can miss a call path created on `main` after the map commit, from an unchanged caller
into a changed function no mapped spec reached before; the nightly full train remains the
unconditional backstop that catches it.
