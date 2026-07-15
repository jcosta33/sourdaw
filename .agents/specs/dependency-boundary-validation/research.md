---
type: research
id: RESEARCH-dependency-boundary-validation
title: Dependency boundary validation research
status: current
owner: The Sourdaw team
sources:
  - code:../../../.dependency-cruiser.cjs
  - code:../../../scripts/check-dependency-boundaries.mjs
  - code:../../../.dependency-cruiser.types.cjs
  - code:../../../.dependency-cruiser.tests.cjs
  - code:../../../package.json
---

# Research: dependency boundary validation

## Promoted evidence provenance

This ledger is the durable disposition record for the six transient sources read for
this promotion. Coverage is source-complete for the three dedicated no-orphans
records and deliberately slice-only for the three broader records. It contains no
links to transient artifacts.

| Source ID and name | Date or capture | Status captured | Coverage and disposition |
| --- | --- | --- | --- |
| `INV-depcruiser-no-orphans-overexclusion-2026-06-30` — Dependency-cruiser no-orphans over-exclusion inventory | 2026-06-30 | current | Complete no-orphans inventory; delete after merge. |
| `TASK-depcruiser-no-orphans-decision-gate` — Depcruiser No-Orphans Decision Gate | capture 2026-07-15 | blocked | Complete decision-gate packet; delete after merge. |
| `REVIEW-depcruiser-no-orphans-decision-gate` — Depcruiser No-Orphans Decision Gate review | capture 2026-07-15 | blocked | Complete review record; delete after merge. |
| `FINDING-depcruiser-laundering-gaps` — dep-cruiser enforces value edges, not laundering paths — gaps an adversarial review proved | 2026-06-16 | accepted | No-orphans slice only; retain for its other laundering gaps. |
| `FINDING-depcruiser-warn-backlog` — Two dependency-cruiser rules landed at warn pending a real cleanup pass | 2026-06-16 | accepted | No-orphans slice only; retain for its other warn-backlog material. |
| `INV-deadcode` — Dead-code map (knip) inventory | 2026-06-13 | open | No-orphans slice only; retain for its Knip/dead-code material. |

### Dedicated source: no-orphans over-exclusion inventory

Coverage is complete for the inventory's stated scope: rule shape, hidden target
set, validator interfaces, observed behavior, risks, existing checks, and unknowns.

- **Preserved requirements:** keep `no-orphans` as a warning over `from.orphan: true`;
  document the general, hidden-target, dynamic-worker, fixture, known-reachable,
  traversal, and test-graph exclusions; preserve the `pnpm deps:validate`, CI, and
  pre-commit interfaces; and treat the inventory as read-only evidence rather than
  a source/config change.
- **Preserved decisions:** do not remove the blanket `/models/`, `/events/`, and
  `/types.ts` exclusions without a type-aware strategy; do not treat the four
  no-static-reference candidates as automatically deletable; and do not infer a
  dynamic entrypoint from a worker-shaped file.
- **Evidence and provenance:** the inventory records the rule locations in
  `.dependency-cruiser.cjs`, the non-breaking validation baseline, a probe result of
  63 hidden-target candidates (`models=46`, `events=8`, `types.ts=9`), a static scan
  result of 58 production type-only references (`42`, `8`, `8`), four candidates
  without static `src` references, one test-only `Toaster` candidate, and zero
  dynamic entrypoints in the hidden target set.
- **Future-work constraints:** any narrowed exclusion needs runtime/type-only/test-
  only classification; the four named candidates still need explicit path-named
  human approval or a documented retention decision; and the project still needs to
  choose whether type-only orphan analysis is a validator feature or a separate
  audit. These are retained roadmap constraints, not unrepresented inventory text.
- **Disposition:** every inventory section is represented above or in the durable
  graph and warning evidence below. It is deletion-eligible after merge; this branch
  does not delete the source.

### Dedicated source: no-orphans decision-gate task

Coverage is complete for the task packet's requirements, protected scope, evidence,
instructions, findings, run summary, blocked questions, and self-review.

