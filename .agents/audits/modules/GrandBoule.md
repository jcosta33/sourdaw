# GrandBoule module audit

## Scope

This audit covers `src/modules/GrandBoule/` in full — every file: useCases,
repositories, models, stores, events, presentations (views + components),
and tests. It explicitly excludes the upstream callers
(`AudioEngine/repositories/webMidi/messageHandlers.ts`,
`Project/useCases/projectPersistence/...`,
`Workspace/presentations/views/AppShell.tsx`,
`Workspace/presentations/views/Sidebar/InstrumentsTab.tsx`) except where
they are directly named below to expose contract bugs that originate in
this module.

It is an adversarial review. Bugs, races, contract drift, dead/duplicated
abstractions, vacuous tests, accessibility gaps, and audio/UX hazards.

Related spec: none on disk.

---

## Goal

A correctness-first physical-modelling piano plugin module for the DAW:

- One canonical mutable per-device store. Project save/load round-trips
  every per-device piece of GrandBoule state (pedals, calibration, morph,
  per-note overrides, temperament, parameters, config) without losing
  anything.
- One canonical velocity-shaping pipeline. The same MIDI velocity curve
  is applied whether the source is the on-screen keyboard, the WASM-engine
  preview, or an external MIDI controller — no two divergent
  `applyVelocityCurve` implementations, no two divergent shaping fields.
- Use cases are thin, predictable, and consistent: every dispatch checks
  engine readiness or returns a clear "engine not ready" signal; the
  panel cannot present a "preset loaded" success on a disconnected handle.
- Cross-module surfaces (`useCases/`, `stores/`, `events/`,
  `presentations/views/`) match the contract-folder-barrel rule. Internal
  imports are relative. No use-case `type` re-exports leak across module
  boundaries.
- Tests assert real behaviour — no `*.spec.ts` whose only assertion is
  `subject.foo` is defined. Component tests that pass props the component
  doesn't actually accept fail typecheck instead of silently lying.
- Audio-thread-adjacent code (the `applyVelocityCurve` invoked from
  `messageHandlers` for every note-on) does no allocation and no runtime
  cycle through `await`/`Promise`.
- AGENTS.md hard rules: no `any`, no `as any` / `as never` / `as unknown`,
  no `useMemo`/`useCallback`/`React.memo`, no `forwardRef`, no namespace
  imports, no cross-module imports of internals; one function per
  `useCases/` / `repositories/` file; functions with > 1 param take a
  single object param.

---

## Relevant code paths

- `src/modules/GrandBoule/events/index.ts` (`// no public events`)
- `src/modules/GrandBoule/models/GrandBouleConfig.ts`
- `src/modules/GrandBoule/models/GrandBoulePreset.ts`
- `src/modules/GrandBoule/models/GrandBouleMidiCalibration.ts`
- `src/modules/GrandBoule/models/GrandBouleMorphState.ts`
- `src/modules/GrandBoule/models/GrandBoulePerNoteParams.ts`
- `src/modules/GrandBoule/repositories/grandBouleEngineHandle.ts`
- `src/modules/GrandBoule/repositories/grandBoulePresetCatalog.ts`
- `src/modules/GrandBoule/repositories/findBuiltinGrandBoulePreset.ts`
- `src/modules/GrandBoule/stores/grandBouleStore.ts`
- `src/modules/GrandBoule/stores/applyVelocityCurve.ts`
- `src/modules/GrandBoule/stores/index.ts`
- `src/modules/GrandBoule/useCases/index.ts`
- `src/modules/GrandBoule/useCases/createGrandBouleTrack.ts`
- `src/modules/GrandBoule/useCases/triggerGrandBouleNote.ts`
- `src/modules/GrandBoule/useCases/triggerGrandBouleMicrotunedNote.ts`
- `src/modules/GrandBoule/useCases/releaseGrandBouleNote.ts`
- `src/modules/GrandBoule/useCases/loadGrandBoulePreset.ts`
- `src/modules/GrandBoule/useCases/loadGrandBouleAttackClip.ts`
- `src/modules/GrandBoule/useCases/listGrandBoulePresets.ts`
- `src/modules/GrandBoule/useCases/panicGrandBoule.ts`
- `src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleAttackBite.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleMasterGain.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleMorphPosition.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleSostenuto.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleSoundboardSend.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleStretchAmount.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleSustain.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleSympatheticSend.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleTemperament.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleUnaCorda.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleVelocityCurve.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/*.ts`
- `src/modules/GrandBoule/useCases/midiEventSubscribers/*.ts`
- `src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/*.ts`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx`
- `src/modules/GrandBoule/presentations/views/index.ts`
- `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx`
- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx`
- `src/modules/GrandBoule/presentations/components/StringVibrationView.tsx`
- `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx`
- `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx`
- `src/modules/GrandBoule/presentations/components/MorphPanel.tsx`
- `src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx`
- `src/modules/GrandBoule/**/__tests__/*.spec.ts(x)`

---

## Current behavior

**Per-device store factory.** `stores/grandBouleStore.ts:71-85` keeps a
module-level `Map<deviceId, Store<GrandBouleState>>` and a
`createGrandBouleStore(deviceId)` factory that lazily inserts. A legacy
singleton `grandBouleStore = createGrandBouleStore('default')` is also
exported and marked `@deprecated`. The panel
(`GrandBoulePanel.tsx:131`) uses
`createGrandBouleStore(deviceId)`; the AudioEngine MIDI handler
(`messageHandlers.ts:450`) uses `createGrandBouleStore(grandBouleDev.id)`;
the project-persistence reset path
(`Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:7,40`)
uses the deprecated `grandBouleStore` (the `'default'` device).

**Velocity-curve duplication.** Two implementations of `applyVelocityCurve`
exist:

- `stores/applyVelocityCurve.ts:10` — used cross-module by
  `AudioEngine/repositories/webMidi/messageHandlers.ts:452` to avoid an
  AudioEngine ↔ GrandBoule barrel cycle.
- `useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11` — used
  internally by `useCases/triggerGrandBouleNote.ts:13`.

Both are byte-identical (modulo the `clamp` helper). Both are exported
from the module's contract barrels. The `useCases/` one calls
`Math.max/min` via the local `clamp`, the `stores/` one inlines them.

**Two velocity-shaping settings.** `parameters.velocityCurve` (preset)
and `midiCalibration.velocityCurveExponent` (calibration) both exist.
`loadGrandBoulePreset` writes the former and dispatches it to the engine
as `'velocity_curve'`. `applyVelocityCurve` (JS-side) reads the latter.
`setGrandBouleVelocityCurve` writes the former. The two settings have no
relationship at runtime.

**Trigger pipeline.** Real MIDI input (AudioEngine) calls
`applyVelocityCurve(rawVelocity_0_127, calibration)` directly and feeds
the 0..1 result to `dn.grandBouleControls.noteOn`. The on-screen keyboard
uses `triggerGrandBouleNote({ velocity: 0.0..1.0 })`, which multiplies by
127, calls `applyVelocityCurve(velocity * 127, …)`, and feeds the result
to `engine.noteOn`. The two paths land at the same conceptual place but
walk through three different modules to do so.

**Engine-readiness checks.** `triggerGrandBouleNote.ts:24` and
`releaseGrandBouleNote.ts:13` early-return when `!engine.isReady()`. Every
other use case (`setGrandBouleMasterGain`, `setGrandBouleSoundboardSend`,
`setGrandBouleSympatheticSend`, `setGrandBouleStretchAmount`,
`setGrandBouleAttackBite`, `setGrandBouleSustain`, `setGrandBouleSostenuto`,
`setGrandBouleUnaCorda`, `setGrandBouleVelocityCurve`,
`setGrandBouleMorphPosition`, `setGrandBouleTemperament`,
`setGrandBoulePerNoteParam`, `resetGrandBoulePerNoteParams`,
`loadGrandBoulePreset`, `loadGrandBouleAttackClip`, `panicGrandBoule`)
fires `engine.setParam(...)` unconditionally. With a disconnected handle
(`createDisconnectedGrandBouleEngineHandle`) every method is a no-op,
so the call appears to succeed.

**`loadGrandBoulePreset` returns `true` on disconnect.** Because no
readiness gate exists at `loadGrandBoulePreset.ts:13`, calling it with a
disconnected engine writes the preset to the store and returns `true` —
the panel highlights the active preset, but the WASM engine never
received it.

**`setGrandBouleTemperament` resolves its own engine.** Unlike its
siblings, `setGrandBouleTemperament.ts:31` ignores any `engine` input
and instead constructs one via `resolveGrandBouleEngine({ deviceId })`.
The `engine` field is absent from its input type; the panel passes
`{ deviceId, store, temperament }` and the call works — but every other
setter in the module takes `engine` as the first input field. This is a
hidden API divergence.

**Morph panel reset on engine ready.** `GrandBoulePanel.tsx:191-198`
runs `setGrandBouleMorphPosition({ engine, store, morphPosition: 0 })`
every time `engineReady` flips true (with an
`eslint-disable sourdaw/no-useeffect-derived-state` comment).
`setGrandBouleMorphPosition.ts:108` then writes
`morph.morphPosition = 0` into the store. Any user-set morph position
is stomped whenever the engine reconnects, including HMR.

**MIDI subscriber effect uses `[]` deps.**
`GrandBoulePanel.tsx:139-187` subscribes to `midi.noteOn`/`noteOff`/
`pedalCc` once on mount. The handlers close over `deviceId` and `store`.
If the panel is rendered for a different `deviceId` over its lifetime
(unlikely but unguarded), subscriptions point at the original device and
the new one is silently muted.

