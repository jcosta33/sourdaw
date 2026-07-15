---
type: spec
id: SPEC-levain-multi-instance
title: Levain multi-instance architecture
status: draft
owner: The Sourdaw team
sources:
  - .agents/specs/levain-multi-instance/
---

# Levain multi-instance architecture

## Intent

Allow many Levain instruments to run concurrently in one project, each with its
own UI state, parameter map, and bridge connection keyed by `deviceId`, so two
Levain instances on different tracks behave as fully independent instruments
with no shared state or crosstalk.

## Non-goals

- New Levain DSP or synthesis features; this is an instancing change.
- Changing the DAW shell's plugin-hosting contract beyond passing `deviceId`.
- Cross-instance preset sharing UI.

## Requirements

### AC-001 — Levain stores are scoped per deviceId

Every Levain store (UI state, parameter map, bridge handle) must be keyed by
`deviceId` so two instances hold independent state.

Verify with: `pnpm test:run -- levainDeviceScopedStores`

### AC-002 — The bridge connection is per instance

Each Levain instance must own its own bridge connection to its DSP node.

Verify with: `pnpm test:run -- levainBridgeIsolation`

### AC-003 — No module-level singletons leak between instances

Levain must hold no module-level mutable singleton that two instances share;
domain state lives only in `deviceId`-keyed stores.

Verify with: `pnpm deps:validate`

### AC-004 — Instances load independently

Two Levain instances must each show their own loading state.

Verify with: `pnpm test:run -- levainIndependentLoading`

### AC-005 — Two instances produce no crosstalk

Changing a parameter on one Levain instance must not alter any parameter, UI, or
audio of another instance.

Verify with: `manual` — open two Levain instances, change a knob on one, confirm the other is unaffected

### AC-006 — Existing single-instance behavior is preserved

A project with a single Levain instance must behave identically to today after
the change.

Verify with: `pnpm test:run -- levainRegression`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-008 — Bridge messages do not cross instances

A message sent from one Levain instance's bridge must not reach another
instance.

Verify with: `pnpm test:run -- levainBridgeIsolation`

### AC-009 — A loading instance does not disturb a loaded one

A Levain instance still loading must not block or reset another instance that
has already loaded.

Verify with: `pnpm test:run -- levainIndependentLoading`

### AC-010 — Two instances' patches round-trip through save/load independently

Saving and reloading a project that contains two Levain instances must restore
both patches independently — each instance must reload with its own patch and
parameter values intact, with no shared or overwritten state between the two.
(This is a distinct multi-instance persistence requirement; AC-006 covers only
preserving single-instance behavior. The reset path must clear all instances and
must not assume a single instance.)

Verify with: `pnpm test:run -- levainMultiInstancePersistence` — E2E: project
save/load round-trip with two Levain instances; verify both patches persist
independently

### AC-011 — MIDI note routing is isolated between instances

MIDI notes routed to Track A's Levain must not sound from Track B's Levain, and
this isolation must be observable in the output meters and in rendered (bounced)
audio: Track B's meter and bounce must show no signal from notes addressed to
Track A's instance.

Verify with: `pnpm test:run -- levainMidiRoutingIsolation` — integration/E2E:
route MIDI to instance A only, assert instance B's output meter and rendered
bounce stay silent

### AC-012 — levainBridgeDependencies.ts must not import getAllTracks from Arrangement

`levainBridgeDependencies.ts` must not import `getAllTracks` from the Arrangement
domain to discover its own `deviceId`; the `deviceId` must be supplied by the DAW
shell (passed to the plugin panel or bridge at initialization), not derived by
reaching into the Arrangement domain. `pnpm deps:validate` must report zero
violations, including the absence of this specific cross-domain import.

Verify with: `pnpm deps:validate` — confirm zero violations and that
`levainBridgeDependencies.ts` no longer imports `getAllTracks`

### AC-013 — Bridge MessagePorts are torn down on instance removal with an empty registry afterward

When a Levain instance is removed and when a project is closed, the bridge must
tear down that instance's `MessagePort`(s) and release its `deviceId`-keyed
stores; after closing the project the bridge registry must be empty. This guards
against the risk that a failed `MessagePort` cleanup leaves phantom voices or
leaks memory. There must be an explicit teardown test that asserts the registry
is empty after closing the project.

Verify with: `pnpm test:run -- levainBridgeTeardown` — assert each removed
instance's `MessagePort` is closed and that the bridge registry is empty after
the project is closed

### AC-014 — Bridge registry lookup must stay off the audio thread

The `deviceId`-keyed bridge registry lookup must happen off the audio thread;
audio-thread code must receive the correct `AudioWorkletNode` handle directly
and must not perform the registry map lookup (or any allocation/blocking) on the
RT-audio path.

Verify with: `manual` — review the bridge dispatch path to confirm the
`deviceId` → `MessagePort`/`AudioWorkletNode` resolution runs off the audio
thread and the RT path holds a direct handle

## Open questions

- [ ] (blocking) Does the DAW shell guarantee a unique, stable `deviceId` to
  each plugin instance at initialization, and is it the same value the bridge
  uses? Per-instance keying depends on this contract.