- **Preserved requirements:** AC-001 classifies the five warnings as remediation,
  blocker, or explicit product/deletion decision; AC-002 forbids cosmetic exceptions
  and invented wiring; AC-003 records the exact blocker decisions.
- **Preserved decisions and scope:** do not implement source changes, delete without
  exact path-named approval, add exceptions for unproven entrypoints, or wire RAVE
  helpers without a product spec. The protected paths remain the MIDI worker, the
  RAVE folder, `.dependency-cruiser.cjs`, public/generated sample assets, manifests,
  CI/build configuration, and native code.
- **Evidence and provenance:** the task's validation reproduced five warnings: the
  MIDI worker plus four RAVE helpers. Focused searches found no MIDI launcher,
  import, string/path reference, or test import; the four RAVE files were imported
  only by sibling specs and had no production/UI/runtime pipeline. The packet records
  all three verification items as passed and no source branch, worktree, PR, or
  merge as opened.
- **Future-work constraints:** the MIDI path may be deleted only by exact-path
  approval or retained behind a real controller-scripting spec; the four RAVE paths
  may be deleted only by exact-path approval or retained behind a real product spec
  covering runtime ownership, source/target audio selection, model execution, cache,
  UI/actions, and verification. No dependency-cruiser exception or synthetic
  reachability is allowed.
- **Disposition:** all task requirements and its blocked questions are preserved in
  the durable warning ownership and roadmap invariants. The packet is deletion-
  eligible after merge; this branch does not delete the source.

### Dedicated source: no-orphans decision-gate review

Coverage is complete for the review summary, three review lenses, reconciliation,
changed-file scope, AC-001/AC-002/AC-003 coverage, human-attention decisions, open
decision options, task status, recommendation, and residual risk.

- **Preserved requirements and decisions:** the review marks AC-001 and AC-002
  supported, AC-003 blocked pending human decisions, and rejects both dependency-
  cruiser laundering and invented product behavior. It records the exact MIDI path
  and exact four RAVE paths, with delete, keep-blocked, and spec-and-wire options;
  its recommendation is to keep both decisions blocked until explicitly resolved.
- **Evidence and provenance:** independent MIDI reachability, RAVE reachability, and
  command/config lenses agreed; the review found no launcher for the MIDI worker and
  no production RAVE pipeline. It records Suspec-only changes, no source worktree,
  branch, PR, or merge, and the remaining human-attention items.
- **Future-work constraints:** source remediation stays blocked until exact path-
  named deletion approval or a real product spec; the MIDI path also remains subject
  to the worker trust/sandbox and typed-action decisions owned by Push integration,
  and RAVE wiring must satisfy its real acceptance criteria rather than the dormant
  heuristic tests.
- **Disposition:** the complete review record, including its blocked verdict and
  residual risk, is represented here and in the durable warning sections. It is
  deletion-eligible after merge; this branch does not delete the source.

### Broader source: depcruiser laundering gaps

- **Promoted no-orphans slice only:** the blanket hidden-target gap, the 2026-06-30
  63-candidate probe and its 58 type-only classifications, the four no-static-ref
  candidates, the zero-dynamic-entrypoint result, and the historical five-warning
  decision-gate outcome are represented in this research.
- **Unrepresented content retained:** the source's type-only boundary laundering,
  re-export laundering, Tauri bridge laundering, unenforced one-function rule,
  React exemptions, stale barrel/from-scope rules, and other no-orphans-unrelated
  architecture gaps remain in that source. It is not exhausted and is not
  deletion-eligible.

### Broader source: depcruiser warn backlog

- **Promoted no-orphans slice only:** the historical `~107` raw count, the four
  proven dynamic-worker exceptions, four shared test-fixture exceptions, seven
  exact reachable type/helper exceptions, and the resulting 16 residual warnings
  and classifications are represented. The later no-orphans resolutions in PRs
  #124-#133 and the current five-warning state are represented by the durable
  current set and warning ownership, not as a claim that this broad record is
  exhausted.