**Pedal CC handler in panel writes the store directly.**
`GrandBoulePanel.tsx:165-180` skips `setGrandBouleSustain` /
`setGrandBouleSostenuto` / `setGrandBouleUnaCorda` and writes
`pedals.*` to the store inline. The engine `setSustain` /
`setSostenuto` / `setUnaCorda` calls are NOT made — the visual pedal UI
moves but the engine never hears it. (External MIDI's pedal CC IS
handled directly in `messageHandlers.ts`, but only for the `set*` engine
calls, not the store update; see issue #6 below.)

**`type` casts in pedal callback.** `GrandBoulePanel.tsx:174,176,178`
cast `value as number` and `value as boolean`. The `MidiPedalCcPayload`
union should already be discriminated — these casts paper over the
fact that it isn't.

**Presets are 3 hard-coded constants.** `repositories/grandBoulePresetCatalog.ts:10-44`
ships three presets and there is no `loadUserPreset` /
`saveUserPreset` repository. The panel's "preset shelf" is fixed.

**Presentation visualisers.** `PianoModel3D.tsx`, `StringVibrationView.tsx`,
`SpectralWaterfall.tsx`, `PianoKeyboard.tsx` are canvas-based, run a rAF
loop and (for `PianoModel3D`) render via WebGL2.

**Tests.** Almost every spec under `useCases/` is a placeholder of the form:

```ts
import * as subject from '../foo';

describe('foo', () => {
    it('should export foo', () => {
        expect(subject.foo).toBeDefined();
        const t = typeof subject.foo;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
```

Concrete count: **27** spec files in `useCases/` and `presentations/`
match the "should export" pattern. Fewer than ten files in the module
have a non-trivial test.

---

## Findings

### Adversarial review log (2026-04-28)

Re-verified every numbered issue against `src/modules/GrandBoule/` as of HEAD `0ef2e91d9`.

**Verified (cited code unchanged):** #1, #2, #3, #4, #5, #6 (with caveat — see below), #7, #8, #9, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #29, #31, #32, #33, #34, #35.

**Promoted in severity:**

- Issue #1 was framed as "loses per-device". Verification shows `saveProject.ts` and `loadProject.ts` contain **no** GrandBoule references at all (`grep -n grandBoule src/modules/Project/useCases/projectPersistence/saveProject/* loadProject.ts` returns empty). Even the `'default'` singleton is **not serialised to disk** — `resetModuleStoresToDefault` is only invoked on _new project_ creation, not on load. The singleton thus carries values forward across every project load until explicit `New Project`. Severity stays at the top of priorities; the description is rewritten below.
- Issue #5 (disconnected-engine theatre) compounds with #20 (calibration not plumbed). Together they create a completely deceptive UX where 21 of 22 user-visible knobs/buttons silently no-op.

**Demoted in severity:**

- Issue #6 (morph reset stomps state) **only fires when `morph.enabled === true`**. The default state has `enabled: false`, and `setGrandBouleMorphPosition.ts:86-97` early-returns without storewriting when `morph.enabled === false`. So it stomps only enabled-morph users on engine flip. Still a real bug, demoted from priority #5 to mid-tier.
- Issue #10 count: audit lists "27 placeholder specs". Verification: `grep -rln 'should export\|should load the module\|should be defined' src/modules/GrandBoule` returns **29 files**. The audit's grep used only the literal `should export`, missing three `'should load the module'` placeholders in `midiEventSubscribers/__tests__/`. Number corrected to 29 below.

**Demoted/corrected:**

- Issue #15 (`PianoModel3D` per-frame copy): the inline `for (let i = 0; i < vertexCount; i += 1)` JS→Float32Array copy is real, but is preceded by a `length === 0` truncation and capacity-based reuse. The hot-path is two integer compares and a typed-array store. This is not a meaningful CPU drain at NUM_KEYS=88 — issue is still valid (could be `set()` bulk copy) but the impact rating in Risks overstates it.

**New issues added:** #51, #52, #53, #54, #55, #56, #57, #58, #59, #60.

**Resolved:** none — no GrandBoule fixes have landed since the audit was written.

---

1. **Project save/load loses every GrandBoule setting (per-device AND
   singleton) — no GrandBoule state is serialised at all.** Verified by
   `grep -rn 'grandBoule\|GrandBoule' src/modules/Project/useCases/projectPersistence`:
   the only hit is `helpers/resetModuleStoresToDefault.ts:7,40`. Both
   `saveProject/saveProject.ts` and `loadProject.ts` contain **zero**
   GrandBoule references — the store is never written to disk and never
   read back. The reset helper is only invoked on _new project_
   creation; project _load_ does not touch GrandBoule at all. Effect:
   the deprecated singleton (`'default'` device) carries yesterday's
   pedals, calibration, morph, per-note overrides, and temperament
   forward across every project load until the user clicks New Project.
   Per-device stores (the panel and AudioEngine MIDI handler use
   `createGrandBouleStore(deviceId)`) are also never serialised — and
   even the `Map<deviceId, Store>` in `grandBouleStore.ts:71` survives
   in module memory across project loads. **`perNoteOverrides: Map`**
   (declared at `grandBouleStore.ts:39,60`) cannot round-trip through
   plain `JSON.stringify` — it serialises to `{}` — so even adding the
   store to `saveProject.ts` would silently drop every per-note
   override unless a custom replacer/reviver is added.

2. **Two `applyVelocityCurve` implementations, one mutated for cycle-
   avoidance.** `stores/applyVelocityCurve.ts:10` and
   `useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11` are the
   same function. The `stores/` one carries a JSDoc preamble explaining
   that it was duplicated *to avoid the AudioEngine ↔ GrandBoule barrel
   cycle*. The fix-by-duplication is itself an architectural smell:
   the import-cycle problem is solved at the cost of correctness drift
   (any future patch to the curve must be made in two files). Both
   functions are re-exported from `useCases/index.ts:2` and
   `stores/index.ts:8` simultaneously, so cross-module callers can
   pick either.

3. **`parameters.velocityCurve` and `midiCalibration.velocityCurveExponent`
   are two settings for the same concept and they collide.**
   `setGrandBouleVelocityCurve` writes only `parameters.velocityCurve`
   (engine-side curve). `applyVelocityCurve` reads only
   `midiCalibration.velocityCurveExponent`. A user adjusting the
   "Touch / Curve" knob (`GrandBoulePanel.tsx:543-552`) updates the
   engine but not the JS-side curve applied to manual key clicks; a user
   adjusting the "MIDI Calibration / Curve" knob updates the JS-side
   curve but not the engine. Loading a preset writes
   `parameters.velocityCurve` only — it does not modify
   `midiCalibration.velocityCurveExponent`. Result: presets and
   "Touch" knob shape WASM playback; MIDI Calibration shapes only the
   JS-mediated paths (`triggerGrandBouleNote`, the AudioEngine MIDI
   handler). The two diverge silently.

4. **Pedal handlers in the panel skip the use cases entirely.**
   `GrandBoulePanel.tsx:173-179` (the `onMidiPedalCc` subscriber)
   updates `store.pedals` inline and does NOT call
   `setGrandBouleSustain` / `setGrandBouleSostenuto` /
   `setGrandBouleUnaCorda`, so `engine.setSustain`/`setSostenuto`/
   `setUnaCorda` are never dispatched from the in-panel listener for
   MIDI pedal CC. The damper model in WASM never hears half-pedal
   adjustments arriving via the in-panel listener; the visual UI moves.
   (External MIDI calls land on `engine.setSustain` directly via
   `messageHandlers.ts:570`, but only because that file does not go
   through the use case either.) The use case has no users from the
   MIDI path.

5. **`loadGrandBoulePreset` lies on a disconnected engine.**
   `loadGrandBoulePreset.ts:13` does not call `engine.isReady()`. With
   `createDisconnectedGrandBouleEngineHandle` (returned by
   `resolveGrandBouleEngine` whenever the strip's
   `grandBouleControls?.ready` is `undefined`), every `engine.setParam`
   call is a no-op; the function still writes the preset to the store
   and returns `true`. The panel highlights "Classic Miche" as the
   active preset but the WASM engine is silent or playing the previous
   sound. 14 of the 16 `set*` use cases share this bug.

6. **Morph position reset on engine ready stomps user state — _when
   morph is enabled_.** `GrandBoulePanel.tsx:193-198` calls
   `setGrandBouleMorphPosition({ engine, store, morphPosition: 0 })`
   on every `engineReady → true` transition.
   `setGrandBouleMorphPosition.ts:86-97` early-returns _without store
   writeback_ when `morph.enabled === false` (the default). Only when
   the user has switched morph on does line 108 write
   `morph.morphPosition = 0` into the store. So the bug surfaces only
   for users who use the morph engine — but for them, every HMR /
   audio engine restart / suspend / resume silently destroys their
   morph position. The `eslint-disable sourdaw/no-useeffect-derived-state`
   comment claims this is a side-effect, not state derivation; it
   _is_ a state derivation that happens to also touch the engine. **Fix
   sketch:** read `store.value?.morph.morphPosition ?? 0` instead of a
   hard-coded `0`, and add a regression test mounting with
   `morph.enabled=true, morph.morphPosition=0.6`, flipping
   `engineReady`, asserting `0.6` is preserved.

7. **`setGrandBouleTemperament` API divergence.** Unlike every other
   `set*` use case in the module (which takes
   `{ engine, store, ... }`), `setGrandBouleTemperament.ts:14-19` takes
   `{ deviceId, temperament, store }` and resolves its own engine via
   `resolveGrandBouleEngine({ deviceId })`. Inside `resolveGrandBouleEngine`,
   that does a fresh `getAllTracks().find(...)` and an `ensureTrackStrip`
   per call — bypassing the §52.1 memoisation the panel goes out of its
   way to maintain (`GrandBoulePanel.tsx:124-129`). The handler also
   has no `engine.isReady()` gate, so it shares issue #5.

8. **Pedal CC payload casts in panel — `value as number` /
   `value as boolean`.** `GrandBoulePanel.tsx:174,176,178` casts
   `value` to `number` for CC64 and to `boolean` for CC66/67. The
   `MidiPedalCcPayload` type is supposed to be a discriminated union
   (the AudioEngine sends sustain as a normalised number 0..1 and
   sostenuto/una corda as a boolean threshold). The casts hide that
   the union is currently `unknown`-flavoured at the type boundary;
   AGENTS.md "TypeScript — soundness" forbids `as` to silence
   compiler errors.

9. **Test mocks pass `as never` / `as any` to compose state.**
   `useCases/__tests__/grandBoule.spec.ts:32,38,42,53,65,72`,
   `useCases/__tests__/loadGrandBoulePreset.spec.ts:34,48,75` and
   `useCases/__tests__/createGrandBouleTrack.spec.ts:13` all use
   `as any` / `as unknown` / `as never` to supply partial fixtures.
   AGENTS.md "TypeScript — soundness" forbids these escapes.

10. **29 of the unit specs are "should export"/"should load the
    module" placeholders.** Audit's original count was 27; verification
    by `grep -rln 'should export\|should load the module\|should be
defined' src/modules/GrandBoule` returned 29 — the audit's grep used
    only the literal `should export`, missing three `'should load the
    module'` placeholders in `useCases/midiEventSubscribers/__tests__/`.
    Files:
    - `useCases/__tests__/setGrandBouleSustain.spec.ts`
    - `useCases/__tests__/setGrandBouleUnaCorda.spec.ts`
    - `useCases/__tests__/loadGrandBouleAttackClip.spec.ts`
    - `useCases/__tests__/setGrandBouleMasterGain.spec.ts`
    - `useCases/__tests__/panicGrandBoule.spec.ts`
    - `useCases/__tests__/releaseGrandBouleNote.spec.ts`
    - `useCases/__tests__/triggerGrandBouleMicrotunedNote.spec.ts`
    - `useCases/__tests__/triggerGrandBouleNote.spec.ts`
    - `useCases/__tests__/setGrandBouleMorphPosition.spec.ts`
    - `useCases/__tests__/setGrandBouleSympatheticSend.spec.ts`
    - `useCases/__tests__/setGrandBouleAttackBite.spec.ts`
    - `useCases/__tests__/setGrandBouleVelocityCurve.spec.ts`
    - `useCases/__tests__/setGrandBouleStretchAmount.spec.ts`
    - `useCases/__tests__/setGrandBouleTemperament.spec.ts`
    - `useCases/__tests__/setGrandBouleSostenuto.spec.ts`
    - `useCases/__tests__/setGrandBouleSoundboardSend.spec.ts`
    - `useCases/__tests__/resolveGrandBouleEngine.spec.ts`
    - `useCases/setGrandBoulePerNoteParam/__tests__/setGrandBoulePerNoteParam.spec.ts`
    - `useCases/setGrandBoulePerNoteParam/__tests__/resetGrandBoulePerNoteParams.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setVelocityCurveExponent.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setVelocityCeiling.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setSustainThreshold.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setVelocityFloor.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setAfterTouchSensitivity.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/setCcSmoothingMs.spec.ts`
    - `useCases/calibrateGrandBouleMidi/__tests__/resetMidiCalibration.spec.ts`
    - `useCases/midiEventSubscribers/__tests__/onMidiNoteOn.spec.ts`
    - `useCases/midiEventSubscribers/__tests__/onMidiPedalCc.spec.ts`
    - `useCases/midiEventSubscribers/__tests__/onMidiNoteOff.spec.ts`

    Each contains a single assertion of the form
    `expect(subject.foo).toBeDefined()` or
    `expect(subject).toBeDefined()`. These run, pass, and prove
    nothing about behaviour. Coupled with the `vi.mock(...)` patterns
    used in `grandBoule.spec.ts`, all of the velocity-shaping,
    clamping, store-mutation, and engine-dispatch logic above is
    untested.

11. **`SpectralWaterfall.spec.tsx` passes a prop the component does
    not accept — and typecheck/test still pass.**
    `presentations/components/__tests__/SpectralWaterfall.spec.tsx:8`
    renders `<SpectralWaterfall fftFrame={null} />` but the component
    declares `analyser: AnalyserNode | null`
    (`SpectralWaterfall.tsx:18`). The spec asserts only that a
    `<canvas>` is rendered; if TypeScript or a test harness is
    suppressing the type error, it is hiding a contract drift.

12. **`GrandBoulePanel.spec.tsx` calls the panel without its required
    `deviceId` prop.** `presentations/views/__tests__/GrandBoulePanel.spec.tsx:16,21,26,31`
    renders `<GrandBoulePanel />` while
    `GrandBoulePanel.tsx:123` declares
    `({ deviceId }: { deviceId: string }): ReactElement`. The
    assertions are `expect(document.body).toBeTruthy()` and
    `buttons.length >= 0` — vacuous. The mock at `:6` replaces
    `useStore` with `(_store, defaultValue) => defaultValue`, which
    means the panel never observes any store changes. None of the
    use-case wires below `<GrandBoulePanel>` are actually executed.

13. **`PianoModel3D` carries a typo'd helper name.**
    `PianoModel3D.tsx:426` calls `hamperHSmall(hammerH)` and
    `:569-571` defines `function hamperHSmall(baseH: number)`. The
    intended name is presumably `hammerHSmall` (the file is full of
    `hammer*` references). The function does the right thing — it is
    only the name that is wrong — but a follow-up search will miss
    `hammer*`.

14. **`PianoModel3D` `unaCorda` and `sostenuto` props are accepted
    and immediately discarded.** `PianoModel3D.tsx:240-241` destructures
    them as `_unaCorda` / `_sostenuto` and never reads them. The
    component visually claims to render una-corda / sostenuto state
    (the implication of a 3D piano panel with damper rendering) but
    only honours `sustainPedal`. Either implement the visual or remove
    the props.

15. **`PianoModel3D` shaders/pipeline allocated via inline
    `gl.bufferData(... new ...)` once per frame; vertex scratch is a
    JS `number[]` copied element-by-element into a `Float32Array`.**
    `PianoModel3D.tsx:493-498` has a `for (let i = 0; i < vertexCount;
i += 1) { uploadBuffer[i] = buf[i]!; }` inside the rAF loop. With
    NUM_KEYS=88, that is in the ~10 000-element range per frame, copied
    once via JS bytecode to typed-array storage every frame. This is
    visualisation, not the audio thread, so it is not a hard rules
    violation, but it is gratuitous — push directly into the typed
    array.

16. **`StringVibrationView` rAF rate not capped; render allocates
    `ctx.beginPath` per string per frame.** `StringVibrationView.tsx:33-80`
    runs at the display refresh rate (60–144 Hz) and walks every
    string/per-pixel for a full sine waveform render. No
    `requestIdleCallback`, no visibility check (`document.hidden`).
    For an inactive panel still mounted (collapsed sidebar pattern),
    the component still draws.

17. **`SpectralWaterfall` writes `currentAnalyser.fftSize = 512`
    every render.** `SpectralWaterfall.tsx:124-129`: when the analyser
    instance changes, the code mutates `analyser.fftSize`. That is a
    write on a node owned by `AudioEngine` — cross-module boundary
    via a shared mutable handle. If multiple visualisers want different
    `fftSize` (e.g. a metering plugin needing 2048), the last writer
    wins. Either expose a copy-on-read or document that the analyser
    is exclusively owned by the visualiser when present.

18. **`SpectralWaterfall` pixel-by-pixel ImageData fill with no
    delta.** `SpectralWaterfall.tsx:162` fills the entire HISTORY_FRAMES
    × DISPLAY_COLS image every frame
    (`for (row of HISTORY_FRAMES) for (col of DISPLAY_COLS)`). Since
    only one row changes per frame, this is O(H·W) per frame instead
    of O(W). Use `putImageData` of a 1-row strip and shift the
    underlying buffer, or scroll-blit the offscreen canvas.

19. **`MidiCalibrationPanel` velocity histogram resizes with each
    `lastVelocity` change.** `MidiCalibrationPanel.tsx:75-129` runs an
    effect that *re-reads* `getBoundingClientRect`, sets
    `canvas.width/height = rect.* * dpr`, and `ctx.scale(dpr, dpr)` on
    every `samples` change (i.e. every note-on). On a typical 1×1×
    keyboard run, that is dozens of resizes per second. Hoist the
    resize into a `ResizeObserver` and only re-render when `samples`
    changes.

20. **`MidiCalibrationPanel` keeps an unbounded `velocitySamples`
    array (well, bounded at 128, but appended to with `[...prev,
lastVelocity]`).** `MidiCalibrationPanel.tsx:174-177` allocates a
    new array per note-on. With React 19's compiler that is fine
    *if* the histogram component is not re-rendering needlessly, but
    the surrounding panel re-renders on every store change — every
    pedal CC, every knob movement — and the histogram allocates
    again. Use a circular buffer `Uint8Array(128)` with a head pointer.

21. **`MidiCalibrationPanel` calibration knobs do not gate on engine
    readiness.** Same root as issue #5: turning the "Floor" /
    "Ceiling" / "CC Smooth" knobs persists to the store, but no
    engine-side dispatch occurs at all (the module never plumbs
    calibration to the engine — see issue #28). The user sees their
    knob position update, the histogram update, and assumes the
    instrument is responding.

22. **MIDI calibration values are not forwarded to the engine.** None
    of the calibration setters (`setVelocityCurveExponent`,
    `setVelocityFloor`, `setVelocityCeiling`, `setCcSmoothingMs`,
    `setSustainThreshold`, `setAfterTouchSensitivity`,
    `resetMidiCalibration`) call `engine.setParam`. Their input type
    does not even contain an `engine` field. The calibration only
    affects the JS-side `applyVelocityCurve` math; it does not affect
    `engine.setSustain`'s threshold inside the WASM, the
    aftertouch-modulated hammer force in the WASM, or the CC smoothing
    on parameter automations dispatched through `engine.setParam`.
    For a calibration UI, this is a complete UX miss.

23. **Cross-module store imports reach for the deprecated singleton.**
    `Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:7,40`
    imports the module-level singleton `grandBouleStore` (the
    `'default'` device) and resets only it. Because the persistence
    surface for GrandBoule is the singleton, the per-device factory
    pattern (`createGrandBouleStore(deviceId)`) is fundamentally
    incompatible with the rest of the project lifecycle. Either the
    factory pattern is wrong, or the persistence path is wrong; the
    two cannot both be right.

24. **Empty `events/index.ts`.** The file contains only the comment
    `// no public events`. The module emits `track.added` directly on
    the global event bus from `createGrandBouleTrack.ts:37` rather
    than declaring a typed event payload locally. Any consumer that
    wants typed payloads (e.g. for a MIDI 2.0 channel-pressure event,
    or a panic event for transport stops) currently has nowhere to
    place them. Either remove the folder or move the typed payloads
    here.

25. **`createGrandBouleTrack` lacks readiness gating around
    `addDeviceToStrip`.** `createGrandBouleTrack.ts:33-37`: append the
    track, call `addDeviceToStrip`, emit `track.added`. If
    `ensureTrackStrip` later fails (no audio context), the track exists
    in the store but the strip does not, and the panel renders against
    a disconnected engine forever. There is no `Result` /
    `neverthrow` at the boundary.

26. **`triggerGrandBouleNote` doc comment is misleading.**
    `triggerGrandBouleNote.ts:29` says
    `// Map normalized velocity back to 0-127 for applyVelocityCurve,
then back to 0-1`. `applyVelocityCurve` already returns 0..1, the
    "back to 0-1" is a no-op the comment imagines. `applyVelocityCurve`
    accepts 0..127 and returns 0..1 in one direction; the function
    being called does not have a "back" trip.

27. **`triggerGrandBouleNote` falls through to engine when state is
    null.** `triggerGrandBouleNote.ts:27-31`: if `store.value` is
    null, `calibration` is `undefined` and the velocity is passed
    raw (input.velocity, 0..1) to `engine.noteOn`. With a
    *non-null* state the curve is applied. This means a user note on
    an uninitialised store gets unshaped velocity, which differs from
    every subsequent note. Inconsistent.

28. **`triggerGrandBouleMicrotunedNote` has no engine readiness
    check.** `triggerGrandBouleMicrotunedNote.ts:20-29` calls
    `engine.noteOnMidi2(...)` unconditionally. Pair this with the
    disconnected handle's silent `noteOnMidi2: () => {}` and the
    function is a black box.

29. **`loadGrandBouleAttackClip` clamps key but does not check engine
    or sample rate.** `loadGrandBouleAttackClip.ts:18-22` validates
    `key in [1, 88]` and forwards the `Float32Array` to the engine.
    The DSP (per the docstring) requires "sample-rate-matched" PCM —
    the function does not validate the sample rate of the clip
    against the engine's sample rate. A 48 kHz clip on a 44.1 kHz
    engine plays back ~9% off in pitch.

30. **`setGrandBouleMorphPosition` returns silently when models are
    missing.** `setGrandBouleMorphPosition.ts:80-103`: if
    `findPianoModelById(morph.modelA)` or `findPianoModelById(morph.modelB)`
    returns `undefined`, the function returns. The store's `morph.modelA`
    is currently `'steinway-d'` by default, but a project file from
    earlier could still contain an unknown ID; in that case, every
    morph knob movement is a silent no-op. No `notifyUser`, no
    `logger.warn`.

31. **`createGrandBouleTrack` device id has insufficient entropy.**
    `createGrandBouleTrack.ts:22`:
    `` `grand-boule-${crypto.randomUUID().slice(0, 8)}` ``. Eight hex
    chars = 32 bits = ~4 billion. With concurrent multi-track creates
    this is fine; the comment is more about consistency — every
    other module uses the full UUID. Slicing off 24 characters of
    randomness for "neat-looking IDs" is a code smell.

32. **`PianoKeyboard` velocity is hard-coded `0.8`.**
    `PianoKeyboard.tsx:39` always emits `onNoteOn(midiNote, 0.8)`,
    regardless of the press gesture. Same in
    `PianoModel3D.tsx:536`. The Web Pointer API exposes `pressure`
    (0..1, force-touch / pen) — this could drive velocity. The
    keyboard is currently a binary on/off mapped to mid-volume.

33. **`PianoKeyboard` lacks keyboard input.** No `onKeyDown` /
    `tabindex` handling. The 88 keys are buttons but the user cannot
    tab through and play with the spacebar. The aria-labels are bare
    MIDI numbers (`MIDI 60`) rather than note names (`C4`).

34. **`PianoModel3D` has no panic on key-up if `setPointerCapture`
    fails.** `PianoModel3D.tsx:531`:
    `(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);`
    — type cast hides that `pointerId` in some browsers (Safari iOS
    historically) silently no-ops. The `handlePointerUp` /
    `handlePointerLeave` rely on the captured pointer firing the
    release. If capture fails, the note hangs.

35. **`PerNoteEditor` inserts every key into the override map on
    first edit.** `setGrandBoulePerNoteParam.ts:41-46` reads `existing
?? createDefaultPerNoteValues()` and writes the whole object back —
    so editing one parameter on key 40 writes all 8 default values
    plus the change for that key. The "is this key overridden?" gate
    in `PerNoteEditor.tsx:51` (`hasOverrides = perNoteOverrides.has(selectedKey)`)
    therefore returns true even when the user only changed one knob
    away from default and back. The "Reset" button is enabled because
    the map has the entry, even though the entry is functionally
    default.

36. **Per-note default cascade re-allocates on every render.**
    `PerNoteEditor.tsx:50` calls `createDefaultPerNoteValues()` per
    render. The function returns a fresh object every time — fine
    semantically, wasteful structurally. Hoist to a module constant
    or pre-compute via `Object.freeze`.

37. **`MorphPanel` model lookup ignores morph state changes from
    outside.** `MorphPanel.tsx:158-159`:
    `const modelA = BUILTIN_PIANO_MODELS.find((m) => m.id === morph.modelA)`
    runs on every render. With four models that's a 4-element scan,
    fine in isolation, but if `morph.modelA` is unknown (e.g. project
    loaded with a model from a future release) the BlendIndicator
    silently shows `'A'` / `'B'` placeholders and the knobs still
    *visually* dispatch. There is no error path.

38. **`MorphPanel` Reset/disable behaviour silently overrides knob
    movements.** When `morph.enabled === false` the morph knob still
    accepts user input (the wrapper gets `pointer-events-none` and
    `opacity-35`, but the underlying knob handler `onMorphPositionChange`
    is still bound). Hover on the parent makes the inner knob not
    fire because of `pointer-events-none`, so practically OK, but if
    a future change loosens the wrapper, the knob will dispatch and
    `setGrandBouleMorphPosition.ts:86-97` will write modelA's
    parameters to the engine — which feels wrong for a "disabled"
    morph.

39. **`GrandBoulePanel`'s `onMidiPedalCc` handler has no fallback for
    other CCs.** `GrandBoulePanel.tsx:165-180`: the handler short-
    circuits on CC64/66/67 and is silent for everything else. That is
    fine for now, but the function is `eventBus.on('midi.pedalCc',
...)` — a publisher of *any* pedal CC. A future modulation pedal
    (CC1, CC11, CC74) will be silently dropped; the audit raises this
    as a contract gap rather than a bug.

40. **Cross-module imports of the legacy `grandBouleStore` and
    `applyVelocityCurve` rely on `stores/` being treated as a
    contract-folder barrel.** `stores/index.ts:1-8` re-exports both the
    legacy singleton and the duplicate `applyVelocityCurve`. This
    means `#/modules/GrandBoule/stores` exposes:
    - `grandBouleStore` (deprecated, singleton, source of issue #1)
    - `createGrandBouleStore` (the per-device factory)
    - `defaultGrandBouleState` and `createDefaultGrandBouleState`
    - `applyVelocityCurve` (duplicated; see issue #2)

    Cross-module callers (`AudioEngine`, `Project`) silently choose
    between live and deprecated APIs from the same surface.

41. **No root `index.ts` *or* explicit module-spec for GrandBoule.**
    Per `.dependency-cruiser.cjs:7-24`, the target state is "no root
    index.ts" with four contract folders. GrandBoule is in that target
    state — `events/`, `stores/`, `useCases/`, `presentations/views/`
    each have an `index.ts`. But the contract is fragile: `events/index.ts`
    is empty, `stores/index.ts` exports the deprecated singleton
    alongside the live API, `useCases/index.ts` exposes only two of
    the seventeen use cases (`createGrandBouleTrack` and
    `applyVelocityCurve`). External callers must choose between
    importing from `stores/` (a runtime mutable surface) and waiting
    for `useCases/` to expose what they need.

42. **`useCases/index.ts` re-exports `applyVelocityCurve` from a
    nested folder.** `useCases/index.ts:2`:
    `export { applyVelocityCurve } from './calibrateGrandBouleMidi/applyVelocityCurve';`
    — combined with `stores/index.ts:8`'s identical re-export of the
    duplicate file, two cross-module surfaces ship the same name.

43. **`midiEventSubscribers/onMidi*.ts` are inject-wrapped passthroughs
    of `eventBus.on(...)`.** `onMidiNoteOn.ts:5-10`, `onMidiNoteOff.ts:5-10`,
    `onMidiPedalCc.ts:5-10` each `inject({ eventBus })` and return a
    function that immediately calls `eventBus.on('midi.<x>', handler)`.
    They add no validation, no filtering, no per-device routing
    (the panel does that filter inline). That's three files of
    indirection for what `eventBus.on('midi.noteOn', handler)` does
    natively. AGENTS.md "Use cases orchestrate repositories" — these
    use cases orchestrate nothing.

44. **`createGrandBouleTrack` device suffix uses fewer than 6 chars
    of UUID entropy in tests.** `__tests__/createGrandBouleTrack.spec.ts:78`
    asserts `expect.stringMatching(/^grand-boule-/)` — the test does
    not pin down or validate the entropy width. Combined with
    `:slice(0, 8)`, a future shrinkage of the suffix would not surface
    in tests.

45. **`GrandBoulePanel.tsx` imports relatively from
    `../../useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam`
    and similar deep paths.** That is correct per AGENTS.md
    (intra-module = relative). But the panel ends up with **31 import
    lines** for **30 use cases**. The inconsistency is that
    `setGrandBouleTemperament` takes `deviceId` while every sibling
    takes `engine` (issue #7) — calling all 30 from one component
    means the bug surfaces in every preset switch.

46. **`PianoModel3D` `pressedNoteRef` only tracks one pressed note
    at a time.** `PianoModel3D.tsx:248,535`: pointer-down sets the
    single ref; pointer-up reads it. Multi-touch (iPad / multi-finger
    chord) is impossible because each new pointer-down stomps the
    ref and orphans the previous note's pointer-up. No
    `Map<pointerId, midiNote>` is kept. The 88-key piano supports
    one finger.

47. **`StringVibrationView.runCanvas2DFrame` reads `phase` field on
    `StringState` but never writes it.** `StringVibrationView.tsx:17`
    declares `{ amplitude; phase; frequency }`, line 33 never updates
    `phase`. The phase is implicitly carried by `frameRef.current *
0.08` (`:53`) — global, not per-string. The struct holds a dead
    field.

48. **No accessibility for the dynamic data.** `PianoModel3D` has
    `aria-label="Grand Boule interactive piano"` but no live region
    announcing the current played note for screen readers. The panel
    relies entirely on visual feedback (knob position, animated
    keys, FFT colour). The `Voices: N` tile has no `aria-live`. A
    keyboard-only or AT user has no signal that any note played.

49. **`MidiCalibrationPanel` velocity histogram has no readable
    description.** The canvas has no `aria-label`; a screen reader
    user gets no idea what the colourful bars represent.

50. **No telemetry contract for `activeVoices`.**
    `grandBouleStore.ts:47` exposes `activeVoices` as a number on the
    store. No use case writes to it. No engine push exists. The panel
    at `GrandBoulePanel.tsx:432` displays it. Display-only telemetry
    that is never updated will always show `0`. Either remove the
    field or wire the engine to push it.

51. **`engineReady: boolean` field on the store is dead — never
    written, never read by any use case, and the panel reads
    `engine.isReady()` directly instead.** `grandBouleStore.ts:45,63`
    declares the field and seeds `false`; verified by
    `grep -rn engineReady src/modules/GrandBoule`: every reference is
    either the type declaration, the default initialiser, a test
    fixture (`__tests__/helpers.spec.ts:29`,
    `loadGrandBoulePreset.spec.ts:68`), or `GrandBoulePanel.tsx:191`
    using a _local_ `const engineReady = engine.isReady()` — not the
    store field. The field exists only to placate the
    project-persistence shape (which does not save the store anyway,
    see #1). Remove from `GrandBouleState`, `createDefaultGrandBouleState`,
    and the test fixtures, OR wire AudioEngine to push readiness
    transitions through this field so the `useEffect` at
    `GrandBoulePanel.tsx:193-198` can subscribe to it instead of
    polling via `engine.isReady()` every render.

52. **`PianoKeyboard.tsx` is dead code.** Verified by
    `grep -rn 'PianoKeyboard' src` — the only consumer is the
    component's own spec at
    `presentations/components/__tests__/PianoKeyboard.spec.tsx`. The
    panel uses `PianoModel3D` exclusively
    (`GrandBoulePanel.tsx:445-454`). The component carries
    issues #31 (hard-coded velocity 0.8), #32 (no keyboard nav, no
    note-name labels), and the placeholder spec — all in code that
    ships in the bundle but is never rendered. Either delete
    `PianoKeyboard.tsx` and `PianoKeyboard.spec.tsx`, or use it in
    place of `PianoModel3D` for the lower-resource path. (Per the
    safety rules: do not delete files without explicit instruction —
    surface this to the user.)

53. **`resolveGrandBouleEngine` violates AGENTS.md "Use-case types
    stay private".** `useCases/resolveGrandBouleEngine.ts:20` declares
    `export type ResolvedGrandBouleEngine = GrandBouleEngineHandle`
    and `GrandBoulePanel.tsx:29` does
    `import { type ResolvedGrandBouleEngine } from
'../../useCases/resolveGrandBouleEngine'`. AGENTS.md is explicit:
    "Do not `export type` from `useCases/` for other modules". Even
    though both files are inside the GrandBoule module, the rule
    applies to any cross-module surface — and the type alias is not
    needed at all (it is byte-identical to `GrandBouleEngineHandle`,
    which lives in `repositories/` and is freely usable from the panel
    via `ReturnType<typeof resolveGrandBouleEngine>`). Drop the
    re-alias and the export.

54. **`createGrandBouleTrack` mutates the freshly-created `Track`
    after `createTrack` returns it.** `createGrandBouleTrack.ts:21-31`:
    `const track = createTrack(...); track.devices = [...]; appendTrack(track)`.
    `createTrack` is the canonical use case for building a track; if
    its contract is "returns a complete track", the mutation here
    bypasses it. If the contract is "returns a track without devices",
    every other module that uses `createTrack` is racing with the same
    pattern. Either `createTrack` should accept a `devices` parameter,
    or `createGrandBouleTrack` should call `appendTrack` first and
    then a separate `addDeviceToTrack` use case (which does not exist).
    The current pattern: write to a returned object's mutable field
    before pushing to the store, then call `addDeviceToStrip` against
    a strip that was implicitly created by `appendTrack(track)` —
    relies on `appendTrack` running synchronously and on
    `ensureTrackStrip` being idempotent, neither of which is asserted
    locally. **Fix sketch:** either (a) add a `devices` parameter to
    `createTrack`, or (b) decouple — emit `track.created` first, let
    a subscriber wire `addDeviceToStrip`. Surface the unsafe mutation
    pattern at `Arrangement` review.

55. **`createGrandBouleTrack` does not check `addDeviceToStrip`'s
    success and emits `track.added` regardless.**
    `createGrandBouleTrack.ts:33-37`: `appendTrack(track);
addDeviceToStrip(track.id, deviceId, 'grand-boule'); void
eventBus.emit('track.added', ...)`. If `addDeviceToStrip` throws or
    silently fails (no audio context, WASM not loaded), the track
    exists but the engine strip does not. The function emits
    `track.added` and returns the track id; downstream subscribers
    (Arrangement view, automation lane creators) will assume the track
    is fully wired. **Fix sketch:** wrap `addDeviceToStrip` in a
    `Result`/`neverthrow`, on failure roll back the `appendTrack` (or
    surface a `notifyUser` toast and remove the track), and only emit
    `track.added` on success.

56. **`triggerGrandBouleNote` velocity round-trip is lossy and the
    code reads as if the author already knew it.**
    `triggerGrandBouleNote.ts:30`:
    `applyVelocityCurve(input.velocity * 127, calibration)` where
    `input.velocity` is documented as "Normalised velocity in 0.0 .. 1.0".
    `applyVelocityCurve` does
    `Math.max(0, Math.min(1, rawVelocity / 127))` — i.e. it expects
    0..127 and divides by 127 internally. Multiplying the 0..1 input
    by 127 only to have the curve divide by 127 is a no-op _per se_
    but it loses precision: a fractional velocity like `0.5031`
    becomes `63.8937` then back to `0.50310...` with float drift, and
    a velocity at the endpoints (`1.0`) traverses `127.0 → 1.0` with
    no harm but `0.99` → `125.73` → `0.9899...`. More importantly,
    the comment at line 29 is a textbook "feedback_code_should_self_explain"
    violation (see issue #23) — the author knew it was odd enough to
    explain. **Fix:** make `applyVelocityCurve` overload-take a 0..1
    input directly (or rename current as `applyVelocityCurveFromMidi`)
    and pass `input.velocity` straight through. Eliminate the round-
    trip.

57. **`MidiCalibrationPanel.VelocityHistogram` resizes and re-DPR-
    scales the canvas on _every note-on_, and on every reset, and on
    every render-driven prop change.**
    `MidiCalibrationPanel.tsx:75-129`: the resize block (read
    `getBoundingClientRect`, set `canvas.width/height *= dpr`,
    `ctx.scale(dpr, dpr)`) lives inside the same `useEffect([samples])`
    that draws bars. Setting `canvas.width = ...` _clears_ the canvas
    and resets the transform — that is fine because the draw follows
    immediately, but `ctx.scale(dpr, dpr)` is _additive_; on each
    note-on the existing transform is multiplied by `dpr` again. With
    `devicePixelRatio = 2` the cumulative transform after 4 note-ons
    is 16× — which silently passes because `canvas.width = ...` _on
    that same render_ resets it. The fragility: if a future patch
    adds an early-return that skips the `canvas.width` assignment,
    the `ctx.scale(dpr, dpr)` still runs and the cumulative transform
    leaks. The bug is latent. **Fix sketch:** split the resize
    (driven by `ResizeObserver` on the container) from the draw
    (driven by `[samples]` change), and never compound `ctx.scale`.
    Cross-references issues #16 and #19.

58. **`setGrandBouleTemperament`'s use of `resolveGrandBouleEngine({
deviceId })` (no `tracks` argument) hits `getAllTracks()`
    synchronously, on the audio-thread side of every dispatch.**
    `setGrandBouleTemperament.ts:31` →
    `resolveGrandBouleEngine.ts:23`:
    `const tracks = input.tracks ?? getAllTracks()`. `getAllTracks`
    reads from the live `trackStore` — a synchronous `store.value`
    read, fine in non-RT context but called from a panel button
    click. The actual cost is the inner `tracks.find(...)` and
    `ensureTrackStrip(track.id)` per call. Combined with #7 (API
    divergence) this means: the user clicks "Werckmeister III", the
    panel _re-resolves the engine_, scanning every track in the
    project, then pushes one number to the engine. With 50 tracks
    that is a 50-element scan plus a `ensureTrackStrip` allocation
    per click. §52.1 was added for the per-render path, but
    `setGrandBouleTemperament` undoes that design. **Fix:** consume
    `input.engine` from the panel like all 15 siblings (issue #7's
    fix incidentally resolves this).

59. **Pedal CC `value` from external MIDI is a bare `number` (0..1
    for sustain), but the AudioEngine emits `value: number | boolean`
    on `midi.pedalCc`** (`messageHandlers.ts:570-589` for sustain
    sends `value: value / 127` as a `number` in 0..1; sostenuto/una
    corda send `value: value >= 64` as a `boolean`). The `WorkspaceEvents.ts`
    type `MidiPedalCcPayload = { ... value: number | boolean }` is a
    raw union, not a discriminated one. The panel and the AudioEngine
    handler implicitly _agree_ on which CC carries which type, but
    the type system does not enforce it. A future change to send
    sostenuto as `number` (half-pedal) — or a typo in the AudioEngine
    that swaps numeric and boolean payloads — passes typecheck. The
    `as number` / `as boolean` casts at `GrandBoulePanel.tsx:174,176,178`
    are the smoke. (Issue #8 surfaced the casts; this finding makes
    explicit that the cause is in the cross-module event contract.)

60. **`onMidiNoteOff` does not carry velocity, but `triggerGrandBouleNote`
    and the panel rely on it for the visual highlight only — release
    velocity is silently dropped.** `Workspace/events/WorkspaceEvents.ts:48`:
    `MidiNoteOffPayload = { deviceId?: string; midiNote: number }` —
    no velocity. The panel's `setActiveNotes` map carries the
    note-on velocity until a `noteOff` arrives; release velocity is
    never observed. For an instrument plugin spec that emphasises
    physical-modelling fidelity, dropping release velocity is a real
    expressive miss. The Web MIDI API _does_ expose release velocity
    on note-off messages. **Fix sketch:** extend the payload, plumb
    through `messageHandlers.ts:noteOff` path, and forward to
    `engine.noteOff({ midiNote, releaseVelocity })`. Engine handle
    needs a release-velocity field added to `noteOff`'s input.

---

## Priorities

1. **No GrandBoule state is serialised by `saveProject` / `loadProject`
   at all** (issue #1) — verified by grep. Every loaded project
   inherits yesterday's pedals, calibration, morph, per-note
   overrides, and temperament from the in-memory singleton. Per-device
   stores survive the project switch entirely. This is correctness-
   class data corruption disguised as state, and it is the single
   most user-visible bug.
2. **`loadGrandBoulePreset` and 14 other `set*` use cases lie on a
   disconnected engine** (issue #5) — UI shows success, WASM is
   silent. This compounds with issue #20 (calibration not plumbed to
   engine) so 21 of 22 user-visible knobs/buttons silently no-op
   when the engine is not ready.
3. **Two divergent `applyVelocityCurve` implementations + two
   divergent velocity-curve fields** (issues #2, #3) — preset and
   calibration knobs do not affect the same playback paths.
4. **Pedal CC handler in panel writes the store inline, skipping the
   `set*` use cases** (issue #4) — visual UI moves but engine pedals
   may not, except via the AudioEngine's parallel handler.
5. **`setGrandBouleTemperament` API divergence** (issue #7, deepened
   by #58) — bug-masking helper that rebuilds an engine handle every
   call, scanning the entire track list, breaking the §52.1
   memoisation everywhere.
6. **Tests are placeholder export-checks** (issue #10, count
   corrected to 29) — a refactor of `triggerGrandBouleNote` /
   `setGrandBouleMorphPosition` / `loadGrandBoulePreset` could ship
   broken without any failure.
7. **MIDI calibration values never reach the engine** (issue #20) —
   the calibration UI is decorative for the WASM side.
8. **`PianoKeyboard.tsx` is dead code** (new issue #52) — a 100-line
   component that ships in the bundle, has its own placeholder spec,
   and is never rendered.
9. **`SpectralWaterfall.spec.tsx` typecheck/test mismatch** (issue
   #11) — passing `fftFrame` where the prop is `analyser`. Either
   the test is silently lying or the typecheck is suppressed.
10. **`engineReady` field on the store is dead** (new issue #51) —
    declared and defaulted but never written or read by use cases.
    The panel uses `engine.isReady()` directly. The field exists
    only because it would be in the persistence shape if the store
    were ever persisted (which it isn't — see #1).
11. **Morph reset stomps user state when morph is enabled** (issue
    #6, demoted from #5 to here based on `morph.enabled` gating).
12. **`as never` / `as any` / `as unknown` escapes in tests** (issue
    #9) — AGENTS.md "TypeScript — soundness" forbids these.

---

## Open issues

### 1. Project save/load loses per-device GrandBoule state

**Problem:** `Project/useCases/projectPersistence/helpers/
resetModuleStoresToDefault.ts:7,40` is the only consumer of GrandBoule
storage from the project lifecycle, and it imports the deprecated
singleton `grandBouleStore = createGrandBouleStore('default')`. The
panel and the AudioEngine MIDI handler use
`createGrandBouleStore(deviceId)` per device. Per-device state is
never reset, never serialized, never deserialized. Loading a project
leaves yesterday's pedals/calibration/morph/per-note/temperament live
on the new project's GrandBoule devices.

**Representative files:**

- `src/modules/GrandBoule/stores/grandBouleStore.ts:71-85`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:131`
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts:450`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:7,40`

**Needed:** Pick one model. Either (a) keep the per-device factory and
expose `forEachGrandBouleStore(callback)` / `resetAllGrandBouleStores()`
from `stores/`, then update `resetModuleStoresToDefault` to walk the
map; OR (b) replace the factory with a single keyed store
`type GrandBouleStateMap = Record<deviceId, GrandBouleState>` so the
project persistence path can serialize/deserialize the whole map. Add
spec coverage for project-save → project-load round-trip.

### 2. Two `applyVelocityCurve` implementations

**Problem:** `stores/applyVelocityCurve.ts:10` and
`useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11` are the
same function in two files. Both are exported from the module's
contract barrels. The `stores/` copy was created to dodge an
AudioEngine ↔ GrandBoule barrel cycle; the cycle still exists at the
type level, the duplication is the workaround.

**Representative files:**

- `src/modules/GrandBoule/stores/applyVelocityCurve.ts:10`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11`
- `src/modules/GrandBoule/stores/index.ts:8`
- `src/modules/GrandBoule/useCases/index.ts:2`

**Needed:** Move the function to `#/utils/Math/` (or a new
`src/utils/midi/`) and re-export from both contract barrels. Or, if
the cycle truly must be broken, expose `applyVelocityCurve` only
from `stores/` and have the use case import it relatively from
`../stores/applyVelocityCurve`. Stop shipping two copies.

### 3. Two velocity-shaping fields, two paths, one user-visible knob

**Problem:** `parameters.velocityCurve` (engine-side, written by
`setGrandBouleVelocityCurve` and `loadGrandBoulePreset`, dispatched
to engine as `'velocity_curve'`) and
`midiCalibration.velocityCurveExponent` (JS-side, used by
`applyVelocityCurve`) are two settings for the same concept. The
"Touch / Curve" knob updates the former; the "MIDI Calibration /
Curve" knob updates the latter; presets touch only the former. The
JS-side curve and the WASM-side curve diverge silently.

**Representative files:**

- `src/modules/GrandBoule/models/GrandBoulePreset.ts:15`
- `src/modules/GrandBoule/models/GrandBouleMidiCalibration.ts:9`
- `src/modules/GrandBoule/useCases/setGrandBouleVelocityCurve.ts:32-36`
- `src/modules/GrandBoule/useCases/loadGrandBoulePreset.ts:36`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11-15`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:543-552`
- `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:221-230`

**Needed:** Pick one source. Either (a) drop
`parameters.velocityCurve` and have presets only set the calibration,
or (b) drop `midiCalibration.velocityCurveExponent` and have JS-side
shaping read `parameters.velocityCurve`. Whichever, the engine and
JS paths must apply the same exponent to the same input range. Add
a property test: synthesise a sequence of raw velocities, dispatch
through both paths, assert the output series match.

### 4. Pedal handlers in panel skip use cases

**Problem:** `GrandBoulePanel.tsx:173-179` updates `store.pedals.*`
inline for CC64/66/67 and never calls
`setGrandBouleSustain`/`setGrandBouleSostenuto`/`setGrandBouleUnaCorda`.
The use cases that *do* dispatch to the engine handle are never
reached from this listener; the visual UI moves but `engine.setSustain`
is not called from this path. (External MIDI flows through
AudioEngine's parallel handler in `messageHandlers.ts:570`, which has
its own bypass.)

**Representative files:**

- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:165-180`
- `src/modules/GrandBoule/useCases/setGrandBouleSustain.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleSostenuto.ts`
- `src/modules/GrandBoule/useCases/setGrandBouleUnaCorda.ts`

**Needed:** Replace the inline `store.set` block with the three
`setGrandBoule*` use-case calls (passing the engine handle). Fold
the `value as number`/`as boolean` casts into a discriminated union
on `MidiPedalCcPayload` (cross-reference with
`Workspace/events/WorkspaceEvents.ts`).

### 5. `loadGrandBoulePreset` (and 13 sibling use cases) lie on a
disconnected engine

**Problem:** `loadGrandBoulePreset.ts:13` does not call
`engine.isReady()`. The `createDisconnectedGrandBouleEngineHandle`
silently no-ops every method. The store is updated, the function
returns `true`, the UI highlights "active preset", and the WASM is
unaffected. The same pattern exists in `setGrandBouleMasterGain`,
`setGrandBouleSoundboardSend`, `setGrandBouleSympatheticSend`,
`setGrandBouleStretchAmount`, `setGrandBouleAttackBite`,
`setGrandBouleSustain`, `setGrandBouleSostenuto`,
`setGrandBouleUnaCorda`, `setGrandBouleVelocityCurve`,
`setGrandBouleMorphPosition`, `setGrandBouleTemperament`,
`setGrandBoulePerNoteParam`, `resetGrandBoulePerNoteParams`,
`loadGrandBouleAttackClip`, `panicGrandBoule`,
`triggerGrandBouleMicrotunedNote`.

**Representative files:**

- `src/modules/GrandBoule/useCases/loadGrandBoulePreset.ts:13`
- `src/modules/GrandBoule/repositories/grandBouleEngineHandle.ts:46-61`
- `src/modules/GrandBoule/useCases/setGrandBoule*.ts` (12 files)

**Needed:** Either (a) gate every dispatch on `engine.isReady()` and
return `false` / `Result.error('engine not ready')`, OR (b) make the
disconnected handle queue calls and replay them when a real engine
attaches. The current "fire and forget" semantics make the panel a
liar. Cross-reference the `Notification` module so the user gets a
toast when a preset cannot be applied.

### 6. Morph position resets to 0 on `engineReady`

**Problem:** `GrandBoulePanel.tsx:191-198` runs
`setGrandBouleMorphPosition({ engine, store, morphPosition: 0 })` on
every `engineReady → true` transition. The use case at
`setGrandBouleMorphPosition.ts:108` writes
`morph.morphPosition = 0` into the store. HMR, audio engine restart,
suspend/resume, project switch — any of these flip `engineReady` and
silently destroy the user's morph position.

**Representative files:**

- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:191-198`
- `src/modules/GrandBoule/useCases/setGrandBouleMorphPosition.ts:68-112`

**Needed:** Replace `morphPosition: 0` with the current
`store.value?.morph.morphPosition ?? 0` so the engine resyncs the
existing position; or split the engine-resync path from the morph-
position-write path so the latter is only called when the user moves
the knob. Add a regression test: mount panel with `morph.morphPosition
= 0.6`, flip `engineReady`, assert the store still reads `0.6`.

### 7. `setGrandBouleTemperament` API divergence

**Problem:** Unlike its 15 siblings, `setGrandBouleTemperament.ts:14-19`
takes `{ deviceId, temperament, store }` and resolves its own engine
via `resolveGrandBouleEngine({ deviceId })`. That bypasses §52.1
memoisation (the panel went out of its way to subscribe to
`trackStore` and pass the resulting list to `resolveGrandBouleEngine`),
performs `getAllTracks().find(...)` and `ensureTrackStrip(...)` on
every call, and has no `engine.isReady()` gate.

**Representative files:**

- `src/modules/GrandBoule/useCases/setGrandBouleTemperament.ts:14-33`
- `src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts:22-50`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:520-528`

**Needed:** Convert `setGrandBouleTemperament` to take
`{ engine, store, temperament }` like its siblings. Drop the internal
`resolveGrandBouleEngine` call. Update the panel callsite.

### 8. Pedal CC payload casts in panel

**Problem:** `GrandBoulePanel.tsx:174-178` casts pedal CC `value` to
`number` (sustain) and `boolean` (sostenuto, una corda). The
`MidiPedalCcPayload` union should already discriminate on `cc`. The
casts hide a type-soundness gap.

**Representative files:**

- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:174,176,178`
- `src/modules/Workspace/events/WorkspaceEvents.ts` (cross-reference)

**Needed:** Tighten `MidiPedalCcPayload` to a discriminated union
(e.g. `{ cc: 64; value: number } | { cc: 66 | 67; value: boolean }`)
or pass a typed payload (`{ kind: 'sustain'; position: number } |
{ kind: 'sostenuto' | 'unaCorda'; engaged: boolean }`). Drop the
`as` casts.

### 9. Tests use `as any` / `as unknown` / `as never`

**Problem:** Spec files cast partial fixtures to bypass typing.

**Representative files:**

- `src/modules/GrandBoule/useCases/__tests__/grandBoule.spec.ts:32,38,42,53,65,72`
- `src/modules/GrandBoule/useCases/__tests__/loadGrandBoulePreset.spec.ts:34,48,75`
- `src/modules/GrandBoule/useCases/__tests__/createGrandBouleTrack.spec.ts:13`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/__tests__/helpers.spec.ts:18`

**Needed:** Build typed fixtures (`createDefaultGrandBouleState()`
already exists; reuse it). Replace inline factories with
`vi.mocked(...)` and the real generic.

### 10. 27 placeholder "should export" specs

**Problem:** Most use-case specs assert only that
`subject.foo` is defined. The actual behaviour (clamping, store
mutation, engine dispatch, no-op-on-disconnect, default propagation)
is uncovered.

**Representative files:** see "Findings" #10 above for the full list
(spans `useCases/__tests__/`, `useCases/calibrateGrandBouleMidi/
__tests__/`, `useCases/midiEventSubscribers/__tests__/`, and
`useCases/setGrandBoulePerNoteParam/__tests__/`).

**Needed:** For each placeholder, write a real behavioural spec
asserting (a) the clamping bounds, (b) the store mutation diff,
(c) the engine.setParam name+value, and (d) the no-op behaviour
when state is null.

### 11. `SpectralWaterfall.spec.tsx` types do not match the component

**Problem:** Spec passes `<SpectralWaterfall fftFrame={null} />` but
the component declares `analyser: AnalyserNode | null`. Either the
type error is being suppressed somewhere, or the test is silently
lying about coverage.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/__tests__/SpectralWaterfall.spec.tsx:8`
- `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:18`

**Needed:** Pass a typed analyser stub (`{} as AnalyserNode` is
forbidden by AGENTS.md soundness; use a real
`new AudioContext().createAnalyser()` from `OfflineAudioContext`,
or define a typed stub interface).

### 12. `GrandBoulePanel.spec.tsx` renders without required prop

**Problem:** Component requires `deviceId: string`. Test renders
`<GrandBoulePanel />` four times without it. Assertions are
`expect(document.body).toBeTruthy()` and `buttons.length >= 0` —
vacuous. The mock at `:6` makes `useStore` always return the
default value, which means the panel never reflects any store
changes. None of the use-case wiring is exercised.

**Representative files:**

- `src/modules/GrandBoule/presentations/views/__tests__/GrandBoulePanel.spec.tsx:6,15-34`

**Needed:** Pass a real `deviceId`, mock the use-case modules to
spy on dispatch, click on a preset button, assert
`loadGrandBoulePreset` was called. Fail on `useStore` returning the
default (the panel must subscribe to a store that reflects
`config.activePresetId`).

### 13. `PianoModel3D` typo: `hamperHSmall`

**Problem:** Helper function is named `hamperHSmall`
(`PianoModel3D.tsx:569`) and called at `:426`. Intended name is
`hammerHSmall`. The function works; the name does not show up under
"hammer*" search.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx:426,569`

**Needed:** Rename to `hammerHSmall`. Mechanical edit.

### 14. `PianoModel3D` accepts `unaCorda` and `sostenuto` props but
ignores them

**Problem:** Props destructured as `_unaCorda` / `_sostenuto`, never
read. Either implement the visualisation or remove the props from the
component contract.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx:240-241`

**Needed:** Decide. If una-corda should darken/desaturate the bass
keys and sostenuto should hold a damper-lift state on captured keys,
implement; otherwise drop the props and the panel forwarders.

### 15. `PianoModel3D` single-pointer-only

**Problem:** `pressedNoteRef.current: number | null` only tracks one
pressed note. Multi-touch (iPad / multiple fingers) is impossible.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx:248,535,544`

**Needed:** Replace with `Map<pointerId, midiNote>`. On
pointer-down, register; on pointer-up, look up the note via
`pointerId`; ensure pointer-cancel clears.

### 16. `MidiCalibrationPanel` velocity histogram resizes per
note-on

**Problem:** `MidiCalibrationPanel.tsx:75-129` runs the entire canvas
resize + transform reset on every `samples` change. With external
MIDI input, that is dozens of times per second.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:75-129,170-178`

**Needed:** Hoist resize into a `ResizeObserver`. Use a circular
`Uint8Array(128)` buffer for samples, drop the `[...prev,
lastVelocity]` allocation per note-on.

### 17. `SpectralWaterfall` mutates a shared `AnalyserNode`

**Problem:** `SpectralWaterfall.tsx:124-129` writes
`currentAnalyser.fftSize = 512` whenever the analyser changes. The
analyser is owned by the `AudioEngine` track strip; another module
wanting a different `fftSize` is silently overridden.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:124-129`

**Needed:** Document analyser ownership in `AudioEngineState.ts` (the
`analyserNode` field), or convert the spectral waterfall to read via
its own analyser tap. If the visualiser is the only consumer, that's
fine — but the contract should be explicit.

### 18. `SpectralWaterfall` redraws the entire waterfall every frame

**Problem:** Per-frame inner loop runs `for (row of 128) for (col of
176)` → 22 528 pixel writes per frame even though only one row
changes per frame.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:158-183`

**Needed:** Scroll-blit: keep the offscreen canvas as a circular
ring, draw only the new row, then `drawImage` with two offsets to
present the rolled view. Cuts per-frame work from O(H·W) to O(W).

### 19. `MidiCalibrationPanel` has no aria-label on the histogram
canvas

**Problem:** Screen-reader users get no description of the velocity
histogram.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:131-132`

**Needed:** Add `aria-label="Velocity histogram showing recent
input distribution"` and `role="img"`. Live updates are not strictly
needed for a histogram (textual summary in the "Last Velocity" tile
is sufficient).

### 20. MIDI calibration is never plumbed to the engine

**Problem:** None of the calibration setters
(`setVelocityCurveExponent`, `setVelocityFloor`, `setVelocityCeiling`,
`setCcSmoothingMs`, `setSustainThreshold`,
`setAfterTouchSensitivity`, `resetMidiCalibration`) call
`engine.setParam`. The values only affect the JS-side
`applyVelocityCurve` math.

**Representative files:**

- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setVelocityFloor.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setVelocityCeiling.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setVelocityCurveExponent.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setCcSmoothingMs.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setSustainThreshold.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/setAfterTouchSensitivity.ts`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/resetMidiCalibration.ts`

**Needed:** Either (a) collapse the calibration into preset
parameters that are dispatched as `setParam('velocity_floor', …)`
etc., or (b) decide that the calibration is intentionally JS-side
and document so. Without dispatch, the "CC Smooth", "Sustain
Threshold", and "Aftertouch" knobs are visual only.

### 21. `loadGrandBouleAttackClip` does not validate sample rate

**Problem:** Per the docstring, the engine requires a "sample-rate-
matched" PCM Float32Array. The function only validates the key
range. A clip recorded at 48 kHz on a 44.1 kHz engine will play back
at the wrong pitch.

**Representative files:**

- `src/modules/GrandBoule/useCases/loadGrandBouleAttackClip.ts:17-22`

**Needed:** Accept `{ key, samples, sampleRate }`. Compare against
the engine's sample rate (via `engine.context.sampleRate` if
exposed) and either resample via `OfflineAudioContext` or refuse with
a `Result.error`.

### 22. Empty `events/index.ts`

**Problem:** Comment-only file; no typed events. The module emits
`track.added` directly on the global event bus from
`createGrandBouleTrack.ts:37`.

**Representative files:**

- `src/modules/GrandBoule/events/index.ts:1`
- `src/modules/GrandBoule/useCases/createGrandBouleTrack.ts:37`

**Needed:** Either remove the folder (target state: no contract
folder if there are no events) or add typed payloads for at least
`grandBoule.deviceCreated`, `grandBoule.panic`, `grandBoule.presetLoaded`.

### 23. `triggerGrandBouleNote` doc comment is wrong

**Problem:** Comment says
`// Map normalized velocity back to 0-127 for applyVelocityCurve,
then back to 0-1`. `applyVelocityCurve` takes 0..127 and returns
0..1 — there is no "back to 0-1" trip. The comment also fails to
describe the null-state fall-through (the function silently uses raw
velocity when the store is empty, see issue #24).

**Representative files:**

- `src/modules/GrandBoule/useCases/triggerGrandBouleNote.ts:29`

**Needed:** Rewrite the comment to describe the actual mapping, or
delete it (per "feedback_code_should_self_explain"). Address the
null-state divergence in the same edit.

### 24. `triggerGrandBouleNote` falls through to engine when state is
null

**Problem:** If `store.value` is null, `calibration` is undefined and
the function passes `input.velocity` raw (0..1) to `engine.noteOn`.
With a non-null state the curve is applied. Notes triggered before
the store initialises behave differently.

**Representative files:**

- `src/modules/GrandBoule/useCases/triggerGrandBouleNote.ts:27-31`

**Needed:** Either (a) early-return when state is null (matching
every other use case), or (b) apply a default curve. Pick one;
document.

### 25. `setGrandBouleMorphPosition` silently no-ops on missing
model IDs

**Problem:** `setGrandBouleMorphPosition.ts:80-103`: if
`findPianoModelById(morph.modelA)` or `…modelB` returns `undefined`,
the function returns. Project files from earlier could carry an
unknown ID; every morph movement becomes a silent no-op with no
toast.

**Representative files:**

- `src/modules/GrandBoule/useCases/setGrandBouleMorphPosition.ts:81-103`

**Needed:** When a model is unknown, fall back to `'steinway-d'` and
emit a `notifyUser` (or `logger.warn`) once per session. Or, on
project load, validate model IDs against `BUILTIN_PIANO_MODELS` and
reset to default with a toast.

### 26. `createGrandBouleTrack` device id has 32 bits of entropy

**Problem:** `crypto.randomUUID().slice(0, 8)` keeps 32 bits of
entropy. Other modules in this codebase use the full UUID. The
slicing was for "neat IDs"; with concurrent multi-device creates it's
fine in practice but inconsistent with siblings.

**Representative files:**

- `src/modules/GrandBoule/useCases/createGrandBouleTrack.ts:22`

**Needed:** Use `crypto.randomUUID()` without slicing (matches every
other device-creation use case). Mechanical change.

### 27. `midiEventSubscribers/onMidi*.ts` are inject-wrapped pass-
throughs

**Problem:** Three files in `useCases/midiEventSubscribers/` re-wrap
`eventBus.on('midi.<x>', handler)` via `inject({ eventBus })` and
add zero behaviour. They satisfy the "useCases wrap repositories"
convention cosmetically but introduce three files of indirection.

**Representative files:**

- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiNoteOn.ts`
- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiNoteOff.ts`
- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiPedalCc.ts`

**Needed:** Either (a) inline the `eventBus.on(...)` calls in the
panel (the only consumer), removing the three files and their
placeholder specs; OR (b) absorb a real responsibility (per-device
filtering, sample-frame normalisation, payload validation). Stop
shipping no-op indirection.

### 28. `PerNoteEditor.hasOverrides` reports false-positives

**Problem:** `setGrandBoulePerNoteParam.ts:41-46` writes the *full*
8-field object on any per-knob edit, so the override map contains
an entry for the key as soon as the user touches any knob. If the
user resets every knob individually back to default (rather than
clicking "Reset"), `perNoteOverrides.has(selectedKey)` still returns
true and the "Reset" button stays enabled while functionally
nothing differs from default.

**Representative files:**

- `src/modules/GrandBoule/useCases/setGrandBoulePerNoteParam/setGrandBoulePerNoteParam.ts:41-46`
- `src/modules/GrandBoule/presentations/components/PerNoteEditor.tsx:51`

**Needed:** After applying the change, compare the resulting object
to `createDefaultPerNoteValues()`; if equal, `delete` the entry from
the map. Or, expose `hasNonDefaultPerNoteValues(values)` and use it
in the panel. Add a test covering the round-trip.

### 29. `StringVibrationView.StringState` carries a dead `phase` field

**Problem:** `StringVibrationView.tsx:17` declares `phase` on
`StringState` but the renderer never writes it; phase is implicitly
the global `frameRef.current * 0.08`.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/StringVibrationView.tsx:17,33-82`

**Needed:** Drop `phase` from the type. Or implement per-string
phase advance (`states[i].phase += s.frequency * dt`) and use it in
the wave equation — the visual would no longer drift in lock-step
across strings.

### 30. Visualisers run rAF when panel is hidden

**Problem:** `PianoModel3D`, `StringVibrationView`, `SpectralWaterfall`
all run `requestAnimationFrame` unconditionally. With the panel
collapsed (kept mounted), CPU keeps draining. There is no
`document.visibilityState` check or
`IntersectionObserver`-driven gate.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx:262-510`
- `src/modules/GrandBoule/presentations/components/StringVibrationView.tsx:99-137`
- `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx:79-196`

**Needed:** Wrap the rAF loop in an `IntersectionObserver` that
pauses when the canvas is offscreen; pause on
`document.hidden === true`.

### 31. `PianoKeyboard` velocity is hard-coded to 0.8

**Problem:** Both `PianoKeyboard.tsx:39` and
`PianoModel3D.tsx:536` always emit `onNoteOn(midi, 0.8)`. The Web
Pointer API exposes `pressure` (0..1) for force-touch / pen.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx:35-40`
- `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx:523-538`

**Needed:** Read `event.pressure` and fall back to a Y-axis ramp
(higher Y = louder, e.g. `0.4 + (relY/keyH) * 0.5`) or a fixed
`0.8` only when `pressure === 0`.

### 32. `PianoKeyboard` has no keyboard input and unhelpful aria-labels

**Problem:** No `onKeyDown` handler, no `tabindex` ordering, no
`role="grid"` to expose the 88-key layout to AT. Aria-labels are
bare MIDI numbers (`MIDI 60`) — a user reading "MIDI 60" cannot
infer "C4".

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx:60-95`

**Needed:** Wire `keyToNoteName(midi - 20)` (already exists in
`models/GrandBoulePerNoteParams.ts:84`) into the aria-label. Add a
keyboard-input layer (Z-row → C-major scale, etc.) gated on a
"Computer Keyboard" toggle.

### 33. `activeVoices` telemetry is never updated

**Problem:** `grandBouleStore.ts:47` exposes `activeVoices: number`,
the panel displays it (`GrandBoulePanel.tsx:432,570`), but no use
case writes it. The engine is never wired to push voice counts.

**Representative files:**

- `src/modules/GrandBoule/stores/grandBouleStore.ts:47`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:432,570`

**Needed:** Either (a) wire the WASM engine to push voice telemetry
through a `messageHandler` in `AudioEngine/repositories/webMidi/` (or
a dedicated `grandBouleControls.onTelemetry` callback), or (b) drop
the field and the UI element.

### 34. Cross-module surface mixes deprecated singleton with live API

**Problem:** `stores/index.ts:1-8` re-exports both the deprecated
`grandBouleStore` (the `'default'` device, source of issue #1) and
the live `createGrandBouleStore` factory. Cross-module callers
silently choose between them.

**Representative files:**

- `src/modules/GrandBoule/stores/index.ts:1-8`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:7`

**Needed:** Once issue #1 is resolved, drop `grandBouleStore` and
`defaultGrandBouleState` from the contract barrel. Update
`Project` and `AudioEngine` callers in the same commit. Cross-
reference dep-cruise to confirm no external imports remain.

### 35. `useCases/index.ts` exposes only 2 of 17 use cases

**Problem:** `useCases/index.ts:1-2` exports
`createGrandBouleTrack` and `applyVelocityCurve` — nothing else.
Cross-module callers needing
`triggerGrandBouleNote`/`releaseGrandBouleNote`/`panicGrandBoule`/
... cannot reach them through the contract surface; they must
either reach into private files (forbidden by AGENTS.md) or duplicate.

**Representative files:**

- `src/modules/GrandBoule/useCases/index.ts:1-2`

**Needed:** Decide which use cases are public (consumed by other
modules) vs private (only the panel calls). For each public one,
re-export from `useCases/index.ts`. For private ones, leave alone
(panel uses relative imports). Cross-reference with grep for
external consumers.

### 36. `inject({ eventBus })` wraps `eventBus.on(...)` for three
modules of one-line indirection

(Subset of issue #27, kept separate for surface visibility.)

**Problem:** Each `onMidi*.ts` adds `inject` overhead and a hosted
DI cell for what amounts to `eventBus.on('midi.<x>', handler)`.
The DI surface is justified for repository swapping, not for
re-binding `on`.

**Representative files:**

- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiNoteOn.ts:5-10`
- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiNoteOff.ts:5-10`
- `src/modules/GrandBoule/useCases/midiEventSubscribers/onMidiPedalCc.ts:5-10`

**Needed:** See #27.

### 37. `setGrandBouleVelocityCurve` writes only `parameters.velocityCurve`,
not `midiCalibration.velocityCurveExponent`

(Subset of issue #3, kept separate so it can be addressed without
unifying the two fields.)

**Representative files:**

- `src/modules/GrandBoule/useCases/setGrandBouleVelocityCurve.ts:28-37`

**Needed:** Once #3 is decided, this either (a) becomes a single-
field write to the unified setting, or (b) is deleted in favour of
`setVelocityCurveExponent`.

### 38. `engineReady: boolean` on the store is dead

**Problem:** `grandBouleStore.ts:45,63` declares and seeds the field;
no use case writes it; the panel reads `engine.isReady()` directly
(`GrandBoulePanel.tsx:191`). The field is referenced only in tests as
a fixture. It serves no purpose today.

**Representative files:**

- `src/modules/GrandBoule/stores/grandBouleStore.ts:45,63`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:191`

**Needed:** Either drop it from `GrandBouleState` (and from
`createDefaultGrandBouleState`, `loadGrandBoulePreset.spec.ts:68`,
`helpers.spec.ts:29`), OR wire AudioEngine to push readiness state
through it so the `engineReady` `useEffect` at line 193 subscribes
to a store value rather than calling `engine.isReady()` per render.

### 39. `PianoKeyboard.tsx` is dead code

**Problem:** Verified by `grep -rn 'PianoKeyboard' src` — the only
consumer is the component's own placeholder spec. The panel uses
`PianoModel3D` exclusively. The component still ships in the bundle
and inherits issues #31 and #32 in dead code. Confusing for the next
session reading the audit.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/PianoKeyboard.tsx`
- `src/modules/GrandBoule/presentations/components/__tests__/PianoKeyboard.spec.tsx`

**Needed:** Surface to the user — propose either deleting the file
(per safety rules, requires explicit instruction naming the file)
or replacing `PianoModel3D` with it for a low-resource fallback path.
Do not silently delete.

### 40. `resolveGrandBouleEngine` exports a use-case type

**Problem:** `useCases/resolveGrandBouleEngine.ts:20`:
`export type ResolvedGrandBouleEngine = GrandBouleEngineHandle`. The
panel imports it via `import { type ResolvedGrandBouleEngine }` at
`GrandBoulePanel.tsx:29`. AGENTS.md is explicit: "Do not `export type`
from `useCases/`". The alias is also semantically empty.

**Representative files:**

- `src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts:20`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:29,129`

**Needed:** Drop the `export type ResolvedGrandBouleEngine` alias.
At the panel callsite, either inline the type via
`ReturnType<typeof resolveGrandBouleEngine>` or import
`GrandBouleEngineHandle` directly from `repositories/`.

### 41. `createGrandBouleTrack` mutates a freshly-created track and
ignores `addDeviceToStrip` failure

**Problem:** `createGrandBouleTrack.ts:21-37`: writes
`track.devices = [...]` after `createTrack` returns the track, then
`appendTrack(track)`, then `addDeviceToStrip` (return value
discarded), then emits `track.added` regardless of strip success. If
`addDeviceToStrip` fails (no audio context, WASM not loaded), the
track exists in the store but the strip does not — the panel
renders forever against a disconnected handle (intersects #5).

**Representative files:**

- `src/modules/GrandBoule/useCases/createGrandBouleTrack.ts:21-37`
- `src/modules/Arrangement/useCases/createTrack.ts`
- `src/modules/AudioEngine/useCases/addDeviceToStrip` (cross-module)

**Needed:** Either (a) extend `createTrack` to take a `devices`
parameter so `createGrandBouleTrack` does not mutate the returned
object, or (b) return `Result<string, Error>` and on
`addDeviceToStrip` failure roll back via a `removeTrack` use case.
Surface a `notifyUser` toast on failure, do not emit `track.added`
on failure.

### 42. `triggerGrandBouleNote` velocity round-trip drifts and the
comment confesses the smell

**Problem:** `triggerGrandBouleNote.ts:30`:
`applyVelocityCurve(input.velocity * 127, calibration)` —
`input.velocity` is documented as 0..1 and `applyVelocityCurve`
divides its first arg by 127. Round-tripping a 0..1 value through
`* 127` then `/ 127` is a precision-losing no-op, AND the comment
at line 29 ("Map normalized velocity back to 0-127 ... then back
to 0-1") signals the author already knew it was odd. `feedback_code_should_self_explain`.

**Representative files:**

- `src/modules/GrandBoule/useCases/triggerGrandBouleNote.ts:29-30`
- `src/modules/GrandBoule/stores/applyVelocityCurve.ts:10-15`
- `src/modules/GrandBoule/useCases/calibrateGrandBouleMidi/applyVelocityCurve.ts:11-15`

**Needed:** Add a 0..1 overload to `applyVelocityCurve` (rename the
0..127 form to `applyVelocityCurveFromMidi`), and pass
`input.velocity` straight through. Drop the inflate/deflate.

### 43. `MidiCalibrationPanel` `ctx.scale(dpr, dpr)` cumulates if
`canvas.width` assignment is ever skipped

**Problem:** `MidiCalibrationPanel.tsx:75-129`: resize and DPR-
scale live in the same effect as the bar draw. `canvas.width = ...`
clears the transform; `ctx.scale(dpr, dpr)` is additive. Today the
sequence is correct because the assignment always runs, but the
flow is fragile — a future early-return that skips the assignment
will leave `ctx.scale` cumulating across notes.

**Representative files:**

- `src/modules/GrandBoule/presentations/components/MidiCalibrationPanel.tsx:75-129`

**Needed:** Split resize from draw. Resize via `ResizeObserver` on
the container (initial+on-resize only). Draw via `useEffect([samples])`,
beginning with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` (idempotent
absolute set instead of additive scale). Cross-references issues
#16 and #57.

### 44. `MidiPedalCcPayload` is a non-discriminated union, AudioEngine
and panel agree by convention

**Problem:** `WorkspaceEvents.ts:51`:
`MidiPedalCcPayload = { ... value: number | boolean }`. Cross-module
contract is "CC64 → number, CC66/67 → boolean", but the type does
not encode it. The panel casts via `value as number` /
`value as boolean` (issue #8); the AudioEngine emits the typed
values directly without TypeScript noticing if the agreement broke.

**Representative files:**

- `src/modules/Workspace/events/WorkspaceEvents.ts:51`
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts:570-589`
- `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:174,176,178`

**Needed:** Tighten to a discriminated union, e.g.
`{ deviceId?: string; cc: 64; value: number } |
 { deviceId?: string; cc: 66 | 67; value: boolean }`. Update both
emitters and the panel handler. Drop the casts. (This is the same
fix as the `Needed` for issue #8, surfaced separately so the spec
session sees the cross-module locus.)

### 45. `MidiNoteOffPayload` carries no release velocity

**Problem:** `WorkspaceEvents.ts:48`:
`MidiNoteOffPayload = { deviceId?: string; midiNote: number }`.
Web MIDI exposes release velocity on note-off; the engine's
`noteOff` input is `{ midiNote }` only. For a physical-modelling
piano this drops a real expressive dimension.

**Representative files:**

- `src/modules/Workspace/events/WorkspaceEvents.ts:48`
- `src/modules/GrandBoule/repositories/grandBouleEngineHandle.ts:20`
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` (note-off path)

**Needed:** Extend `MidiNoteOffPayload` with a `releaseVelocity?: number`
(optional for back-compat). Plumb through the AudioEngine note-off
path. Add `releaseVelocity?: number` to
`GrandBouleEngineHandle.noteOff`'s input. Forward in
`releaseGrandBouleNote`.

---

## Open questions

- [ ] Is the per-device store pattern (`createGrandBouleStore(deviceId)`)
      or the singleton (`grandBouleStore`) the intended model? The
      panel and AudioEngine vote per-device; project persistence
      votes singleton. Pick one.
- [ ] Should `MidiCalibration` be engine-side (`setParam` family) or
      JS-side (`applyVelocityCurve`)? The current implementation is
      JS-side only, but the UI offers parameters
      (`afterTouchSensitivity`, `ccSmoothingMs`) that conceptually
      belong to the engine.
- [ ] Is `compareToReference`-style "preset shelf I/O" planned?
      Currently the catalog is hard-coded; user presets do not
      survive a session.
- [ ] Are visualisers (`PianoModel3D`, `StringVibrationView`,
      `SpectralWaterfall`) supposed to gate on panel visibility?
      Without that, they are CPU sinks even when the panel is
      collapsed.
- [ ] Is `setGrandBouleTemperament`'s API divergence intentional
      (because temperament affects every note even when no engine
      handle is in scope), or accidental? Either way, document it.
- [ ] What is the intended behaviour when `engine.isReady()` is
      false but the user adjusts a param? Queue and replay,
      ignore-with-toast, or accept silently? The current "accept
      silently" produces issue #5.

---

## Risks

- **Data corruption across project loads.** Issue #1: GrandBoule
  state is _never_ serialised by `saveProject` or `loadProject`
  (verified by grep — both files contain zero GrandBoule references).
  The in-memory singleton's values carry forward across every project
  switch until the user clicks "New Project". Per-device stores
  survive too. The `Map<deviceId, Store>` in `grandBouleStore.ts:71`
  outlives every project lifecycle event.
- **Even if persistence is wired, `Map<number, GrandBoulePerNoteValues>`
  cannot round-trip through plain JSON.** New observation in #1: the
  store carries `perNoteOverrides: GrandBoulePerNoteMap` (a `Map`).
  `JSON.stringify(new Map())` returns `'{}'`. Adding the store to
  `saveProject.ts` without a custom replacer/reviver silently drops
  every per-note override.
- **Two-track velocity shaping.** Issues #2, #3, #20: presets and
  calibration knobs do not affect the same playback paths. A
  carefully calibrated controller still plays presets through a
  different curve than the on-screen keyboard does.
- **Disconnected-engine theatre.** Issue #5 + #20 + #58: the user
  clicks "preset", "morph", "temperament", "calibration",
  "per-note", "panic", "load attack clip"; the UI says success;
  the WASM is silent. 21 of 22 user-visible knobs/buttons silently
  no-op when `engine.isReady() === false`. No `notifyUser` is
  emitted anywhere in this module.
- **`createGrandBouleTrack` ignores `addDeviceToStrip` failure.**
  New issue #55 / open issue #41: a track exists in the store but
  the strip does not; the panel renders against a disconnected
  handle forever. Combined with #5, the user gets a fully
  decorative GrandBoule panel.
- **State stomp on engine restart (when morph is enabled).**
  Issue #6 (demoted): HMR / suspend / resume / project switch
  resets the user's morph position when they have the morph
  engine on. Default morph state is disabled, limiting blast
  radius.
- **Pedal CC half-coverage.** Issue #4: the in-panel CC handler
  updates the visual UI but skips the engine dispatch for half-
  pedal sustain. The cross-module event payload (`MidiPedalCcPayload`)
  is a non-discriminated `number | boolean` union (issue #59 / open
  issue #44), so even after fixing the panel handler, the type
  system will not catch a future emitter swap.
- **Test coverage is theatre.** Issue #10: a refactor of
  `triggerGrandBouleNote` that breaks the velocity-shaping math
  could ship without any spec failing. 29 placeholder specs (count
  corrected from 27); of 17 use-case files only ~3 have non-trivial
  tests.
- **Dead state and dead components.** Issues #50, #51, #52: the
  store carries an `engineReady` field that is never written and an
  `activeVoices` field that is never updated; `PianoKeyboard.tsx`
  is shipped but never rendered. The audit's own count of "27 uncov-
  ered specs" was off by 2 because nobody had run the grep.
- **Visualisers eat CPU on collapsed panels.** Issue #30: three
  rAF loops continue rendering when the user has the GrandBoule
  panel hidden. Combined with `SpectralWaterfall` redrawing the
  full ImageData every frame (#18) and `MidiCalibrationPanel`
  resizing the histogram canvas per-note-on (#16, #57), this is a
  144 Hz / 22 528-pixel-write CPU drain — every render also leaks
  a `ctx.scale` accumulation if the resize-clear assumption ever
  breaks.
- **Architectural drift.** Issues #2, #22, #27, #34, #35, #51, #52,
  #53: duplicated curve, empty events folder, no-op pass-through
  use cases, surface mixing live and deprecated APIs, useCases
  barrel exposing only 2 of 17, dead store fields, dead components,
  use-case `export type` violation. Left unaddressed they normalise
  the pattern across the module.

---

## Suggested approaches

- **Land the persistence fix first** (issue #1). Pick the per-device
  factory model or the singleton, then update
  `resetModuleStoresToDefault` and add project-save/load round-trip
  tests. Without this, every other fix in this audit is on top of
  silently corrupted state.
- **Collapse `applyVelocityCurve` and the two velocity-curve fields**
  (issues #2, #3). Move the function to `#/utils/`, settle on
  `midiCalibration.velocityCurveExponent` as the single source, and
  have `loadGrandBoulePreset` write to it. Drop
  `parameters.velocityCurve`.
- **Add `engine.isReady()` gates and consistent return types** (issue
  #5) to every `set*` and `load*` use case. Either return
  `Result<void, EngineNotReady>` or surface a `notifyUser` toast.
  Property-test that calling each setter with a disconnected handle
  is a no-op AND returns the expected failure.
- **Rewrite `GrandBoulePanel.tsx`'s pedal CC handler** (issue #4) to
  call the existing `setGrandBouleSustain`/`setGrandBouleSostenuto`/
  `setGrandBouleUnaCorda` use cases. Tighten `MidiPedalCcPayload` so
  the casts go away (issue #8).
- **Replace placeholder specs** (issue #10) module-wide. Mechanical
  but the unblock for everything else: with real tests, the audit's
  arithmetic and contract bugs can be driven test-first. Start with
  `triggerGrandBouleNote`, `loadGrandBoulePreset`,
  `setGrandBouleMorphPosition`, the calibration setters.
- **Plumb calibration to the engine** (issue #20) or document its
  JS-only scope.
- **Refactor `setGrandBouleTemperament`** (issue #7) to match its
  siblings.
- **AGENTS.md compliance pass** (issues #2, #8, #9, #22, #27, #34,
  #35, #51, #52, #53) as a follow-up sweep — small mechanical
  refactors that should land in a single commit each. Includes
  dropping the `export type ResolvedGrandBouleEngine`, removing the
  dead `engineReady` field, and surfacing the dead `PianoKeyboard.tsx`
  for explicit decision (delete vs. wire).
- **Tighten the `MidiPedalCcPayload` discriminated union** (issues
  #8, #59) at `Workspace/events/WorkspaceEvents.ts`. Drop the
  `as number` / `as boolean` casts in the panel _and_ in the
  AudioEngine's `messageHandlers.ts:570-589`. This is a
  cross-module change but mechanical.
- **Repair `createGrandBouleTrack`'s implicit-mutation pattern**
  (new #54/#55, open issue #41). Either extend `createTrack` to
  accept devices, or wrap `addDeviceToStrip` failure into a Result
  and roll back the track on failure. Do not emit `track.added`
  unless the strip exists.

---

## Recommendation

Start with **issue #1 (no GrandBoule state survives project save/
load)**. It is correctness-class data corruption — verified by grep
that `saveProject.ts` and `loadProject.ts` have no GrandBoule
references at all. Every other fix sits on top of it. Land it as a
standalone commit with project-save/load round-trip tests in
`Project/useCases/projectPersistence/__tests__/`. The fix needs to
account for `Map`-typed `perNoteOverrides` (custom replacer/reviver
or convert the field to a plain `Record`).

Then tackle **issue #5 (disconnected-engine theatre)**, because
without `engine.isReady()` gates the panel's success indicators are
lying to users — including in the test of issue #1. Promote the
fix to also cover #20 (calibration engine plumb) and #58
(setGrandBouleTemperament's unmemoised path) since they share the
same root: 21 of 22 controls bypass readiness checks today.

After those two land, the next session can pick between:

- **Correctness pass:** issues #2, #3, #4, #6 (with `morph.enabled`
  caveat), #7 (collapses #58), #20, #25, #41 (createGrandBouleTrack
  rollback), #42 (velocity round-trip), #44 (pedal CC discriminated
  union).
- **Test-coverage pass:** issues #9, #10 (29 placeholders), #11,
  #12.
- **Mechanical AGENTS.md sweep:** issues #38 (dead `engineReady`
  field), #39 (dead `PianoKeyboard.tsx`, surface to user), #40
  (drop `export type ResolvedGrandBouleEngine`), #43 (split
  resize/draw effects in `MidiCalibrationPanel`).

They are independent.

---

## Resolved

_No issues resolved yet._