- [ ] (non-blocking) When an instance is removed, what tears down its
  `deviceId`-keyed stores and bridge to avoid a leak?
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §1.2 "Levain
  (The Orchestral Suite)") Levain today is a basic multi-sampler and lacks the
  orchestral performance intelligence needed to make samples sound like a living
  orchestra. This is out of this spec's scope (instancing only; see Non-goals "New
  Levain DSP or synthesis features"), but the gap is recorded here so the
  per-instance state model can later accommodate it. The intake names four
  feature areas, each of which adds per-instance state that the `deviceId`-keyed
  store model must eventually hold without crosstalk: (1) a **True Legato Engine**
  (interval transitions, crossfade logic between successive notes); (2)
  **Continuous Expression Modeling** — CC1-driven dynamics crossfading and CC11
  volume control; (3) **Spatial Mic Mixing** across the **Close, Tree, and
  Ambient** mic positions with phase-alignment tools; and (4) **Physical Modeling
  Augmentation** — synthetic vibrato LFOs and bow noise. When any of these lands,
  its runtime state (legato transition state, current CC1/CC11 values, per-mic mix
  and phase settings, LFO/noise generators) must be added to the per-`deviceId`
  scope established by AC-001 so two instances remain independent.

## Known risks

These are present-state observations from the Levain module audit (`bb84b0e:audits/modules/Levain.md`). They are not in scope of the instancing change but are recorded here because they touch the same files the per-`deviceId` rework lands in; restored as detail from the migration.

- (restored detail) AGENTS.md function-signature rule violated across the module — ~18 positional multi-arg signatures: `helpers.ts:67` `registerLevainDevice(deviceId, device, port?)`, `helpers.ts:102` `setLevainParamWithAudio(deviceId, key, value)`, `helpers.ts:136` `setMacroWithAudio(deviceId, index, value)`, `helpers.ts:182` `sendHumanizeToEngine(deviceId, amount)`, `helpers.ts:189` `sendLegatoEnabledToEngine(deviceId, enabled)`, `helpers.ts:196` `sendMicParamToEngine(deviceId, micIndex, param, value)`, `levainStore.ts:60` `setLevainParam(deviceId, key, value)`, `levainStore.ts:72`, `levainStore.ts:78` `setCurrentArticulation(deviceId, articulation)`, `levainStore.ts:92` `setMacro(deviceId, index, value)`, `levainStore.ts:112` `updateMicPosition(deviceId, index, updates)`, `levainStore.ts:132`, `loadPreset.ts:15` `loadInstrument(deviceId, instrumentId)`, `loadPreset.ts:25`, `autoLoadSamples.ts:21` `autoLoadLevainSamples(deviceId, nodePort, instrumentId)`, `loadInstrumentFromManifest.ts:70` (5 params), `loadSingleSample.ts:7` (3 params). Since these signatures all lead with `deviceId`, the instancing rework touches every one of them.
- (restored detail) `autoLoadSamples.ts` soundness escapes. `autoLoadSamples.ts:34-36`: a `tauriCore as unknown as { convertFileSrc }` cast carries an `eslint-disable sourdaw/no-type-assertion-escape` justification, but `@tauri-apps/api/core` does export `convertFileSrc` as a typed function — the cast masks a module-resolution / dynamic-import inference quirk, not a real type gap. `autoLoadSamples.ts:9`: module-scope `const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window` is evaluated once at module load, so it captures `false` in SSR/test contexts even when the runtime later exposes Tauri; should be a function call.
- (restored detail) React list-key bugs in two presentations. `MicBlendSlider.tsx:41` keys mic strips by array index (`key={i}`) — reordering or removing a mic reuses the wrong DOM node; `mic.type` (unique per `MicPositionType`) is stable. `LevainMacroStrip.tsx:20` keys macros by `key={label}` over `macroLabels`, which are user-renameable and not guaranteed unique — two equal labels collapse to one DOM node and the second knob never re-renders.
- (restored detail) `HumanizePanel.tsx:79-110` knob-domain mismatch that can silence the patch. `dynamicMax` and `vibratoVarMax` are stored 0–1 in the patch, but the knobs display 0–15 / 0–30 via an inline `* 100` on read and `/ 100` on write. Any raw-0–1 automation routed straight at `humanize.dynamicMax` / `humanize.vibratoVarMax` (bypassing the panel's `/100`) lands at near-zero in the engine and produces silence; the displayed `±{(config.dynamicMax * 100).toFixed(0)}%` also truncates a 0.5-step knob to whole integers.
- (restored detail) Forbidden `any` in the panel view test. `presentations/views/__tests__/LevainPanel.spec.tsx:60-108` defines five `any`-typed mock components; AGENTS.md "TypeScript — soundness" forbids `any`. (Same test file also uses a namespace import — see the bridge spec `import * as subject` finding.)

## Affected areas

- `src/modules/Levain/stores/` (deviceId-keyed Vanilla `Store` instances)
- `src/modules/Levain/bridge/` (per-instance bridge connection)
- `src/modules/Levain/presentations/views/` (deviceId propagation from the shell)

## Dropped from sources

- A migration path for projects saved under the single-instance model — the
  feature is presented as the original design; no migration framing.
- Shared preset/state pooling across instances — explicitly out of scope; the
  goal is isolation, not sharing.