- **Unrepresented content retained:** the source's other warn-rule history and
  guidance, including non-orphans backlog material, remain in that source. It is
  not exhausted and is not deletion-eligible.

### Broader source: dead-code inventory

- **Promoted no-orphans slice only:** its 16-path cross-check is represented: 11
  paths were later wired or explicitly retired by PRs #124-#133, while the MIDI
  worker and four RAVE helpers remain the exact visible warnings and blocked
  decisions recorded above. The cross-check's test-only observations and
  owner-decision/deletion-candidate distinctions are preserved in the warning
  evidence and constraints.
- **Unrepresented content retained:** the Knip-built-but-unwired feature map,
  unused exports/types, broken test imports, empty event barrels, dependency hints,
  and other dead-code unknowns remain in the inventory. It is not exhausted and is
  not deletion-eligible.

## Promotion-time evidence

The promotion-time checkout was verified on 2026-07-15. This current graph capture
is distinct from the historical raw count below. `pnpm deps:validate`
reported four exact error baselines and five visible warnings:

```text
main: 68 exact baseline row(s); 5 warning(s) remain visible
reachability: 9 exact baseline row(s)
types: 53 exact baseline row(s)
tests: 387 exact baseline row(s)
```

The five visible `no-orphans` warnings are:

- `src/modules/MIDI/workers/controllerScriptingWorker.ts`
- `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts`
- `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts`
- `src/modules/AudioEngine/useCases/rave/encodeAudio.ts`
- `src/modules/AudioEngine/useCases/rave/decodeLatent.ts`

`scripts/check-dependency-boundaries.mjs` runs four no-cache cruises. It compares
only error rows to exact JSON baselines, rejecting both new and stale rows; warning
rows remain visible in the cruise summary and do not become baseline errors.

## Current validator behavior

The main `.dependency-cruiser.cjs` rule is `no-orphans` at `warn` severity over
`from.orphan: true`. Its comment describes the signal as likely dead code pending
a cleanup pass. The main graph currently:

- excludes declaration files, module-root `index.ts`, `/models/`, `/events/`,
  `/types.ts`, test-support paths, app entrypoints, and routes from orphan reporting;
- keeps four proven dynamic workers, four shared test fixtures, and seven reachable
  type/helper files out through exact path matches;
- excludes `*.spec.*` and `*.test.*` files from traversal and does not follow
  `node_modules`.

The main config does not set `tsPreCompilationDeps`, so its orphan graph does not
count incoming type-only references. The separate type cruise uses
`tsPreCompilationDeps: 'specify'`, and the test cruise enables it for the
test-inclusive graph. Those gates improve type-edge visibility but do not make the
main `no-orphans` graph type-aware.

The blanket shape exclusions are pre-existing classification debt, not evidence-backed
per-file exceptions. They remain unchanged until the runtime/type-only/test-only triage
required by AC-003 supports narrowing them; AC-005 governs new path-specific exceptions.

### Exact current exceptions

These are the current path-specific exceptions, retained only with their evidence:

- Dynamic workers: `src/modules/Transport/workers/schedulerWorker.ts`,
  `src/modules/MIDI/workers/midiImportWorker.ts`,
  `src/modules/BrowserAi/workers/tfjsInferenceWorker.ts`, and
  `src/modules/AudioEngine/workers/recordingWorker.ts`.
- Shared test fixtures: `src/modules/SoundLibrary/__tests__/createTestSample.ts`,
  `src/modules/Arrangement/__tests__/TrackDummy.ts`,
  `src/modules/Arrangement/__tests__/PluginDummy.ts`, and
  `src/modules/Arrangement/__tests__/ClipDummy.ts`.
- Runtime-used type/helpers: `src/utils/DOM/GestureEvent.ts`,
  `src/modules/Workspace/presentations/views/Sidebar/SidebarTypes.ts`,
  `src/modules/Project/useCases/dawProject/dawProjectTypes.ts`,
  `src/modules/MIDI/useCases/grooveExtraction/helpers.ts`,
  `src/modules/Collaboration/useCases/collaborationQueries.ts`,
  `src/modules/AudioEngine/repositories/audioDecoding/wasmDecoding/helpers.ts`,
  and `src/infra/store/storage/LocalStorageKeys.ts`.

