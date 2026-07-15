---
type: research
id: RESEARCH-dependency-boundary-validation
title: Dependency boundary validation research
status: current
owner: The Sourdaw team
sources:
  - ../hardware-controller-ecosystem/spec.md
  - ../push-integration/spec.md
  - ../rave-timbre-transfer/spec.md
  - ../../../.dependency-cruiser.cjs
  - ../../../.dependency-cruiser.reachability.cjs
  - ../../../scripts/check-dependency-boundaries.mjs
  - ../../../.dependency-cruiser.types.cjs
  - ../../../.dependency-cruiser.tests.cjs
  - ../../../.dependency-cruiser-known-violations.json
  - ../../../.dependency-cruiser-known-violations-reachability.json
  - ../../../.dependency-cruiser-known-violations-types.json
  - ../../../.dependency-cruiser-known-violations-tests.json
  - ../../../package.json
  - ../../../src/modules/MIDI/workers/controllerScriptingWorker.ts
  - ../../../src/modules/AudioEngine/stores/rave.ts
  - ../../../src/modules/AudioEngine/useCases/rave/loadModel.ts
  - ../../../src/modules/AudioEngine/useCases/rave/encodeAudio.ts
  - ../../../src/modules/AudioEngine/useCases/rave/decodeLatent.ts
  - ../../../src/modules/AudioEngine/useCases/rave/timbreTransfer.ts
  - ../../../src/modules/AudioEngine/useCases/rave/interpolateLatent.ts
---

# Research: dependency boundary validation

## Durable authority

Current claims in this document derive only from the checked-in sources listed in frontmatter
and the commands below. Historical counts without a checked-in command and result are omitted;
claims not reproducible from those checked-in sources are outside this research's authority.

| Evidence | Checked-in authority |
| --- | --- |
| Rule behavior and graph options | `.dependency-cruiser.cjs`, `.dependency-cruiser.reachability.cjs`, `.dependency-cruiser.types.cjs`, `.dependency-cruiser.tests.cjs` |
| Gate orchestration and exact error rows | `scripts/check-dependency-boundaries.mjs` and the four `.dependency-cruiser-known-violations*.json` files |
| Public commands | `package.json` |
| Current warning behavior | The five warning source paths listed in frontmatter and their owning durable specs |

Reproduce the current evidence from the repository root:

```sh
pnpm deps:validate
rg -n "controllerScriptingWorker" src --glob "!src/modules/MIDI/workers/controllerScriptingWorker.ts"
rg -n "from ['\"][^'\"]*(encodeAudio|decodeLatent|timbreTransfer|interpolateLatent)['\"]" src --glob "!**/*.spec.ts" --glob "!**/*.spec.tsx"
pnpm test:run src/modules/AudioEngine/useCases/rave/__tests__/encodeAudio.spec.ts src/modules/AudioEngine/useCases/rave/__tests__/decodeLatent.spec.ts src/modules/AudioEngine/useCases/rave/__tests__/timbreTransfer.spec.ts src/modules/AudioEngine/useCases/rave/__tests__/interpolateLatent.spec.ts
```

The two focused `rg` commands intentionally return no matches and exit `1` in the current
checkout: the first excludes the worker's own definition; the second excludes test imports.

## Reproducible current evidence

`pnpm deps:validate` reports four exact error baselines and five visible warnings:

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
is not a complete secure sandbox. It is neither the sandboxed script artifact required by
[hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-run-sandboxed-and-control-parameters)
nor a declarative-profile host. [Push AC-028](../push-integration/spec.md#ac-028--separate-sandboxed-script-artifact)
keeps those APIs separate; Push AC-023 through AC-027 own the future declarative host contract.

The four RAVE files are imported only by the focused `encodeAudio.spec.ts`,
`decodeLatent.spec.ts`, `timbreTransfer.spec.ts`, and `interpolateLatent.spec.ts` tests under
`src/modules/AudioEngine/useCases/rave/__tests__/`; they have no production, UI, or runtime
transform pipeline. `encodeAudio` is a deterministic spectral
transform, `decodeLatent` is a synthetic sine-based decoder, and the interpolation
and transfer helpers blend arrays in memory. Current `loadModel.ts` only changes model state in
`raveStore`; it does not load ONNX or create a transfer path. These files are direct deterministic
CI/test helpers, not evidence for the future model-backed acceptance criteria in
[RAVE timbre transfer](../rave-timbre-transfer/spec.md); green helper tests are
explicitly non-retiring.

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
- The controller worker warning MUST remain visible until that exact path becomes the distinct
  product script-bundle worker satisfying hardware-controller-ecosystem AC-002 and Push AC-028,
  or an explicit superseding ADR retires the exact file. Generic reachability, a declarative-profile
  host role, or an orphan exception does not close it; Push AC-023 through AC-027 remain on the
  separate declarative path.
- The four RAVE helper warnings MUST remain visible while their current files serve as
  direct deterministic CI/test helpers. Each file MUST be relocated to its exact named
  `__tests__/helpers/` path with tests/contract preserved before that current path is
  retired, unless an explicit superseding ADR names the exact path; product reachability
  and green helper tests MUST NOT close the warning.
- Future loaded-model RAVE transfer MUST derive rendered, cached, and inserted audio from the
  worker/ONNX encode-decode result; pure-helper output MUST NOT satisfy that product contract.
