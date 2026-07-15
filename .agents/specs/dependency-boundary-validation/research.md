---
type: research
id: RESEARCH-dependency-boundary-validation
title: Dependency boundary validation research
status: current
owner: The Sourdaw team
sources:
  - code:.dependency-cruiser.cjs
  - code:scripts/check-dependency-boundaries.mjs
  - code:.dependency-cruiser.types.cjs
  - code:.dependency-cruiser.tests.cjs
  - code:package.json
---

# Research: dependency boundary validation

## Promoted evidence provenance

The substantive evidence from these promotion inputs is preserved in this research.
Their transient workspace paths are intentionally omitted.

| Source ID and name | Date or capture | Status at promotion |
| --- | --- | --- |
| `INV-depcruiser-no-orphans-overexclusion-2026-06-30` — Dependency-cruiser no-orphans over-exclusion inventory | 2026-06-30 | current |
| `TASK-depcruiser-no-orphans-decision-gate` — Depcruiser No-Orphans Decision Gate | capture 2026-07-15 | blocked |
| `REVIEW-depcruiser-no-orphans-decision-gate` — Depcruiser No-Orphans Decision Gate review | capture 2026-07-15 | blocked |
| `FINDING-depcruiser-laundering-gaps` — dep-cruiser enforces value edges, not laundering paths — gaps an adversarial review proved | 2026-06-16 | accepted |
| `FINDING-depcruiser-warn-backlog` — Two dependency-cruiser rules landed at warn pending a real cleanup pass | 2026-06-16 | accepted |
| `INV-deadcode` — Dead-code map (knip) inventory | 2026-06-13 | open |

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
- Exceptions MUST remain exact and evidence-backed; broad path patterns are not a
  substitute for classification.
- No source import, barrel export, registry entry, or product consumer may be added
  only to make a warning disappear.
- The five current warnings remain visible until [Push integration Q-004](../push-integration/spec.md)
  or [RAVE timbre transfer](../rave-timbre-transfer/spec.md) delivers real behavior,
  or an explicit retirement decision names the exact path.