No exception is justified for the current MIDI worker or the four current RAVE
helpers: they have no direct runtime entrypoint or production consumer.

## Current warning evidence

The MIDI worker contains a `self.onmessage` handler and executes supplied code with
`new Function`, but source search found no launcher, static import, string/path
reference, or test import. Its own comment says Worker isolation is only basic and
is not a complete secure sandbox. Product trust, sandbox, and typed action-bridge
decisions belong to [Push integration Q-004](../push-integration/spec.md); this
research does not authorize arbitrary script execution.

The four RAVE files are imported only by their sibling specs and have no production,
UI, or runtime transform pipeline. `encodeAudio` is a deterministic spectral
transform, `decodeLatent` is a synthetic sine-based decoder, and the interpolation
and transfer helpers blend arrays in memory. The RAVE store explicitly describes the
encoder as simulation rather than actual ONNX. They are test-only heuristic
placeholders, not evidence for the real ONNX acceptance criteria in
[RAVE timbre transfer](../rave-timbre-transfer/spec.md).

## Historical evidence

The following findings are dated evidence, not current warning counts or automatic
deletion decisions.

### 2026-06-16 raw no-orphans count (pre-triage)

`FINDING-depcruiser-warn-backlog` recorded `~107` raw `no-orphans` modules before
later exact exceptions and classification. This dated pre-triage evidence is the
historical 107-count, not the current graph result, not a current exact baseline,
and not a deletion decision. The current promotion capture independently verifies
only the five warning paths listed above.

### 2026-06-30 no-orphans probe

Removing the blanket `/models/`, `/events/`, and `/types.ts` exclusions was probed
to expose 63 candidate orphans: `models=46`, `events=8`, and `types.ts=9`.

The static TypeScript scan classified 58 of those as production type-only static
references: `models=42`, `events=8`, and `types.ts=8`. Four candidates had no static
reference in `src`:

- `src/modules/AiRuntime/models/LlmOrchestrationTypes.ts`
- `src/modules/Arrangement/handlers/types.ts`
- `src/modules/AudioEngine/models/AudioGraph.ts`
- `src/modules/AudioEngine/models/SidechainRoute.ts`

One additional candidate, `src/modules/Toaster/models/GrooveTemplates.ts`, was
referenced only by its excluded sibling spec. No dynamic entrypoints were found in
the hidden target set. The probe supports type-aware triage; it does not support a
blanket exclusion removal or automatic deletion of any path.

### 2026-06-26 type-edge context

An earlier module sweep found 28 real DDD boundary violations across 17 modules that
the then-current main dependency cruise accepted. Later guard and remediation work
made many of those edges visible or closed, so that count is historical rather than
a current baseline. The durable lesson remains: a green dependency check is not
proof that type-only edges or orphan reachability are fully modeled.

The same review confirmed that value-edge cross-module and React/Tauri confinement
checks fire; the unresolved concern here is type-aware orphan reachability, not a
claim that every validator rule is ineffective.

## Roadmap invariants

- Type-aware orphan analysis MUST separate runtime, type-only, and test-only incoming
  references before any exclusion is narrowed.
- Dynamic entrypoints MUST be classified from direct launcher evidence, not from a
  filename, worker API shape, or a comment alone.
- New path-specific exceptions MUST remain exact and evidence-backed; broad path
  patterns are not a substitute for classification.
- Existing blanket shape exclusions MUST NOT be broadened; narrowing them requires
  the runtime/type-only/test-only triage required by AC-003.
- No source import, barrel export, registry entry, or product consumer may be added
  only to make a warning disappear.
- The five current warnings remain visible until [Push integration Q-004](../push-integration/spec.md)
  or [RAVE timbre transfer](../rave-timbre-transfer/spec.md) delivers real behavior,
  or an explicit retirement decision names the exact path.
