---
type: research
id: RESEARCH-dependency-boundary-validation
title: Dependency boundary validation research
status: current
owner: The Sourdaw team
sources:
    - ../../decisions/README.md
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

| Evidence                                | Checked-in authority                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Rule behavior and graph options         | `.dependency-cruiser.cjs`, `.dependency-cruiser.reachability.cjs`, `.dependency-cruiser.types.cjs`, `.dependency-cruiser.tests.cjs` |
| Gate orchestration and exact error rows | `scripts/check-dependency-boundaries.mjs` and the four `.dependency-cruiser-known-violations*.json` files                           |
| Public commands                         | `package.json`                                                                                                                      |
| Current warning behavior                | The five warning source paths listed in frontmatter and their owning durable specs                                                  |

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
is not a complete secure sandbox. It has neither the accepted concrete runtime ADR
required by
[hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-require-an-accepted-runtime-adr)
nor an implementation of its trusted-grant, exact-intent, Command-dispatch, or bound-output
requirements in AC-004 through AC-007, closed source/protocol requirements in AC-009/AC-010, or
selected-runtime harness in AC-011. It is also not a declarative-profile host.
[Push AC-028](../push-integration/spec.md#ac-028--separate-capability-secure-script-artifact) keeps those
APIs separate; Push AC-023 through AC-027 own the future declarative host contract.

The four RAVE files are imported only by the focused `encodeAudio.spec.ts`,
`decodeLatent.spec.ts`, `timbreTransfer.spec.ts`, and `interpolateLatent.spec.ts` tests under
`src/modules/AudioEngine/useCases/rave/__tests__/`; they have no production, UI, or runtime
transform pipeline. `encodeAudio` is a deterministic spectral
transform, `decodeLatent` is a synthetic sine-based decoder, and the interpolation
and transfer helpers blend arrays in memory. Current `loadModel.ts` only changes model state in
`raveStore`; it does not load ONNX or create a transfer path. These files are direct deterministic
test helpers, not evidence for the future model-backed acceptance criteria in
[RAVE timbre transfer](../rave-timbre-transfer/spec.md). The encode/decode tests make direct calls;
`timbreTransfer.spec.ts` only checks the export exists, while `interpolateLatent.spec.ts` covers one
midpoint and one missing target dimension but not endpoints or input immutability. The focused
command is green, but those missing direct contracts remain unproved and all helper-test success is
non-retiring.

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
  product script-bundle worker satisfying
  [hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-require-an-accepted-runtime-adr),
  [AC-004](../hardware-controller-ecosystem/spec.md#ac-004--script-grants-are-trusted-and-finite),
  [AC-005](../hardware-controller-ecosystem/spec.md#ac-005--script-effect-intents-have-exact-schemas),
  [AC-006](../hardware-controller-ecosystem/spec.md#ac-006--script-parameter-intents-use-command),
  [AC-007](../hardware-controller-ecosystem/spec.md#ac-007--script-midi-intents-use-one-bound-output),
  [AC-008](../hardware-controller-ecosystem/spec.md#ac-008--current-worker-warning-has-one-exact-disposition),
  [AC-009](../hardware-controller-ecosystem/spec.md#ac-009--script-source-loading-is-closed),
  [AC-010](../hardware-controller-ecosystem/spec.md#ac-010--script-results-use-one-closed-protocol),
  [AC-011](../hardware-controller-ecosystem/spec.md#ac-011--selected-runtime-confinement-is-observed),
  and [Push AC-028](../push-integration/spec.md#ac-028--separate-capability-secure-script-artifact), or an
  accepted-ADR retirement satisfies
  [dependency-boundary-validation AC-008](spec.md#ac-008--accepted-exact-path-retirement) in the same
  change. Generic reachability, a declarative-profile host role, or an orphan exception does not
  close it; neither do Worker presence, `new Function`, a launcher, or CSP alone. Push AC-023
  through AC-027 remain on the separate declarative path.
- The four RAVE helper warnings MUST remain visible while their current files serve as direct
  deterministic test helpers. Their exact path-specific gates are
  [RAVE AC-024](../rave-timbre-transfer/spec.md#ac-024--direct-encode-helper-remains-test-only),
  [AC-032](../rave-timbre-transfer/spec.md#ac-032--direct-decode-helper-remains-test-only),
  [AC-033](../rave-timbre-transfer/spec.md#ac-033--direct-timbre-helper-needs-behavioral-evidence),
  and [AC-026](../rave-timbre-transfer/spec.md#ac-026--direct-pure-latent-interpolation-helper).
  Each required direct behavioral test MUST be green in the relocation/removal or canonical
  dependency AC-008 change before the current path is removed; product reachability and the current
  focused command do not close a warning.
- Future loaded-model RAVE transfer MUST derive rendered, cached, and inserted audio through the
  verified session capability in
  [RAVE AC-028](../rave-timbre-transfer/spec.md#ac-028--verified-onnx-session-capability), matched to
  the host-owned operation selection under
  [AC-029](../rave-timbre-transfer/spec.md#ac-029--capability-matches-the-host-owned-selection),
  from only one-time correlated responses under
  [AC-030](../rave-timbre-transfer/spec.md#ac-030--worker-responses-are-correlated-once) that pass
  the exact schema, finite-value, and payload bounds in
  [AC-031](../rave-timbre-transfer/spec.md#ac-031--worker-response-payloads-are-bounded-data).
  Pure-helper output and rejected worker responses MUST NOT satisfy that product contract.
