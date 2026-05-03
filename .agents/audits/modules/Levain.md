# Levain module audit

## Scope

This audit covers `src/modules/Levain/` in full — `events/`, `models/`, `presentations/components/`, `presentations/views/`, `repositories/sampleLoader/`, `repositories/levainPresets.ts`, `stores/`, and the `useCases/` (including `levainParamBridge/` and `autoLoadSamples`, `loadPreset`). It excludes the upstream worklet (`#/modules/AudioEngine`) and consumers under `Arrangement` except where they are imported from this module. Tests under `__tests__/` are reviewed for coverage quality, not in isolation.

It is an adversarial review: races, unhandled errors, hidden global state, type-soundness escapes, AGENTS.md violations, audio-thread / sample-loading hazards, and UX gaps.

**Adversarial-review history.** Issues #1-#45 came from a prior reviewer; the current adversarial pass verified each one, deepened where shallow, **demoted issue #2** (the headline claim that `inject(...)` was unfixable was wrong — the DI seam works once `Container.clear()` is called), **rewrote issue #8** (the previous reviewer had the direction backwards: state isn't replaced by defaults — state is *fabricated* from defaults because nothing initialises it), and **deepened issue #9** (the patch / engine drift includes a rust-key mismatch the previous reviewer missed). Issues #46-#66 are new findings.

Related spec: none on disk.

---

## Goal

A correctness-first sample playback / performance bridge for the DAW:

- Per-`deviceId` Levain instances are isolated. Two devices loaded with different instruments must not collide on shared module-level state, the sample decode pipeline, or the worklet zone map.
- Patch state (articulations, mics, expression, legato, humanize, macros) is the **single source of truth** in `levainStore`; all engine sync flows through one bridge with predictable, idempotent flushes.
- Sample loading is robust under concurrency: cancellable when the user switches instrument mid-load, resilient to partial failures, deterministic in zone IDs, and surface progress / errors to the user.
- Cross-module imports follow AGENTS.md: only `useCases/`, `events/`, `stores/`, `presentations/views/` cross the barrel; types from `useCases/` stay private; no `as unknown as`/`any` escape hatches; one function per `useCases/`/`repositories/` file; functions with multiple parameters take a single object param.
- React presentations are leak-free (canvases cleaned up), accessible (toggles labelled, knobs reachable), and never block the UI thread on heavy decode work.
- The audio thread (worklet) is fed via transferable buffers without re-allocating per zone, and the host side never holds onto decoded sample buffers longer than necessary.

---

## Relevant code paths

- `src/modules/Levain/index.ts` — _missing_ (see issue #1)
- `src/modules/Levain/events/index.ts` (intentionally empty)
- `src/modules/Levain/models/LevainPatch.ts`
- `src/modules/Levain/stores/levainStore.ts`
- `src/modules/Levain/stores/index.ts`
- `src/modules/Levain/useCases/index.ts`
- `src/modules/Levain/useCases/autoLoadSamples.ts`
- `src/modules/Levain/useCases/loadPreset.ts`
- `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts`
- `src/modules/Levain/useCases/levainParamBridge/levainBridgeDependencies.ts`
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts`
- `src/modules/Levain/useCases/levainParamBridge/registerLevainDevice.ts`
- `src/modules/Levain/useCases/levainParamBridge/unregisterLevainDevice.ts`
- `src/modules/Levain/useCases/levainParamBridge/loadSamplesForInstrument.ts`
- `src/modules/Levain/useCases/levainParamBridge/setLevainParamWithAudio.ts`
- `src/modules/Levain/useCases/levainParamBridge/setMacroWithAudio.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendHumanizeToEngine.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendLegatoEnabledToEngine.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendMicParamToEngine.ts`
- `src/modules/Levain/repositories/levainPresets.ts`
- `src/modules/Levain/repositories/sampleLoader/helpers.ts`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts`
- `src/modules/Levain/repositories/sampleLoader/loadSingleSample.ts`
- `src/modules/Levain/presentations/views/LevainPanel.tsx`
- `src/modules/Levain/presentations/components/{ArticulationList,ExpressionPanel,HumanizePanel,LegatoTuning,LevainMacroStrip,MicBlendSlider}.tsx`

---

## Current behavior

**Module surface.** There is **no `src/modules/Levain/index.ts` root barrel**. AGENTS.md mandates a curated cross-module surface; consumers therefore deep-import `LevainPanel`, `levainStore`, `registerLevainDevice`, etc. (e.g. the panel is reached as `#/modules/Levain/presentations/views/LevainPanel` in any consumer that wants it). `events/index.ts` exists but has only `// no public events`.

**Models / store.** `LevainPatch` is a fat `type` per-instrument with `articulations`, `micPositions`, `expression`, `legato`, `humanize`, `releaseTriggers`, `masterGain`, `macros`, `macroLabels`. `levainStore` is keyed by `deviceId` with one `LevainState` per instance. State mutations are pure (`setLevainParam`, `setSampleLoadProgress`, `setCurrentArticulation`, `setMacro`, `updateMicPosition`, `setEngineReady`); the store is also imported directly by the panel for `setCurrentArticulation` / `updateMicPosition`. There is **no use-case wrapper for state mutations** — the panel reaches into `../../stores/levainStore` for half its writes and into `useCases/levainParamBridge/...` for the other half.

**Bridge singleton.** `levainBridge.ts` wraps `createLevainBridge(deps)` in `inject(...)` and exposes a getter. The bridge holds two `Map<deviceId, …>` (active devices + ports) and a single shared `createRafBatcher<number>()` keyed on `${deviceId}:${rustKey}`. Each individual `useCases/levainParamBridge/*.ts` is a one-liner forwarder.

**Sample loading.** `autoLoadLevainSamples` resolves a manifest URL (Tauri or web), kicks `loadInstrumentFromManifest`, updates store progress, and uses `setTimeout(…, 300)` to clear progress at the end. `loadInstrumentFromManifest` fans out `Promise.allSettled` over unique sample files, sends `addSample` / `addZone` / `buildZoneMap` postMessages with transferable buffers. A module-level `decodeQueue = Promise.resolve()` is mutated to serialise `decodeAudioData` calls; a module-level `decodeCtx: OfflineAudioContext | null` is reused across decodes.

**Presentations.** `LevainPanel` is the only view; it reads the store, shows instrument list / search / family chips, and forwards to the bridge use cases. Five components (`ArticulationList`, `ExpressionPanel`, `HumanizePanel`, `LegatoTuning`, `LevainMacroStrip`, `MicBlendSlider`) split the body. `ExpressionPanel` and `LegatoTuning` each contain a `<canvas>` driven by `useEffect` redraws.

**Tests.** Most `__tests__/` files are present. `levainBridge.spec.ts` is a 5-line "load the module" smoke test (no behaviour exercised). `loadPreset.spec.ts` mocks the bridge surface and asserts shape.

---

## Findings

1. **No root `index.ts` barrel for the module.** Every cross-module consumer deep-imports `#/modules/Levain/presentations/views/LevainPanel`, `#/modules/Levain/stores/...`, or `#/modules/Levain/useCases/...`. AGENTS.md "Contract Boundaries: Cross-module imports MUST only target the destination module's root `index.ts`". The module can be neither imported nor enforced as a contract today.

2. **The `inject(...)` indirection on `levainBridge` makes the singleton lifetime ambiguous.** `levainBridge.ts:11` calls `inject(levainBridgeDependencies)((deps) => { const bridge = createLevainBridge(deps); return function getLevainBridgeSingleton(): LevainBridgeApi { return bridge; }; })`. The bridge is created **once** at module evaluation (closure-captured by the getter), so dependencies cannot be re-injected in tests beyond the very first call. The JSDoc claims `injectDependencies(levainBridge, …)` will resolve `getAllTracks` / `persistDeviceParam` / `autoLoadLevainSamples` for tests, but the inner `createLevainBridge(deps)` runs eagerly at module top-level — a later `injectDependencies` only changes what the outer factory sees on its _next_ call, and there is no next call (the closure has already captured `bridge`). Effectively a non-overridable singleton with the appearance of DI.

3. **`createLevainBridge` mixes use-case orchestration, in-memory state, and engine I/O — a god-object inside `useCases/`.** `helpers.ts:25` builds a closure that owns `activeDevices` and `activePorts` Maps (both in-memory state — should be in `stores/` or `engine/`), schedules rAF flushes (UI-coupled), and posts to a worklet `MessagePort` (I/O — belongs in `repositories/`). It also re-derives `rustKey` strings from camelCase TS names with `camelToSnake`, hard-coding the engine's parameter naming convention into the use-case layer.

4. **Eight `useCases/levainParamBridge/*.ts` are zero-value pass-throughs.** Each (e.g. `setLevainParamWithAudio.ts`, `sendMicParamToEngine.ts`, `loadSamplesForInstrument.ts`, `unregisterLevainDevice.ts`) is a single line `levainBridge().<method>(...args)`. They satisfy "one function per file" cosmetically but introduce eight files of indirection over a single `LevainBridgeApi` object. None of them validate, normalise, or mutate stores beyond what `helpers.ts` already does. (Cf. AudioAnalysis audit issue #14 — same anti-pattern here.)

5. **Decode pipeline has a module-level shared `OfflineAudioContext` that is never `close()`d, plus a module-level `decodeQueue` that grows the resolution chain forever.** `repositories/sampleLoader/helpers.ts:33-43` keeps `decodeCtx` and `decodeQueue` at module scope. The queue keeps chaining `decodeQueue = decodeQueue.then(...)` — once exhausted the chain is empty in terms of pending work, but the references to old promise resolution callbacks are kept. More importantly, two parallel calls to `fetchAndDecode` from different `loadInstrumentFromManifest` invocations (e.g. user switches instrument while previous load is in flight) **share the same queue and context** — the second instrument's decodes wait behind the first's, even after the user has cancelled them in their head. There is no abort/cancellation path. (See also issue #6.)

6. **No cancellation when the user switches instruments mid-load.** `LevainPanel.tsx:153` calls `loadInstrument(deviceId, instrument.id)` on click. `loadInstrument` calls `loadSamplesForInstrument`, which calls `autoLoadLevainSamples` with no `AbortSignal`. If the user clicks five instruments in two seconds, all five decodes run serially through the shared `decodeQueue`; each completes, posts `addSample` / `addZone` / `buildZoneMap` messages to the worklet port; whichever finishes _last_ wins the worklet's zone map. The intermediate ones still consumed CPU and burnt through hundreds of MB of `OfflineAudioContext` decode allocations. There is no `clearZones` deduplication — each new run posts `clearZones` then refills, so the worklet sees an erratic stream of partial zone maps. The store's `sampleLoadProgress` likewise interleaves between concurrent loads, since both calls update the same `deviceId`.

7. **`loadInstrumentFromManifest` zone IDs are unstable across LOD-skipped zones, breaking the `buildZoneMap` contract on retries.** `loadInstrumentFromManifest.ts:173-205` increments `zoneId` linearly while iterating `allZones`, but **skips** zones whose sample failed to load (`if (sampleId === undefined || !loadedFiles.has(zone.file)) { continue; }`). The worklet then receives zone IDs that aren't a contiguous `[0..N)` — but a subsequent `addZone` post-message uses the next free `zoneId++`. Restarting a load (issue #6) sends `clearZones` and starts again from `zoneId = 0`, so any zone reference held by the engine across the reload (e.g. an in-flight voice on a long sustain note) is now pointing at a different sample. The contract between manifest loader and worklet is not formalised; if the worklet expects deterministic zone IDs from the manifest order it will silently accept the wrong ones.

8. **Race between `registerLevainDevice` and `autoLoadLevainSamples`'s `setSampleLoadProgress(deviceId, 0.01)`.** `helpers.ts:67-86` `registerLevainDevice` synchronously calls `loadSamplesForInstrument(deviceId, …)`, which calls `autoLoadLevainSamples`. `autoLoadLevainSamples.ts:45` immediately writes `setSampleLoadProgress(deviceId, 0.01)` — but the device has just been registered and the store entry for `deviceId` may not exist yet in `levainStore`. `setSampleLoadProgress` falls back to `defaultLevainState` and writes a new entry, so any existing `LevainState` in the store for that `deviceId` (carrying user-edited macros, mics, etc.) is **replaced by `defaultLevainState`** with progress 0.01. Per AGENTS.md "Behavioral Invariants — assume everything that can fail will fail": the order is fragile.

9. **`registerLevainDevice` uses `??` chaining that quietly does nothing for the **shared** rust-key initial state.** `helpers.ts:71-83` reads `state?.patch` and queues `master_gain`, `legato_enabled`, `humanize_amount`, `vibrato_depth`, plus per-mic params. **`expression.dynamicCrossfadeTime`, `expression.cc1Curve`, `expression.vibratoRateMin/Max`, `expression.vibratoOnsetDelay`, `legato.adaptiveSpeed`, `legato.slowThresholdMs`, `legato.fastThresholdMs`, `legato.portamentoVelocityThreshold`, `humanize.timingMaxMs`, `humanize.tuningMaxCents`, `humanize.dynamicMax`, `humanize.vibratoVarMax`, `humanize.seed`, `releaseTriggers.*`, `currentArticulation`, every macro, every macro label** are not pushed to the engine on registration. The worklet boots with whatever defaults its Rust side has — which may differ from the patch the user is staring at. As soon as the user moves anything else, `setLevainParamWithAudio` uses `camelToSnake` to push the missing params, so the bug only bites on first load and on re-registration.

10. **`setLevainParamWithAudio` walks _one_ level deep into nested objects and silently drops everything else.** `helpers.ts:123-133` iterates `Object.entries(value)` only when the top-level value is `object && !== null`. For `legato.portamentoVelocityThreshold` the camelCase path is `legato_portamento_velocity_threshold`; for `expression.cc1Curve` (a string) the inner `typeof childVal === 'number'` branch is false and the curve type **never propagates to the engine**. Only `number` and `boolean` children are pushed. Strings (`cc1Curve: 'linear' | 's-curve' | 'logarithmic'`) and arrays (`articulations: ArticulationEntry[]`) are dropped. AGENTS.md "TypeScript — soundness: types must describe real data" — the `Record<string, unknown>` / lookup pattern here doesn't surface that the bridge is structurally incomplete.

11. **`camelToSnake` is naive and breaks on `cc1Curve` / consecutive capitals.** `helpers.ts:21-23` uses `replaceAll(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)`. `cc1Curve` → `cc1_curve` (correct). But `loVel`/`hiVel`/`micId` → `lo_vel`/`hi_vel`/`mic_id` (also fine). However, runs of capitals in keys like `vibratoDepthMax` → `vibrato_depth_max`, and `dynamicCrossfadeTime` → `dynamic_crossfade_time` — these align with what Rust expects only by convention. Any field added with `IDFooBar` (acronym) will explode into `_i_d_foo_bar`. Tests don't cover the conversion.

12. **`unregisterLevainDevice` deletes the device's store entry without checking ownership and leaks pending rAF batches.** `helpers.ts:88-101`: even though the comment "We can't cancelAll easily per-device without changing the batcher" is candid, the **pending** `paramBatcher` schedules for that `deviceId` will still fire on the next animation frame, calling `flushParam("…:…", value)`, which logs `parts[0] = deviceId`, looks it up in `activeDevices` (now deleted → `undefined`), then calls `deps.persistDeviceParam(deviceId, rustKey, value)` for a device that no longer exists. Persisting params for a stale device is worse than dropping — it can resurrect deleted state if the persistence layer round-trips through a project file.

13. **`updateMicPosition` and `setLevainParamWithAudio` both write the patch but don't share a single mutator — divergence is possible.** `LevainPanel.tsx:285` reaches into `updateMicPosition(deviceId, name, partial)` directly from the store, which writes to `patch.micPositions` _without_ posting to the worklet. The worklet sync goes via `onSendMicParam` → `sendMicParamToEngine`. If a mic param change ever bypasses one of the two paths the store and engine drift. The two-step write (`onUpdateMicPosition` then `onSendMicParam`) at `MicBlendSlider.tsx:48-49,57-59,68-71` is repeated three times with no shared abstraction.

14. **`MicBlendSlider` recomputes the full mic mix from scratch on every blend change with hard-coded indices and arithmetic that rounds twice.** `MicBlendSlider.tsx:91-93,101-110`: `roomVol = micPositions.length > 2 ? micPositions[2]?.volume ?? 0.3 : 0.3` and `blend = roomVol / (closeVol + roomVol + 0.001)`. When `closeVol === 0` the blend is `roomVol / (roomVol + 0.001) ≈ 1`, so the knob jumps to "full Room" even though both mics are silent. The compact `onChange` then pushes `newCloseVol = 1.0 - v * 0.5` (fights the user — they wanted blend, they got level reduction), and toggles mic 2's enable purely on `newRoomVol > 0.05`, again causing knob/state cycles.

15. **Canvas `useEffect` cleanup is missing.** `ExpressionPanel.tsx:28-102` and `LegatoTuning.tsx:24-97` both have `useEffect` that paints to `canvasRef.current.getContext('2d')`. There is no cleanup function, so when the component unmounts mid-paint (component re-rendered then immediately removed) the next painter's stroke can land on a stale canvas the React tree no longer references. Not catastrophic, but combined with `<canvas width={320} height={100}>` (fixed pixel size, not DPR-aware) the diagrams are blurry on Retina displays.

16. **`LevainPanel.tsx` redeclares `defaultLevainState` instead of importing from the store.** `LevainPanel.tsx:69-78` redefines a local `defaultLevainState`. `stores/levainStore.ts:34` already exports it. If the store ever changes shape (e.g. add a field), the panel keeps an outdated default and `useStore(levainStore, {}) ?? defaultLevainState` returns a structurally-incorrect fallback. Already drift-prone.

17. **`setMacroWithAudio` switch over `macroLabels` couples engine-key strings to user-facing labels.** `helpers.ts:149-179`: the switch tests `state.patch.macroLabels[index]` against `'Dynamics'`, `'Expression'`, `'Vibrato'`, `'Tightness'`, `'Space'`, `'Tone'`, `'Attack'`, `'Release'` (literal strings), and dispatches to specific CCs / param names. Renaming any macro label (which is user-editable in principle — the `macroLabels` are `string[]`) silently breaks the macro→engine wiring; the macro UI continues to show the new label but no engine call goes out. Couples i18n / branding to the engine routing layer.

18. **`setMacroWithAudio` for `'Space'` writes raw mic-0 / mic-1 volumes, bypassing the per-mic enabled/pan state.** `helpers.ts:163-166` `device.setParam('mic_0_volume', 1.0 - value * 0.5); device.setParam('mic_1_volume', value);` — but `mic_0_volume` is the engine's "close" mic and `mic_1_volume` is the **decca tree**, not "room". The store's `DEFAULT_MIC_POSITIONS` has `room` at index 2. The compact `MicBlendSlider` (`MicBlendSlider.tsx:91-93`) hard-codes index 2 as room. The two macro-vs-slider paths target different mics for "Space".

19. **`autoLoadLevainSamples` always sets progress to `1.0` and clears with `setTimeout(300)` — even on failure.** `autoLoadSamples.ts:54-56`: the `finally` block sets `1.0` then `null` after 300 ms. On a thrown error from `loadInstrumentFromManifest` the user sees a "load complete" indicator for 300 ms, then it disappears with no error toast. There is no `notifyUser(...)` or store-level error field to surface "samples failed to load" to the UI; `logger.warn` only writes to dev console.

20. **`autoLoadLevainSamples` Tauri dynamic-import has a comment-justified `as unknown as` cast.** `autoLoadSamples.ts:34-36`: the `tauriCore as unknown as { convertFileSrc: ... }` cast is justified by an `eslint-disable-next-line sourdaw/no-type-assertion-escape -- dynamic import type doesn't expose convertFileSrc; runtime value is structurally correct` — but `@tauri-apps/api/core` does export `convertFileSrc` as a typed function. The cast is masking a `tsconfig` / module-resolution issue (or a dynamic-import inference quirk), not a real type gap. AGENTS.md "TypeScript — soundness" classifies these escapes as forbidden absent a justification with a path to remove.

21. **`isTauri` detection at module level via `typeof window` in `autoLoadSamples.ts`.** `autoLoadSamples.ts:9`: `const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;` runs at module-evaluation time. If the module is imported in a test or SSR context, this returns `false` even when the runtime later exposes Tauri. Should be a function call (or use the existing `isTauri()` helper that other modules use — see AudioAnalysis `audioAiEngine`).

22. **`loadPreset` factory presets are described in `repositories/levainPresets.ts` but the use case `loadPreset` in `useCases/loadPreset.ts` does not call into the repository.** `useCases/loadPreset.ts:15` exports `loadInstrument` (not `loadPreset`), which calls `createDefaultPatch(instrumentId)` — bypassing the actual preset overrides defined in `repositories/levainPresets.ts:131-156`. The repository's `loadPreset(presetId)` is **never imported anywhere**. The factory presets are dead code from the user's perspective: there is no UI that invokes them, no use case that calls them, and no `useCases/index.ts` export. AGENTS.md "One Function Per File" + "Repositories Touch Metal" — a repo file with no I/O and no caller is just dead constants.

23. **`useCases/index.ts` exports only three functions; the rest are unreachable from outside the module.** `useCases/index.ts:1-3` re-exports `autoLoadLevainSamples`, `registerLevainDevice`, `unregisterLevainDevice`. `setLevainParamWithAudio`, `setMacroWithAudio`, `loadInstrument` (from `loadPreset.ts`), `sendHumanizeToEngine`, `sendLegatoEnabledToEngine`, `sendMicParamToEngine`, `loadSamplesForInstrument` are **only reachable via deep internal imports** like `LevainPanel` does. Any cross-module consumer that needs to script Levain (e.g. the AI runtime, automation, command bus) cannot reach them through the public surface. Either they should be exported (and the module barrel created — issue #1) or they should be re-architected so that scripted access goes via `Command` / `AppAction` handlers — neither path is taken today.

24. **No `handlers/` directory — Levain has no `AppAction` integration.** AGENTS.md mandates `handlers/` for command-bus integration; Levain has none. The macro / articulation / mic / preset changes are all "panel-only" — they cannot be triggered by the AI runtime, by automation, or by undo/redo through `executeAppAction`. For a sample-playback engine that the user will want to scrub, automate, and undo, this is a structural gap.

25. **No undo/redo / persistence story.** `levainStore` is plain in-memory state. There is no event source (`events/index.ts` is intentionally empty), no transient command shape, no `persistDeviceParam` integration beyond the bridge's per-param flush (which is per-rust-key, not per-patch). When the user moves five knobs, persistence sees five independent param writes that may or may not round-trip back into a coherent `LevainPatch`.

26. **`levainBridge.spec.ts` is a 5-line placeholder.** `useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9` simply asserts `subject` is defined. The bridge is the riskiest file in the module and has zero behavioural coverage. AGENTS.md "Tests: Do not stop at 'defined' / 'truthy' / generic `toBeTypeOf('object')` — assert the actual contract".

27. **Test `levainBridgeDependencies` is not used by any test to swap deps.** `levainBridge.ts`'s JSDoc claims `injectDependencies(levainBridge, …)` is the test seam. No test in `__tests__/` actually exercises that — see issue #2 for why it wouldn't work even if attempted.

28. **`LevainPanel` reads from `levainStore` directly _and_ writes to it directly, conflating presentation and state mutation.** `LevainPanel.tsx:15` imports `levainStore, setCurrentArticulation, updateMicPosition` from `../../stores/levainStore`. Per AGENTS.md the store interaction surface for a view should go through use cases (or `executeAppAction`), so undo/redo and command-bus replay are possible. The view writes the store directly via `setCurrentArticulation(deviceId, type)` and `updateMicPosition(deviceId, name, partial)` (the latter inside `MicBlendSlider`'s callback prop wired to the panel). This is consistent with the lack of `handlers/` (issue #24) — both reflect a missing command surface.

29. **`MicBlendSlider` uses `key={i}` (array index) for `<div>` mic strips.** `MicBlendSlider.tsx:41`: `key={i}`. If `micPositions` is reordered or a mic is removed (today they're append-only, but they're a `Partial<MicPositionState>[]` open to mutation) React will reuse the wrong DOM nodes. Use `mic.type` (which is unique per `MicPositionType`) instead.

30. **`Fader` value scaling formula in `MicBlendSlider` is asymmetric and lossy.** `MicBlendSlider.tsx:55,57`: forward path `mic.volume * 76 - 70`, inverse `(db + 70) / 76`. Both include `Math.max(0, Math.min(1, …))` only on the inverse; the forward uses the raw `mic.volume`. If `mic.volume > 1` (the patch domain says `0-1` but nothing validates), the displayed dB is `> 6 dB` and the slider clamps but a subsequent `onChange(db)` overwrites the patch with a clamped value — user-visible setting drift.

31. **`HumanizePanel` writes `dynamicMax` and `vibratoVarMax` in 0–1 range but the UI knob displays 0–15 / 0–30.** `HumanizePanel.tsx:79-93,96-110`: `value={config.dynamicMax * 100}`, `min=0, max=15`. So the knob's domain is `0..15` but it represents `0..0.15` in the patch. The handler does `onChange({ dynamicMax: v / 100 })`. If a future change pushes the max to `20` or someone wires `humanize.dynamicMax` through automation in raw 0–1 units, the UI / patch / engine paths are out of sync. Also the displayed `±{(config.dynamicMax * 100).toFixed(0)}%` truncates to integers — the knob has 0.5 step but the readout does not.

32. **`ExpressionPanel` `vibratoRateMin` is never user-editable.** The patch model defines both `vibratoRateMin` and `vibratoRateMax`, but the UI exposes only `vibratoRateMax` as "Rate" (`ExpressionPanel.tsx:198-211`). The min field is set once in `DEFAULT_EXPRESSION_CONFIG` and never moved by the panel. Either the field is dead in the patch or the UI is incomplete.

33. **`LevainPanel` filter chips and search box are local state, not persisted, and not accessibility-labelled.** `LevainPanel.tsx:83-84,124-138`: `useState('')` and `useState('All')`. The chips and search input are siblings; only the search input has an `aria-label`. The chip group has no `role="radiogroup"` / `aria-pressed`, so screen-readers cannot tell that the chips are exclusive. The instrument list (`<button>` per item, `LevainPanel.tsx:142-167`) has no `aria-current`/`aria-pressed` for the active instrument; the active state is shown only by class-name colour.

34. **`LevainPanel`'s "Family" filter hides instruments with `hasSamples: false` regardless of the user's query.** `LevainPanel.tsx:91-96` `&& instrument.hasSamples` filters out the harp unconditionally. The `INSTRUMENTS` list above has only `harp` as `hasSamples: false`; that is dead UI noise, but if a future instrument is added in `hasSamples: false` state for a real reason, it will be invisible to users with no toggle to surface the unsupported list.

35. **`LevainMacroStrip` uses `key={label}` over `labels`.** `LevainMacroStrip.tsx:20`: `key={label}`. `macroLabels` are user-readable and not guaranteed unique (two macros can share a label, especially after rename). React will collapse them to one DOM node and the second knob will never re-render. Use `i` together with the label, or use a stable per-slot identifier.

36. **`MicBlendSlider` `closeVol + roomVol + 0.001` magic offset.** `MicBlendSlider.tsx:93`: a fudge to avoid `/0`. Use a guard (`if (closeVol + roomVol === 0) return 0`) instead of biasing the result.

37. **AGENTS.md function-signature rule violated.** `helpers.ts:25` `createLevainBridge(deps)` is fine (one param), but `helpers.ts:67` `registerLevainDevice(deviceId, device, port?)`, `helpers.ts:102` `setLevainParamWithAudio(deviceId, key, value)`, `helpers.ts:136` `setMacroWithAudio(deviceId, index, value)`, `helpers.ts:182` `sendHumanizeToEngine(deviceId, amount)`, `helpers.ts:189` `sendLegatoEnabledToEngine(deviceId, enabled)`, `helpers.ts:196` `sendMicParamToEngine(deviceId, micIndex, param, value)`, `levainStore.ts:60` `setLevainParam(deviceId, key, value)`, `levainStore.ts:78` `setCurrentArticulation(deviceId, articulation)`, `levainStore.ts:92` `setMacro(deviceId, index, value)`, `levainStore.ts:112` `updateMicPosition(deviceId, index, updates)`, `loadPreset.ts:15` `loadInstrument(deviceId, instrumentId)`, `autoLoadSamples.ts:21` `autoLoadLevainSamples(deviceId, nodePort, instrumentId)` — all positional. Plus `loadInstrumentFromManifest.ts:70` (5 params), `loadSingleSample.ts:7` (3 params).

38. **No JSDoc on the store-mutator side-effects.** Functions like `setLevainParam`, `setMacro`, and `updateMicPosition` write `patch` but don't call the engine. Their adjacent counterparts in `levainParamBridge` (`setLevainParamWithAudio`, `setMacroWithAudio`) do both. The naming distinction is subtle and the panel imports both — easy to call the no-engine version and silently break audio.

39. **`InstrumentId` is a wide string-literal union (43 entries) duplicated across the model and the panel's `INSTRUMENTS` array.** `LevainPanel.tsx:27-46` declares 18 entries (with `hasSamples`/`family`); the model has 43. There is no compile-time check that `INSTRUMENTS` is exhaustive. Adding `'harp-2'` to the model will not produce a panel error. Conversely, removing `'horn'` from the model leaves the panel referencing a non-existent id. Type-soundness improvement: `INSTRUMENTS satisfies readonly { id: InstrumentId; … }[]` (already implicit via the explicit array typing).

40. **`Math.min(1, …)` clamps masquerading as validation.** `helpers.ts` and `MicBlendSlider.tsx` both clamp values quietly (`Math.max(0, Math.min(1, …))`). When validation fails this hides bad state — see issue #30. Patch domain ranges should be enforced at the patch boundary (`createDefaultPatch`, `setLevainParam`) and surface errors to the caller, not silently clamped.

41. **`articulations` patch slot uses linear search by `type`.** `levainStore.ts:81` and `helpers.ts:112-113` both `find` / `findIndex` an articulation by `type`. With ~12 articulations per family this is fine, but the index→articulation mapping is also encoded implicitly in `articulations` order — if `setCurrentArticulation` chooses a `type` that has been removed from `articulations` the engine receives no `current_articulation` index update because `artIndex === -1` and the `if` guard short-circuits silently. The store still updates `currentArticulationDisplay` to the literal `articulation` string. State and engine drift.

42. **No test for `loadInstrumentFromManifest`'s LOD filtering, sample-id stability, or partial-failure handling.** The manifest loader is the most subtle file in the module (Promise.allSettled, transferable buffers, zone-id assignment) and has no spec at all.

43. **`loadSingleSample` shadows the manifest loader's sampleId space.** `repositories/sampleLoader/loadSingleSample.ts:7` accepts `sampleId: number` from the caller and posts `addSample` with that id. There is no coordination with `loadInstrumentFromManifest`'s `sampleId` counter (issue #7), so a single-sample preview can collide with a manifest-loaded sample id. The worklet has no way to know which loader created each id.

44. **`__tests__/levainBridge.spec.ts` uses `import * as subject` — namespace import.** `useCases/levainParamBridge/__tests__/levainBridge.spec.ts:3`: `import * as subject from '../levainBridge';`. AGENTS.md "Imports: Never use namespace imports".

45. **`stores/index.ts` exports `defaultLevainState`, `levainStore`, `setEngineReady` but not the other store mutators.** `stores/index.ts:1`: only three names. `setLevainParam`, `setSampleLoadProgress`, `setCurrentArticulation`, `setMacro`, `updateMicPosition`, `getLevainState` are private to the module by virtue of not being re-exported — but `LevainPanel.tsx:15` and `loadPreset.ts:7-8` reach into `../../stores/levainStore` directly to get them. Per AGENTS.md "Same module — relative imports" this is fine intra-module, but it means there's no curated "public store surface" — every internal file picks what it needs by deep import, and the barrel is misleading about what's "public".

**New findings from the adversarial review:**

46. **`activeVoices` / `peakL` / `peakR` in `LevainState` are dead state.** `stores/levainStore.ts:28-30,39-41` declares them; nothing in the codebase ever writes them; `LevainPanel.tsx:202-205,351` displays them. The user always sees "0 voices" — a permanent zero indistinguishable from a real metric.
47. **`loadInstrumentFromManifest` holds every decoded buffer in memory simultaneously before posting.** `Promise.allSettled` over all unique sample files completes before any `addSample` is posted (`loadInstrumentFromManifest.ts:130-168`). Peak heap is the sum of all decodes — easily hundreds of MB for an instrument with WEB_LOD enabled. Streaming `addSample` per fetch would bound peak memory.
48. **`registerLevainDevice(deviceId, device)` (no port) silently no-ops the entire patch sync.** `helpers.ts:67-86` — the device is added to `activeDevices` but no patch sync, no load. Optional port advertised in the type signature is a footgun.
49. **`Tightness` macro pushes `humanize`, `humanize` knob pushes `humanize_amount` — different rust keys for the same field.** `helpers.ts:161` vs `:117-133`. Same shape as #9. `Tone`/`Attack`/`Release` macros write engine-only state with no patch field — store and engine drift forever.
50. **`LevainPanel`'s search and family filter are `useState`, lost across mount/unmount.** `LevainPanel.tsx:83-84`. Multi-instance Levain panels desync; HMR / track-list rerender resets filters.
51. **Compact `MicBlendSlider` mutates mic 0 and mic 2 even when `micPositions.length === 2`.** `MicBlendSlider.tsx:91-110`. The `?? 0.3` fallback at line 92 displays a fake blend; the user sees a control that doesn't do what it says.
52. **`useCases/loadPreset.ts` exports `loadInstrument`, not `loadPreset`.** Filename / export name mismatch. AGENTS.md "filename matches the exported function name".
53. **`applyPatch` private helper in `loadPreset.ts:25-50` is the only writer for a full patch — no public API.** Project rehydration cannot apply a stored patch; AI scripting cannot load a patch.
54. **`getDevice(deviceId)` silently returns `undefined`; every call site has `if (!device) return` with no logging.** `helpers.ts:50-52,139-141,183-186,189-193,196-200`. Engine-call drops are invisible.
55. **`wasmDeviceRegistry.ts:229-231` swallows `_unregisterLevainDevice` errors with empty catch.** AGENTS.md prohibits silent catches; CLAUDE.md memory bullet on "No fallback hacks" forbids exactly this pattern.
56. **`LevainDevice.setInstrument` is `?:` optional and is the ONLY mechanism that propagates `instrumentId` changes to the engine realism layer.** `helpers.ts:9-13,54-57`. A side channel that bypasses the param bridge.
57. **`WEB_LOD` is the only LOD setting; no per-device, per-instrument, or runtime-quality knob.** `helpers.ts:16-21`. `DEFAULT_LOD` (the no-cap profile) is dead code.
58. **`unregisterLevainDevice` doesn't abort in-flight `autoLoadLevainSamples`.** Any pending `setSampleLoadProgress` callback fabricates a phantom store entry via `defaultLevainState` (issue #59).
59. **Every `levainStore` mutator falls back to `defaultLevainState` on missing entry — silent state fabrication.** `levainStore.ts:62, :74, :80, :94, :114, :134`. No "unknown device" failure mode at the store level.
60. **`repositories/sampleLoader/` has no `__tests__/` directory at all.** Three uncovered files; #42 understated.
61. **`events/index.ts` is empty; Levain emits no domain events.** No `levain.patchLoaded`, `levain.sampleLoadFailed`. Other modules cannot react to Levain state changes.
62. **`LevainState.uiLevel` is in the type but never read or written.** `levainStore.ts:21,25,36`. Dead state, like #46.
63. **`ArticulationEntry.enabled` filtered at the UI but never set to `false` anywhere.** `ArticulationList.tsx:27`. Either dead, or a recovery affordance is missing for the all-disabled case.
64. **`instrumentFamily` in the patch is derived state — `getInstrumentFamily(instrumentId)` already exists.** `LevainPatch.ts:188`. Storing it duplicates and risks drift.
65. **`defaultLevainState.patch.instrumentId` is `'violin-1'` — `getLevainState('unknown')` returns a violin patch.** `levainStore.ts:35,52`. No way to distinguish "device missing" from "device has a violin patch".
66. **`LevainPanel.tsx:164` `instrument.id.replaceAll('-', ' ')` is a presentation transform on a stable id.** Display strings should not be derived from ids. The `INSTRUMENTS.label` field is the proper source.

---

## Priorities

1. **Initial sample load is broken on a fresh device** (issues #8, #59, #65). `registerLevainDevice` reads `state?.patch` from `levainStore` but **nothing initialises that entry first** — so the patch-driven auto-load is dead code on a fresh project. Users see the WASM fallback (sine tone) until they manually click an instrument. Top priority because it's a correctness bug masquerading as a missing feature.
2. **Parameter sync gaps and rust-key mismatch between register and runtime push** (issues #9, #10, #11, #49). `vibrato_depth` (register) vs `expression_vibrato_depth_max` (runtime); `humanize` (Tightness macro) vs `humanize_amount` (panel) — the engine is fed inconsistent keys for the same field.
3. **Sample-load concurrency / cancellation / surfaced errors** (issues #5, #6, #7, #19, #47, #58) — switching instruments mixes zone maps; failures show as success; `Promise.allSettled` holds all decoded buffers in memory simultaneously.
4. **Telemetry / dead state** (issues #46, #62, #63) — `activeVoices`/`peakL`/`peakR` are wired in the UI but never written; `uiLevel` and `enabled` flags are dead.
5. **Bridge architecture: god-object, decorative DI, zero behavioural test coverage** (issues #3, #4, #26, #27, #44, #54) — multiple files exist for one API; multiple test files all check only "is defined"; engine-call drops are silent.
6. **Missing module barrel + missing `handlers/`/`executeAppAction` integration + no events** (issues #1, #23, #24, #25, #61) — Levain is sealed: no scriptability, no undo, no observability.
7. **Direct store writes from the panel + redeclared `defaultLevainState` + permissive store fabrication** (issues #16, #28, #59, #65) — every mutator silently creates entries, hiding race / order bugs.
8. **Macro routing inconsistencies** (issues #17, #18, #49) — Macro→engine routing keys on user-facing labels; "Space" macro and "Space" knob target different mic indices; `tone`/`attack`/`release` macros write engine-only state with no store mirror.
9. **UX / accessibility / numeric correctness** (issues #14, #29, #30, #31, #33, #34, #35, #36, #51, #66) — equal-power crossfade, key-by-id, aria, knob domain alignment.
10. **Type-soundness escapes** (issues #20, #30, #40, #44 `any` mocks) — `as unknown as` and silent clamping; AGENTS.md prohibits all of these.
11. **Dead code** (issues #22, #32, #43, #46, #52, #57, #62, #63) — factory presets, `loadSingleSample`, `vibratoRateMin`, `activeVoices`, file misnamed `loadPreset`, `DEFAULT_LOD`, `uiLevel`, articulation `enabled`. Sweep or wire up.
12. **AGENTS.md mechanical violations** (issues #1, #37, #44, #52, #55) — positional params, namespace imports, file-vs-export naming, empty catch.

---

## Open issues

### 1. Module has no root `index.ts` barrel

**Problem:** `src/modules/Levain/` has no `index.ts`. Every cross-module consumer deep-imports paths under `presentations/views/`, `stores/`, or `useCases/`. AGENTS.md "Cross-module imports MUST only target the destination module's root `index.ts`" — Levain cannot be consumed within its contract. There is no curated public surface; what counts as "public" is whatever a consumer happens to deep-import.

**Representative files:**

- `src/modules/Levain/` (no `index.ts`)
- `src/modules/Levain/stores/index.ts` (partial barrel, three names only)
- `src/modules/Levain/useCases/index.ts` (three names only — see issue #23)

**Needed:** Create `src/modules/Levain/index.ts` re-exporting `LevainPanel` from `presentations/views`, the store handles intended for cross-module use (likely `levainStore` and `LevainState` as a type), and the use cases needed externally (`registerLevainDevice`, `unregisterLevainDevice`, `autoLoadLevainSamples`, plus any `setLevainParamWithAudio` family if scriptability matters). Audit current consumers (`grep -r "from '#/modules/Levain"`) and rewrite them through the barrel.

### 2. `levainBridge` singleton has subtle test-isolation hazards (NOT what the previous reviewer claimed)

**Verified at `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts:11-16` + `src/infra/di/inject.ts:96-147`.** The previous reviewer claimed the `inject(...)` factory runs eagerly at module load. **That is wrong.** `inject()` returns an `invoker` (line 104) that runs the factory **lazily on first call**, caches the result in `cache.get(invoker)` (line 130), and reads `testOverrides` on each cache miss. `injectDependencies(...)` calls `Container.clear()` (`testing/injectDependencies.ts:10` → `containerState.ts:10-14`), which clears the `cache`. So the very next `levainBridge()` call rebuilds the bridge with the test-override deps. **The test seam works.** Proof: `useCases/__tests__/levainParamBridge.spec.ts:11-31` uses exactly that pattern — `Container.clear()` then `injectDependencies(levainBridge, mocks)` then `registerLevainDevice('levain-device-1', mockDevice, undefined)` — and runs without assertion failures (though the test only asserts `bridge` is defined; see issue #26).

**Real, smaller hazards that survive a careful read:**

1. **Stale references survive `Container.clear()`.** The inner getter closure captures `bridge`. If a consumer holds onto the result of `levainBridge()` (the getter), the bridge it returns is whatever was constructed at the time the invoker last ran the factory. A `Container.clear()` between two `levainBridge()` calls produces two distinct getters — but each getter, once obtained, always returns the bridge it was constructed with. Tests that grab `const bridge = levainBridge()` and then mutate `Container` get a stale `bridge`. (In practice almost all consumers re-call `levainBridge()` per use, so this doesn't bite — but it's a footgun.)
2. **Module state is process-global.** `activeDevices`/`activePorts`/`paramBatcher` live inside the closure. Two test files that both run register/unregister on the same `levainBridge` invoker share the same maps unless they remember to `Container.clear()` between specs. There is no per-test reset hook.
3. **The double indirection (`getLevainBridgeSingleton(): bridge`) is decoration.** It serves no purpose: `inject(...)((deps) => createLevainBridge(deps))` would have given the same lazy-singleton behaviour with one fewer closure layer. The wrapper was likely written under the same misconception that #2 originally claimed, "to keep the bridge a singleton across calls." `inject` already does that.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts:11-16`
- `src/infra/di/inject.ts:96-147`
- `src/infra/di/testing/injectDependencies.ts:6-26`
- `src/infra/di/Container.ts:21-23`
- `src/infra/di/internal/containerState.ts:10-14`
- `src/modules/Levain/useCases/__tests__/levainParamBridge.spec.ts:11-31` (proof the seam works)

**Needed:**

- Drop the inner `getLevainBridgeSingleton` wrapper; `inject(deps)((deps) => createLevainBridge(deps))` is sufficient.
- Update the JSDoc to reflect reality: `injectDependencies(levainBridge, …)` works **only after** `Container.clear()`. The current JSDoc reads as if no clear were needed.
- Audit for any place where a stale reference to `levainBridge()` is held across a possible `Container.clear()`. Currently none, but the door is open.

### 3. `createLevainBridge` is a god-object across `useCases`/`stores`/`repositories`

**Problem:** Inside one closure, `helpers.ts:25-213` owns: in-memory device + port maps (state, should be `stores/`), rAF flush scheduling (UI), `device.setParam` / `device.handleCc` calls (engine I/O, should be `repositories/` or `engine/`), and orchestration (use case). It also encodes the engine's parameter naming convention via `camelToSnake`. AGENTS.md "Repositories Touch Metal" + "Use cases orchestrate repositories" — this file does both jobs.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:25-213`

**Needed:** Split into:

- `repositories/levainEngineBridge.ts` for `device.setParam` / `device.handleCc` / port-message I/O (single function per file, e.g. `sendEngineParam`, `sendEngineCc`).
- `stores/levainDeviceRegistry.ts` for the `Map<deviceId, LevainDevice>` and `Map<deviceId, MessagePort>`.
- `useCases/levainParamBridge/*.ts` for thin orchestrators that read the registry, schedule rAF flushes, and post to the repository.
- A `services/camelToSnake.ts` (or move to `#/utils/`) for the naming helper, with tests.

### 4. Eight zero-value pass-through use-case files

**Problem:** `useCases/levainParamBridge/{registerLevainDevice,unregisterLevainDevice,loadSamplesForInstrument,setLevainParamWithAudio,setMacroWithAudio,sendHumanizeToEngine,sendLegatoEnabledToEngine,sendMicParamToEngine}.ts` are each one-line forwarders to `levainBridge().<method>(...)`. They satisfy "one function per file" cosmetically but add no value (no validation, no store mutation, no error mapping, no logging) over a single `LevainBridgeApi`.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/setLevainParamWithAudio.ts`
- `src/modules/Levain/useCases/levainParamBridge/setMacroWithAudio.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendHumanizeToEngine.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendLegatoEnabledToEngine.ts`
- `src/modules/Levain/useCases/levainParamBridge/sendMicParamToEngine.ts`
- `src/modules/Levain/useCases/levainParamBridge/loadSamplesForInstrument.ts`
- `src/modules/Levain/useCases/levainParamBridge/registerLevainDevice.ts`
- `src/modules/Levain/useCases/levainParamBridge/unregisterLevainDevice.ts`

**Needed:** Combined with issue #3, each pass-through can absorb a real responsibility (validate input ranges, mutate the store, push through the registry, persist via `persistDeviceParam`) — or be deleted in favour of a single `useCases/levainBridge.ts` exporting the API, plus per-file thin orchestrators only where the orchestration is non-trivial.

### 5. Decode pipeline: shared `OfflineAudioContext` + ever-chaining `decodeQueue`, no abort, plus internal `arrayBuffer` race

**Verified at `repositories/sampleLoader/helpers.ts:33-82` and `loadInstrumentFromManifest.ts:130-143`.** The previous reviewer was right on the structural points (global queue, no `close()`, no abort). I add three additional concrete hazards:

1. **The `decodeQueue.then(...)` body in `helpers.ts:60-80` swallows fetch-then-decode-error mismatches.** The outer `Promise` (line 59) resolves/rejects only via the inner `decodeQueue.then(...)` callback. If `decodeQueue` itself was rejected by a previous decode failure, all subsequent `.then(...)` callbacks would never execute the success path either. **However**, the inner `try/catch` (lines 61-78) always returns `void`/`return` — so the rejection is converted to `reject(...)` for that specific call but the outer `decodeQueue` chain itself never propagates the rejection (the `try/catch` swallows it, then `return` resolves the chain). So decoder errors don't poison the queue. Good news, but this is fragile — any refactor that removes the `try/catch` would deadlock the queue forever.
2. **`fetchAndDecode` mutates the global `decodeQueue` from a non-atomic read-modify-write.** `decodeQueue = decodeQueue.then(...)` (line 60) reads the current `decodeQueue`, attaches `.then`, and assigns back. Two concurrent calls in the **same microtask** read the same `decodeQueue`, both attach `.then`, and the second assignment wins — losing the first's chain. JS is single-threaded so this is unlikely in practice, but the global-mutable-state pattern is at the boundary of Safari's quirks; the comment "Strictly sequence" is misleading.
3. **`OfflineAudioContext(2, 44100, 44100)` is fixed sample rate.** Samples decoded by `decodeAudioData` use the manifest's sample rate (the manifest declares one — `loadInstrumentFromManifest.ts:42` `sampleRate: number`), but the `OfflineAudioContext` always uses 44100. `decodeAudioData` resamples to the destination context's rate. The frontend code then reads `audioBuffer.sampleRate` (which will be 44100 after resampling) and posts that to the worklet. The original manifest sample rate is **lost** by the time the buffer reaches the worklet. If any zone declares loop points or pitch ratios in original-sample-rate units, they'll mismatch. (Not necessarily a bug, but undocumented.)
4. **`decodeAudioData` detaches the `arrayBuffer`.** After `await ctx.decodeAudioData(arrayBuffer)`, `arrayBuffer` is detached (per spec). Re-using `arrayBuffer` after that point would throw. The current code doesn't reuse it, but a future refactor that retries on failure might. No tests cover this.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/helpers.ts:33-82`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:130-143`

**Needed:**

- Replace the global queue with a per-load `AbortSignal` plumbed from `loadInstrumentFromManifest` and from `autoLoadLevainSamples`.
- For Safari concurrency, batch decodes per-load with a small concurrency cap (e.g. 2) instead of globally serialising.
- Use a fresh `OfflineAudioContext` per decode (or pooled per-load) and `close()` it; document the implicit resample.
- Drop `let decodeQueue = …` global; pass a queue handle into the repository function.

### 6. No cancellation on rapid instrument switches

**Problem:** Clicking instruments in the panel fires `loadInstrument` synchronously with no signal to the previous load. Every concurrent load posts `clearZones` then refills the worklet's zone map; the last one to finish wins. Intermediate loads consume CPU, allocate hundreds of MB through `OfflineAudioContext`, and may interleave `addZone` / `addSample` messages mid-flight (the previous load's deferred `Promise.allSettled` resolution races against the new load's `clearZones`).

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:142-167`
- `src/modules/Levain/useCases/loadPreset.ts:15-20`
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:54-65` (`loadSamplesForInstrument`)
- `src/modules/Levain/useCases/autoLoadSamples.ts:21-58`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:70-213`

**Needed:** Track the in-flight load per `deviceId` (e.g. `Map<deviceId, AbortController>`). On new load, abort the old one and `clearZones` only after the abort is honoured. `fetch`, `decodeAudioData`, and the `Promise.allSettled` loop must all observe `signal.aborted` and bail. UI should disable instrument buttons while a load is in flight (or queue) — current panel allows infinite click-spam.

### 7. Zone IDs are unstable when samples fail to load and across reloads

**Problem:** `loadInstrumentFromManifest.ts:173-205` increments `zoneId` linearly while iterating `allZones` and **skips** zones whose sample failed to load. The worklet sees a zone ID space that depends on which fetches happened to fail this run. A re-load (no cancellation — issue #6) starts from `zoneId = 0` again and overwrites the worklet's table; any voice still referencing an old zone ID points to a different sample now.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:173-205`
- `src/modules/Levain/repositories/sampleLoader/loadSingleSample.ts:7-23` (uses an independent caller-supplied id space — see issue #43)

**Needed:** Pre-assign `zoneId` deterministically from the manifest order (every zone gets an id whether the sample loaded or not). Send `addZone` only for loaded samples, but do not renumber. Document the contract and add a test that interleaves a partial-failure scenario and asserts the final zone IDs match the manifest order.

### 8. `registerLevainDevice` never auto-loads samples on a fresh device because nothing initialises the store entry first

**Verified at `helpers.ts:67-86` + `wasmDeviceRegistry.ts:245-254`.** The previous reviewer had the direction backwards. The actual bug is far worse:

1. `levainStore` is initialised empty: `stores/levainStore.ts:47-49` `createStore({ initialData: {} })`.
2. `loadInstrument` in `useCases/loadPreset.ts:25-32` is the **only** code path that ever populates a `levainStore[deviceId]` entry inside the module (under `applyPatch` it `return`s early if `state` is missing — `loadPreset.ts:29-31`). So `loadInstrument` cannot bootstrap an empty entry either.
3. `setEngineReady` (called from `wasmDeviceRegistry.ts:254` after `registerLevainDevice` at line 245) is the only mutator that fabricates a default entry. So there is **a window** between `registerLevainDevice` and `setEngineReady` where `levainStore.value?.[deviceId]` is `undefined`.
4. `registerLevainDevice` reads `state?.patch` at `helpers.ts:71`. For a fresh device, `state` is `undefined`, so the entire `if (state?.patch)` branch (lines 72-84) — including `loadSamplesForInstrument(...)` — is skipped.
5. Net effect: **on initial track creation, samples never load**. The user has to click an instrument in the panel to trigger `loadInstrument` → `loadSamplesForInstrument`. Until they do, the engine plays the WASM-side fallback (sine tone, per `autoLoadSamples.ts:53`).
6. Worse, `wasmDeviceRegistry.ts:230` calls `_unregisterLevainDevice(deviceId)` from `controller.destroy`, which deletes the levainStore entry. The next track that gets the same `deviceId` (e.g. during HMR or project reload after `resetModuleStoresToDefault` at `Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:39`) hits the same empty-state condition.

The previous reviewer also claimed `setSampleLoadProgress` would "replace any pre-existing `LevainState`" — wrong. `stores/levainStore.ts:74` `state = instances[deviceId] ?? defaultLevainState` falls back **only when the entry is missing**. If it exists, it is preserved (only `sampleLoadProgress` is overwritten in the spread).

**Real, distinct issues this exposes:**

- `registerLevainDevice` silently skips the entire patch-sync block when `state?.patch` is undefined; the device is added to `activeDevices` but receives **no params** (no `master_gain`, no `legato_enabled`, no mics — see also issue #9). This is invisible at the call site.
- The "patch-driven reload in `registerLevainDevice`" referred to by the candid comment in `autoLoadSamples.ts:18-19` is dead code on a fresh project.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67-86`
- `src/modules/Levain/useCases/autoLoadSamples.ts:45-56`
- `src/modules/Levain/stores/levainStore.ts:47-76`
- `src/modules/Levain/useCases/loadPreset.ts:15-32`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:245-254`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:39`

**Needed:**

- Define a single bootstrap point that creates a `LevainState` entry _at_ `registerLevainDevice` time when one does not exist (using a default patch, or a serialised patch from project state).
- Have `registerLevainDevice` accept an `initialPatch` (or `instrumentId`) so the device knows what to load even before the panel renders.
- Drop the `state?.patch` early-skip; if there's no patch, create one. Or fail loudly with `logger.error` so the silent-fallback case stops being indistinguishable from success.
- The unregister path should retain the patch in the store across HMR / track-recreation cycles (or be coupled to a persistence layer — see issue #25).

### 9. `registerLevainDevice` only pushes 4 + N_mics params, AND the keys it pushes don't match the keys `setLevainParamWithAudio` would use for the same fields

**Verified at `helpers.ts:73-83` and `helpers.ts:117-133`.** The previous reviewer correctly identified that registration is incomplete. There is also a **rust-key mismatch** between the two paths that breaks the engine's view of the same field:

| Patch field | `registerLevainDevice` queues | `setLevainParamWithAudio('expression', { … })` would queue |
| --- | --- | --- |
| `expression.vibratoDepthMax` | `vibrato_depth` (helpers.ts:77) | `expression_vibrato_depth_max` (helpers.ts:124-127, via `${camelToSnake('expression')}_${camelToSnake('vibratoDepthMax')}`) |

So the very first param push uses one key, every subsequent push from the panel uses a different key. The engine receives both and either ignores one or applies them to two different DSP slots. The audit's previous priority on "patch / engine divergence" missed that this isn't just "fields not pushed" — it's "fields pushed under inconsistent keys".

The other register-path keys are consistent:

- `master_gain` / `setLevainParamWithAudio('masterGain', …)` → both yield `master_gain`. (Match.)
- `legato_enabled` / `setLevainParamWithAudio('legato', { enabled: … })` → both yield `legato_enabled`. (Match.)
- `humanize_amount` / `setLevainParamWithAudio('humanize', { amount: … })` → both yield `humanize_amount`. (Match.)
- `mic_{i}_volume` / per-mic update via `sendMicParamToEngine` — `device.setParam(\`mic_${micIndex}_${param}\`, …)` (helpers.ts:199) yields `mic_{i}_volume`. (Match.)

**The remaining never-pushed fields** (per the previous reviewer): `expression.dynamicCrossfadeTime`, `expression.cc1Curve` (also see issue #10), `expression.vibratoRateMin/Max`, `expression.vibratoOnsetDelay`, all of `legato.*` except `enabled`, all of `humanize.*` except `amount`, all `releaseTriggers.*`, `currentArticulation`, every macro and macro label — these continue to drift silently until the first user edit.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67-86` (register-side keys)
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:117-133` (setParam-side keys)

**Needed:** Define one mapping table per patch leaf to a stable rust key — `PATCH_TO_ENGINE: Record<PatchLeafPath, string>` — and route both register-time push and runtime push through it. Add a test that asserts the two paths produce the same rust key for the same field. Combine with issue #11 (drop `camelToSnake` heuristic).

### 10. `setLevainParamWithAudio` drops strings and arrays from nested patch fields

**Problem:** `helpers.ts:123-133` recurses one level into objects but only forwards `number` and `boolean` children. `expression.cc1Curve: 'linear' | 's-curve' | 'logarithmic'` (a string) is **never sent to the engine**. Articulation arrays, macro-label arrays, the `humanize.seed` integer (which is a number, fine) — strings/arrays/nested-objects are silently dropped.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:102-134`

**Needed:** Either (a) restrict `setLevainParamWithAudio` to scalar fields with a typed dispatcher per top-level patch key (explicit `case 'expression':` branches that pull out only the numeric / boolean leaves the engine wants), or (b) define a `PATCH_TO_ENGINE_KEYS` map per leaf that explicitly says which engine key receives which patch field, including string-encoded enums (e.g. `cc1Curve: 'linear' → 0`, `'s-curve' → 1`, `'logarithmic' → 2`). Drop the `Object.entries` recursion.

### 11. `camelToSnake` is naive and untested

**Problem:** `helpers.ts:21-23` `replaceAll(/[A-Z]/g, …)`. Acronyms (`IDFooBar`) blow up to `_i_d_foo_bar`. There's no test fixture validating that the produced rust keys match what the worklet expects. The engine's parameter naming convention is hard-coded in this one function.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:21-23`

**Needed:** Either replace with an explicit `KEY_MAP: Record<keyof LevainPatch, string>` (no inference, no surprises) or unit-test the conversion against the actual rust side's expected keys. AGENTS.md "TypeScript — soundness" — string transformations as a type contract are a code smell.

### 12. `unregisterLevainDevice` leaks pending rAF batches that fire on a deleted device

**Problem:** `helpers.ts:88-101`. The comment is candid, but the consequence is a `persistDeviceParam(deviceId, …)` call on a deleted device — which can resurrect state in the persistence layer.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:88-101`
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:34-44` (`flushParam`)

**Needed:** Extend `createRafBatcher` with a `cancelMatching(predicate)` (or `cancelByPrefix(prefix)`) method, and call `paramBatcher.cancelByPrefix(`${deviceId}:`)` in `unregisterLevainDevice`. Or guard `flushParam` with `if (!activeDevices.has(deviceId)) return` _before_ the `persistDeviceParam` call.

### 13. Store and engine sync split across two paths, no shared mutator

**Problem:** `LevainPanel.tsx:179` calls `setCurrentArticulation(deviceId, type)` (store-only) — but the engine has a separate `current_articulation` index that is pushed only via `setLevainParamWithAudio(deviceId, 'currentArticulation', ...)`. Same split for mic state: `updateMicPosition` (store-only) and `sendMicParamToEngine` (engine-only). Any caller that uses one without the other drifts state from engine.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:179,233-240,251-269,283-285,294-298`
- `src/modules/Levain/stores/levainStore.ts:78-90,112-130`
- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:46-49,55-60,68-72,102-110`

**Needed:** A single use case per atomic patch change that both updates the store and pushes the engine call (`changeArticulation`, `changeMicPosition`, `changeMacro`). Components/views call only the unified use case. Document that bare store mutators (`setCurrentArticulation`, `updateMicPosition`) do not touch the engine and must not be called from the UI directly.

### 14. `MicBlendSlider` blend math is asymmetric, jumps on edge cases, fights the user

**Problem:** `MicBlendSlider.tsx:91-93,101-110`. `blend = roomVol / (closeVol + roomVol + 0.001)`; when both volumes are 0 the displayed blend ≈ 0 but as soon as the user nudges the knob, `newCloseVol = 1.0 - v * 0.5` drives Close volume from 0 to 0.5 (not what the user moved). The compact knob also abuses the "enabled" flag of mic 2 by toggling on `> 0.05`, causing the toggle UI to flip during continuous knob drags.

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:90-127`

**Needed:** Replace with a proper crossfade: keep total volume invariant, use `closeVol = cos(blend * π/2)`, `roomVol = sin(blend * π/2)` (equal-power), do not toggle the room mic's `enabled` flag from a continuous control. Also: handle the zero-volume case explicitly instead of `+ 0.001`.

### 15. Canvas `useEffect` paints have no cleanup and are not DPR-aware

**Problem:** `ExpressionPanel.tsx:28-102`, `LegatoTuning.tsx:24-97`. `<canvas width={320} height={100}>` is fixed pixel size; on a 2× display the diagrams are blurry. The `useEffect` has no cleanup; if the component unmounts mid-paint there is no abort. Also, the canvas size is fixed in CSS via `w-full max-w-[320px]` — the rendered pixel ratio is ambiguous (CSS-stretched 320×80 vs native).

**Representative files:**

- `src/modules/Levain/presentations/components/ExpressionPanel.tsx:24-112`
- `src/modules/Levain/presentations/components/LegatoTuning.tsx:21-107`

**Needed:** Use `window.devicePixelRatio` to set the canvas backing buffer; reflect via `.style.width` for layout. Return a cleanup function from `useEffect` (`ctx.clearRect(0, 0, w, h)`) for unmount safety. Or replace the canvases with SVG, which is React-native and trivially DPR-correct.

### 16. `LevainPanel` redeclares `defaultLevainState` instead of importing from the store

**Problem:** `LevainPanel.tsx:69-78` is a duplicate of `stores/levainStore.ts:34-43`. Drift-prone: any new field added to `LevainState` must be remembered in two places.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:69-78`
- `src/modules/Levain/stores/levainStore.ts:34-43`

**Needed:** Import `defaultLevainState` from `../../stores/levainStore` (it's already exported from the store barrel at `stores/index.ts:1`). Delete the local copy.

### 17. `setMacroWithAudio` couples engine routing to user-facing string labels

**Problem:** `helpers.ts:149-179` switches on `state.patch.macroLabels[index]` against literal English strings. Macro labels are user-editable in principle (they're `string[]` in the model). Renaming `'Dynamics'` → `'Loud'` silently breaks the macro→engine wiring. Also tightly couples the bridge to the macro vocabulary; any AI / automation changing macro labels destroys the routing.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:149-179`
- `src/modules/Levain/models/LevainPatch.ts:215` (`macroLabels: [string, …]`)
- `src/modules/Levain/models/LevainPatch.ts:305` (default labels)

**Needed:** Either (a) introduce a stable `macroFunction: MacroFunction[]` field separate from the user-facing `macroLabels`, where `MacroFunction = 'dynamics' | 'expression' | 'vibrato' | 'tightness' | 'space' | 'tone' | 'attack' | 'release' | 'none'`, and switch on `macroFunction[index]`; (b) make `macroLabels` a string-literal union typed exhaustively at compile time; or (c) accept that macros are fixed-purpose and remove `macroLabels` from the user-editable patch.

### 18. Macro 'Space' targets mic indices 0/1 (close + decca-tree), the compact slider targets 0/2 (close + room) — inconsistent

**Problem:** `helpers.ts:163-166` writes mic 0 + mic 1 for the Space macro. `MicBlendSlider.tsx:91-110` uses mic 0 + mic 2 for the compact "Close vs Room" knob. Two paths, two interpretations of "Space".

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:163-166`
- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:91-110`

**Needed:** Pick one convention. If "Space" means dry vs wet, both should target close + room (mic 0 + mic 2). Use a named constant (`MIC_INDEX_CLOSE = 0`, `MIC_INDEX_ROOM = 2`) and reference it everywhere.

### 19. Sample-load failures are silent to the user

**Problem:** `autoLoadSamples.ts:51-57` — failures `logger.warn` to dev console; the UI sets progress to `1.0` then `null`, indistinguishable from success. There is no `notifyUser` call, no store error field, no toast. Users see a "Loading" LED flip to "Ready" while the engine is silent (or worse, on a half-loaded zone map).

**Representative files:**

- `src/modules/Levain/useCases/autoLoadSamples.ts:45-57`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:144-149`

**Needed:** Add a `sampleLoadError: string | null` field to `LevainState`, set it on catch, and surface in the panel with an aria-live region. Also escalate to `notifyUser({ type: 'error', message: 'Failed to load <instrument> samples' })` for unrecoverable failures (e.g. manifest 404). Do not flip progress to `1.0` on error — set it to `null` and let the UI render the error.

### 20. `as unknown as` cast in `autoLoadLevainSamples` for `convertFileSrc`

**Problem:** `autoLoadSamples.ts:34-36` casts `tauriCore as unknown as { convertFileSrc: (p: string) => string }` with an eslint-disable. `@tauri-apps/api/core` exports `convertFileSrc` as a typed function; the cast is masking a `tsconfig` / dynamic-import inference issue, not a real type gap.

**Representative files:**

- `src/modules/Levain/useCases/autoLoadSamples.ts:30-37`

**Needed:** Use a static import `import { convertFileSrc } from '@tauri-apps/api/core'` guarded by `isTauri`, or a typed dynamic import (`await import(...)` returns the module type if `tsconfig` is configured for it). Drop the cast and the eslint-disable.

### 21. `isTauri` evaluated at module scope in `autoLoadSamples`

**Problem:** `autoLoadSamples.ts:9` evaluates `typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window` at module load. In SSR / test environments where `window` is shimmed later, this captures `false` permanently.

**Representative files:**

- `src/modules/Levain/useCases/autoLoadSamples.ts:9`

**Needed:** Inline the check at the top of `autoLoadLevainSamples`, or use a shared helper (`isTauri()` from `#/utils/tauri`, which other modules already use — see `AudioAnalysis/repositories/audioAiEngine.ts`).

### 22. `repositories/levainPresets.ts` is dead code

**Problem:** `loadPreset(presetId)` and `FACTORY_PRESETS` are never imported. The use case in `useCases/loadPreset.ts` (`loadInstrument`) creates default patches via `createDefaultPatch`, ignoring the preset overrides. There is no UI surface that lists presets, no `useCases/index.ts` export, no `Command` integration.

**Representative files:**

- `src/modules/Levain/repositories/levainPresets.ts:120-159`
- `src/modules/Levain/useCases/loadPreset.ts` (does not call `loadPreset`)
- `src/modules/Levain/useCases/index.ts` (does not export anything related)

**Needed:** Either (a) wire factory presets through a `loadPresetById(deviceId, presetId)` use case that the panel exposes, with a "Presets" tab in the UI; or (b) delete `repositories/levainPresets.ts`. Keeping dead constants invites drift.

### 23. `useCases/index.ts` exposes only 3 of 11 use cases

**Problem:** `useCases/index.ts:1-3` re-exports `autoLoadLevainSamples`, `registerLevainDevice`, `unregisterLevainDevice`. `setLevainParamWithAudio`, `setMacroWithAudio`, `loadInstrument`, `loadSamplesForInstrument`, `sendHumanizeToEngine`, `sendLegatoEnabledToEngine`, `sendMicParamToEngine` are not in the use-case barrel — they are reachable only via deep imports. AGENTS.md "Cross-module access is **only** via `get<Module>Handlers` in `useCases/`" + curated barrel.

**Representative files:**

- `src/modules/Levain/useCases/index.ts:1-3`

**Needed:** Decide which use cases are public (likely: registration, loading, and patch-mutation use cases that the AI runtime / automation will need) and re-export them from `useCases/index.ts`. Combine with issue #1 (root barrel re-exports `useCases`).

### 24. No `handlers/` — Levain has no `AppAction` integration

**Problem:** No `handlers/<action>.ts`, no `getLevainHandlers` in `useCases/`, no `Command` bus integration. AGENTS.md mandates `handlers/` for any module that participates in the command bus. Levain therefore has no undo/redo, no AI scripting, no automation — every interaction is panel-only and discarded on reload.

**Representative files:**

- `src/modules/Levain/handlers/` (does not exist)
- `src/modules/Levain/useCases/index.ts` (no `getLevainHandlers`)

**Needed:** Define `AppAction` payloads (`changeArticulation`, `setMacro`, `setMicVolume`, `loadInstrument`, etc.) in `Command/useCases/commandQueries.ts`; add `handlers/<name>.ts` files using `createHandler` from `#/helpers/createHandler`; aggregate via `getLevainHandlers` and re-export from the module barrel. Update the panel to call `executeAppAction` instead of writing the store directly (issues #13, #28).

### 25. No undo/redo / persistence story

**Problem:** `levainStore` is plain in-memory. No event source, no transient command shape, no project-file integration beyond per-rust-key `persistDeviceParam` flushes (which are per-leaf, not per-patch). Reloading the project through `Project` does not necessarily restore the full `LevainPatch` — only whatever leaves were ever persisted.

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts` (no event sourcing, no project hook)
- `src/modules/Levain/events/index.ts` (intentionally empty)
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:43` (`persistDeviceParam(deviceId, rustKey, value)` — leaf-level)

**Needed:** Define `LevainPatchEvent` events (e.g. `levain.patchLoaded`, `levain.macroChanged`, `levain.micChanged`) in `events/index.ts`. Hook `Project` save/load to serialise the full patch per `deviceId`. Wire undo via `Command` (issue #24) so each user gesture is a single transactable command, not N rust-key flushes.

### 26. `levainBridge.spec.ts` is a 5-line smoke test, AND the more elaborate `useCases/__tests__/levainParamBridge.spec.ts` is also effectively a smoke test

**Verified.** `useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9` is `import * as subject from '../levainBridge'; expect(subject).toBeDefined();`. **Plus** there's a second test file the previous reviewer didn't mention — `useCases/__tests__/levainParamBridge.spec.ts` — which DOES use `injectDependencies` correctly (so issue #2 was wrong), but its only assertion is `expect(bridge).toBeDefined()` after `registerLevainDevice('levain-device-1', mockDevice, undefined)`. The mock device's `setParam` is never inspected; `persistDeviceParam` is never inspected; the test never exercises the rAF flush path. It looks like a behaviour test but it asserts only that the bridge is defined.

So Levain has **two** essentially-empty bridge specs, plus eight pass-through-file specs that just check exports exist.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9`
- `src/modules/Levain/useCases/__tests__/levainParamBridge.spec.ts:1-32`

**Needed:** Replace both with a single behaviour suite covering: register / unregister, rAF queue+flush, register-time patch sync (and the mismatch in #9), articulation index push, mic param routing, macro routing per label, dropped-string regression (issue #10), camelToSnake mapping (issue #11). Use `vi.useFakeTimers()` + `requestAnimationFrame` mock to deterministically flush the batcher.

### 27. The JSDoc test seam claim works, but is incomplete: it omits the `Container.clear()` precondition

**Verified.** `levainBridge.ts:8-10` JSDoc:

> Injectable singleton — resolves `getAllTracks`, `persistDeviceParam`, `autoLoadLevainSamples` for tests via `injectDependencies(levainBridge, …)`.

In isolation this is misleading. The seam works, but only after `Container.clear()` (which clears the cache that holds the previously-resolved invoker — see issue #2 revised). Without `Container.clear()`, `injectDependencies` sets test overrides but the cached invoker still returns the bridge built with the original deps. The test in `useCases/__tests__/levainParamBridge.spec.ts:11-13` knows this and calls `Container.clear()` in `beforeEach` — but the JSDoc doesn't say so. A future test author who reads the JSDoc and skips the clear will silently get the production bridge.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts:8-16`
- `src/modules/Levain/useCases/__tests__/levainParamBridge.spec.ts:11-13` (the example that does it correctly)

**Needed:** Update JSDoc to say "must be preceded by `Container.clear()`" and link to the example test. Or restructure `levainBridge` so the cache is per-test-file (a `vi.beforeEach` global hook in setupTests). Or — better — drop the inner `getLevainBridgeSingleton` wrapper entirely (issue #2 revised) so the surface is just `levainBridge` as the callable and the seam is identical to every other `inject(...)`-wrapped function in the codebase.

### 28. Panel writes the store directly, conflating presentation with state mutation

**Problem:** `LevainPanel.tsx:15` imports `setCurrentArticulation`, `updateMicPosition` from the store and uses them as event handlers. Per AGENTS.md the view should call use cases (or `executeAppAction`); store mutators are private to the module's command path so undo/redo and command-bus replay are possible.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:15,179,285`
- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:46-49,57-59,68-71,102-110`

**Needed:** Coupled to issue #24. Replace direct store writes with `executeAppAction({ type: 'levain.changeArticulation', deviceId, articulation })` etc. Keep the bare store mutators as the `handlers/` implementation only.

### 29. `MicBlendSlider` mic strips use array-index keys

**Problem:** `MicBlendSlider.tsx:41` `key={i}`. If `micPositions` is reordered or filtered, React reuses the wrong DOM node and the wrong toggle / fader animates.

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:40`

**Needed:** Use `key={mic.type}` (the `MicPositionType` literal is unique per slot per family default).

### 30. Fader scaling formula is asymmetric and silently clamped

**Problem:** `MicBlendSlider.tsx:55-60`. Forward `mic.volume * 76 - 70`, inverse `(db + 70) / 76` with `Math.max(0, Math.min(1, …))`. Clamping only on the inverse means an out-of-domain `mic.volume > 1` displays out-of-range dB but the next change clamps and overwrites it. Patch validation should reject `mic.volume > 1` at the model boundary.

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:55-60`
- `src/modules/Levain/models/LevainPatch.ts:120` (`volume: number; // 0-1`)
- `src/modules/Levain/stores/levainStore.ts:112-130` (`updateMicPosition` does not validate)

**Needed:** Validate `volume ∈ [0, 1]` in the store mutator, or move to a branded `Volume01` type. Symmetric scaling on both sides of the Fader.

### 31. `HumanizePanel` knob domain mismatches patch domain (×100 scaling)

**Problem:** `HumanizePanel.tsx:79-93,96-110` displays a `0..15` / `0..30` knob over `dynamicMax` and `vibratoVarMax` which are `0..1` in the patch. Conversion happens inline via `* 100` / `/ 100`. Future automation hooks that read raw 0–1 values will see a value ≤ 0.15 and produce silence; UI knob will jump to a different domain than expected.

**Representative files:**

- `src/modules/Levain/presentations/components/HumanizePanel.tsx:79-110`
- `src/modules/Levain/models/LevainPatch.ts:163-164` (`dynamicMax: number; // max dynamic variation (0-1)`)

**Needed:** Either (a) widen the patch domain to `0..15` for `dynamicMax` and `0..30` for `vibratoVarMax` (with a units comment), or (b) introduce display-only adapters in the component, but make the conversion explicit (e.g. `displayValueFromDynamicMax(config.dynamicMax)` / `dynamicMaxFromDisplayValue(v)`). Document the unit in the patch type's JSDoc.

### 32. `ExpressionPanel` exposes only `vibratoRateMax`, not `vibratoRateMin`

**Problem:** `ExpressionPanel.tsx:198-211`. The patch defines a min and max; the UI exposes only max as "Rate". The min is never user-editable.

**Representative files:**

- `src/modules/Levain/presentations/components/ExpressionPanel.tsx:198-211`
- `src/modules/Levain/models/LevainPatch.ts:138-139`

**Needed:** Either expose a min/max range slider, or remove `vibratoRateMin` from the patch (it's effectively a constant if the UI never touches it). If the engine uses it for randomisation, document the constant clearly.

### 33. Panel chips, instrument list, and progress are not screen-reader accessible

**Problem:** `LevainPanel.tsx:124-138` (family chips: no `role="radiogroup"`, individual chips have no `aria-pressed`), `:142-167` (instrument buttons: no `aria-current` for the active item, the active state is colour-only), `:176-181` (Articulation rail likewise), `:212-219` ("Load 75%" tile is not an `aria-live` region — sample-load progress is silent to AT). The "Loading" LED at `:110` likewise.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:99-385`

**Needed:** `role="radiogroup"` + `aria-pressed` on the family chips; `aria-current="true"` on the active instrument button; `role="status" aria-live="polite"` on the load progress tile and the Ready/Loading LED. Audit `RotaryKnob` / `Fader` for keyboard accessibility (out of scope for Levain, but record as a finding).

### 34. Family filter hides instruments with `hasSamples: false` with no surfaced reason

**Problem:** `LevainPanel.tsx:91-96`. Filter condition `&& instrument.hasSamples`. The harp is hidden silently. If the user searches "harp" they get an empty list.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:91-96,27-46`

**Needed:** Either surface the unsupported instrument with a "samples not available" badge (rather than hide), or remove the entry entirely from `INSTRUMENTS`.

### 35. `LevainMacroStrip` keys on label, which is non-unique

**Problem:** `LevainMacroStrip.tsx:20`: `key={label}`. `macroLabels` are user-renameable; two macros may share a label. React will collapse the duplicate keys and animate the wrong knob.

**Representative files:**

- `src/modules/Levain/presentations/components/LevainMacroStrip.tsx:18-31`

**Needed:** `key={`macro-${i}-${label}`}` or use a stable per-slot id (`MACRO_SLOT_IDS = ['m1', …, 'm8'] as const`).

### 36. Magic `+ 0.001` divisor in compact `MicBlendSlider`

**Problem:** `MicBlendSlider.tsx:93`: `roomVol / (closeVol + roomVol + 0.001)`. Avoids a div-by-zero but biases the result for low volumes. With `closeVol = roomVol = 0.005`, blend is `0.005 / 0.0011 ≈ 4.5` (clamped where? — `RotaryKnob` will accept it).

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:93`

**Needed:** Coupled to issue #14 — equal-power crossfade obviates the divisor.

### 37. Function signatures take positional args (AGENTS.md violation)

**Problem:** AGENTS.md "Functions with more than one parameter take a single object param. … the input type is named `FunctionNameInput`".

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67,102,136,182,189,196`
- `src/modules/Levain/stores/levainStore.ts:60,72,78,92,112,132`
- `src/modules/Levain/useCases/loadPreset.ts:15,25`
- `src/modules/Levain/useCases/autoLoadSamples.ts:21`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:70`
- `src/modules/Levain/repositories/sampleLoader/loadSingleSample.ts:7`

**Needed:** Refactor each multi-arg function to a single object param with a corresponding `<FunctionName>Input` type defined immediately above. Mostly mechanical.

### 38. Naming distinction between `setLevainParam` (store-only) and `setLevainParamWithAudio` (store + engine) is implicit

**Problem:** `stores/levainStore.ts:60` `setLevainParam` writes the patch. `useCases/levainParamBridge/setLevainParamWithAudio.ts` writes _and_ pushes to the engine. The names differ by `WithAudio` and the panel imports both — easy to call the store-only mutator and silently break audio sync.

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:60-70`
- `src/modules/Levain/useCases/levainParamBridge/setLevainParamWithAudio.ts:5-11`

**Needed:** Rename the store mutator to something explicit (`setPatchFieldInStore` or `_setLevainParamUnsafe`) and re-export only the engine-aware version from `useCases/`. Or wrap both in a single use case (issue #13).

### 39. `INSTRUMENTS` array in `LevainPanel` is decoupled from `InstrumentId` exhaustiveness

**Problem:** Adding an `InstrumentId` to the model does not error in the panel; the new instrument simply doesn't appear. Conversely, removing one doesn't fail the panel — `LevainPanel.tsx:32` would still reference the dead literal `'horn'`.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:27-46`
- `src/modules/Levain/models/LevainPatch.ts:16-60`

**Needed:** Use a `Record<InstrumentId, { label: string; hasSamples: boolean; family: string }>` keyed by `InstrumentId` so missing entries fail to compile. Or `satisfies readonly { id: InstrumentId; … }[]` plus an exhaustiveness assertion at the bottom of the file.

### 40. Silent `Math.min/Math.max` clamps mask out-of-range patch values

**Problem:** `MicBlendSlider.tsx:57` (`Math.max(0, Math.min(1, …))`), `helpers.ts:152` (`Math.round(value * 127)`), `helpers.ts:122` (`childVal ? 1.0 : 0.0`). Patch ranges are documented in JSDoc but enforced inline at the call site, not at the model boundary. Bad data flows through.

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:57`
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:152,156,158`

**Needed:** Validate at model boundaries (`updateMicPosition`, `setMacro`, `setLevainParam`) and throw / log on out-of-range. Keep clamping out of UI components.

### 41. Articulation index lookup silently no-ops on missing types

**Problem:** `helpers.ts:112-115`: `artIndex !== -1 ? queueParam(...) : nothing`. If `currentArticulation` is set to a type not present in `articulations`, the engine `current_articulation` index is never updated. The display string is set anyway. Engine and store drift; the UI looks correct.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:109-116`
- `src/modules/Levain/stores/levainStore.ts:78-90`

**Needed:** Type `currentArticulation` as a constrained subset of `articulations[].type` (compile-time impossible without runtime check) — or assert at the boundary with a `logger.error` + early return. Also: `setCurrentArticulation` should be the single mutator; the engine push should not be a separate code path.

### 42. `loadInstrumentFromManifest` has no test

**Problem:** No spec under `repositories/sampleLoader/`. The most subtle file in the module is uncovered.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:1-213` (no `__tests__/`)

**Needed:** Tests for: LOD filtering (mic / RR thresholds), sampleId stability across `Promise.allSettled` resolution order, partial-failure handling (one fetch fails, others succeed), `clearZones` is sent before any `addSample`, transferable buffers are detached after post.

### 43. `loadSingleSample` shares the worklet's sampleId space without coordination

**Problem:** `loadSingleSample.ts:7-23`: caller-supplied `sampleId`. No registry, no claim. A single-sample preview can collide with a manifest-loaded id.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/loadSingleSample.ts`

**Needed:** Either delete (dead — no caller) or document the contract that callers must use a high reserved id range, with a constant `MIN_PREVIEW_SAMPLE_ID = 100_000` etc. Better: a stable id allocator owned by the bridge.

### 44. Namespace imports in **every** `levainParamBridge/__tests__` spec, plus `as any` masquerading in `LevainPanel.spec.tsx`

**Verified:** AGENTS.md says "Imports: Never use namespace imports". The previous reviewer flagged only `levainBridge.spec.ts:3`. In fact **eight** spec files use `import * as subject from '../<name>'` — the entire `__tests__/` directory matches the same anti-pattern, paired with `expect(subject.<name>).toBeDefined()` smoke assertions. None of these tests exercise behaviour (`expect(subject).toBeDefined()` or `typeof t === 'function' || t === 'object'`).

| File | Line |
| --- | --- |
| `levainBridge.spec.ts` | 3 |
| `setLevainParamWithAudio.spec.ts` | 3 |
| `setMacroWithAudio.spec.ts` | 3 |
| `sendHumanizeToEngine.spec.ts` | 3 |
| `sendLegatoEnabledToEngine.spec.ts` | 3 |
| `sendMicParamToEngine.spec.ts` | 3 |
| `loadSamplesForInstrument.spec.ts` | 3 |
| `registerLevainDevice.spec.ts` | 3 |
| `unregisterLevainDevice.spec.ts` | 3 |

Plus, `presentations/views/__tests__/LevainPanel.spec.tsx` mocks DAW components with `({ children, active, onClick }: any)` (lines 61, 69, 73, 82, 91, 100) and `({ children }: { children: React.ReactNode })` only at line 69 — i.e. **five `any`-typed mock components**. AGENTS.md "TypeScript — soundness" classifies `any` as forbidden.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/__tests__/*.spec.ts` (all nine spec files)
- `src/modules/Levain/presentations/views/__tests__/LevainPanel.spec.tsx:60-108`

**Needed:**

- Replace every `import * as subject from '…'` with named imports (`import { setLevainParamWithAudio } from '…'`).
- Replace every "did the function get exported" smoke assertion with a behaviour test that wires through `injectDependencies` and asserts the engine call / store mutation actually happened.
- Type the mock components in `LevainPanel.spec.tsx` to their real prop types (`PropsOf<typeof DawPluginChip>` etc.); AGENTS.md prohibits `any` even in test mocks.

### 45. `stores/index.ts` partial barrel masks the actual public store surface

**Problem:** `stores/index.ts:1` exports only `defaultLevainState`, `levainStore`, `setEngineReady`. Other mutators (`setLevainParam`, `setSampleLoadProgress`, `setCurrentArticulation`, `setMacro`, `updateMicPosition`, `getLevainState`) are reachable only by deep file imports — yet they are intended for module-internal use. The barrel implies "these three are public" and "the rest are private", but consumers happily reach in for the private ones.

**Representative files:**

- `src/modules/Levain/stores/index.ts`
- `src/modules/Levain/presentations/views/LevainPanel.tsx:15`
- `src/modules/Levain/useCases/loadPreset.ts:7-8`

**Needed:** Decide what's intra-module-private vs cross-module-public. Per AGENTS.md, store mutators should not be cross-module surfaces — they should be reachable only via use cases or handlers. Tighten the barrel and route all writes through use cases.

### 46. `LevainState.activeVoices` / `peakL` / `peakR` are dead state — never written, only displayed

**Problem:** `stores/levainStore.ts:28-30` defines `activeVoices`, `peakL`, `peakR`. Defaults at `:39-41` set them to 0. **No mutator anywhere in the codebase writes them.** Verified by `grep -rn "peakL|peakR|activeVoices" src/modules/Levain` — only declarations / defaults / test fixtures. Yet the panel renders them: `LevainPanel.tsx:202-205` `<DawPluginMetricTile … value={\`${activeVoices}\`} detail="Live active voices" />` and `:351` `<DawPluginLed …>{activeVoices} voices</DawPluginLed>`. The user always sees "0 voices" regardless of how many notes are playing — a permanent zero that looks like a real metric.

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:28-30,39-41`
- `src/modules/Levain/presentations/views/LevainPanel.tsx:202-205,351`

**Needed:** Either (a) wire telemetry from the worklet via a `MessagePort` `onmessage` handler that calls a new `updateLevainTelemetry(deviceId, { activeVoices, peakL, peakR })` mutator (mirror Fermenter / Bacteria / Grinder, all of which already do this — see `wasmDeviceRegistry.ts:91`, `:319-327`, `:448-461` for the pattern); or (b) delete the dead fields and the panel widgets that depend on them. Showing a fixed 0 is dishonest UI.

### 47. `loadInstrumentFromManifest` holds **all** decoded buffers in memory simultaneously before posting to the worklet

**Problem:** `loadInstrumentFromManifest.ts:130-143` runs `Promise.allSettled` over every unique sample file in the manifest, then iterates `results` (line 145) and posts each `addSample`/`addZone` only after the entire batch resolves. While that runs, **every decoded `Float32Array` is alive on the heap simultaneously**. With WEB_LOD (`maxMics: 2, maxVelLayers: 3, maxRoundRobins: 3` per `helpers.ts:16-21`), an instrument like the violins easily produces 200+ unique sample files, each at ~1-3 MB Float32. Peak heap before any transfer is hundreds of MB. The transfer at `:155-166` then detaches the buffers — but only after they've all sat in memory.

A streaming variant (post each `addSample` as soon as `decodeAudioData` resolves, regardless of others) would keep peak heap proportional to the concurrency cap. The current code's only reason to wait is the `clearZones` ordering at line 107 followed by `buildZoneMap` at line 208, which **must** be after all `addZone` posts. The `addSample` posts have no such constraint.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:130-168`
- `src/modules/Levain/repositories/sampleLoader/helpers.ts:60-80` (the global serial queue compounds the problem — see issue #5)

**Needed:** Stream `addSample` messages as soon as each fetch+decode completes; track `loadedFiles` reactively; only the final `addZone` loop and `buildZoneMap` need to wait for `Promise.allSettled`. Optionally, also `transferable.byteLength` can be tracked and used to throttle decoded-but-not-yet-transferred buffers.

### 48. `registerLevainDevice` silently no-ops the entire patch sync when `port` is missing

**Problem:** `helpers.ts:67-86` — only the outer `if (port)` branch (lines 69-85) ever executes any setup. If a caller invokes `registerLevainDevice(deviceId, device)` without a port, the device is added to `activeDevices` (line 68), but **no `activePorts` entry is set, no patch sync runs, and no sample load is triggered**. Subsequent `setLevainParamWithAudio` calls succeed (they only read `activeDevices`) but `loadSamplesForInstrument` fails silently (`activePorts.get(deviceId)` returns undefined → `helpers.ts:58-60` returns early).

The current call site (`wasmDeviceRegistry.ts:245-253`) always passes a port, so this is dormant — but the function signature `port?: MessagePort` advertises it as optional, and the test (`useCases/__tests__/levainParamBridge.spec.ts:26`) actually exercises the no-port path with `registerLevainDevice('levain-device-1', mockDevice, undefined)` and asserts only that `bridge` is defined. The contract is incoherent.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67-86`
- `src/modules/Levain/useCases/levainParamBridge/registerLevainDevice.ts:5-7`
- `src/modules/Levain/useCases/__tests__/levainParamBridge.spec.ts:26`

**Needed:** Either (a) make `port` a required parameter at the type level — the only real call site already passes it; or (b) split into two functions (`registerLevainDeviceWithPort`, `registerLevainDeviceLocal`) with different responsibilities, documented separately. The current optional signature is a footgun.

### 49. `setMacroWithAudio` 'Tightness' macro maps to `device.setParam('humanize', …)` but `setLevainParamWithAudio('humanize', { amount })` queues `humanize_amount` — the macro and the panel target different rust keys

**Problem:** `helpers.ts:161` for `'Tightness'` calls `device.setParam('humanize', 1.0 - value)`. But the panel's HumanizePanel writes `setLevainParamWithAudio(deviceId, 'humanize', { amount, …, })` which goes through `helpers.ts:117-133`, queueing `humanize_amount`, `humanize_timing_max_ms`, etc. (one rust key per nested leaf). **The macro pushes `humanize` (no suffix); the panel pushes `humanize_amount` (suffixed).**

If the worklet treats `humanize` and `humanize_amount` as different params (which is the natural reading — every other field has a `_<leaf>` suffix), then the Tightness macro is hitting a different DSP slot from the Humanize knob. Either the worklet aliases `humanize` to `humanize_amount` (undocumented), or one of these is dead. Same kind of bug as issue #9's `vibrato_depth` vs `expression_vibrato_depth_max`.

The Space macro at `:163-166` also writes `mic_0_volume`, `mic_1_volume` directly via `device.setParam`, which **does** match the per-mic update path (`sendMicParamToEngine` produces the same keys). So Space is consistent with itself but is also a duplicate of `MicBlendSlider` — two routes that target the same keys at the same time, which can interleave during macro automation.

`'Tone'`, `'Attack'`, `'Release'` (lines 167-175) target rust keys `tone`, `attack`, `release` that **do not exist anywhere else in the patch model**. There is no `LevainPatch.tone` field. So these macros write to engine-only state with no store mirror; user moves macro, engine responds, store stays untouched, and on persistence the value is lost.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:149-179`
- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:117-133` (panel write path)
- `src/modules/Levain/models/LevainPatch.ts:182-216` (no `tone`/`attack`/`release` field)

**Needed:** Define the macro-to-engine routing as a typed table that explicitly maps each macro slot to a single, documented rust key — the same key the panel uses where one exists. For `tone`/`attack`/`release` (engine-only DSP), add corresponding patch fields so the store and engine stay in sync; otherwise these macro positions are effectively volatile.

### 50. `LevainPanel` keeps **search** and **family** filter as `useState`, lost across mount/unmount and unsynchronised across multiple Levain panels

**Problem:** `LevainPanel.tsx:83-84` `useState('')`/`useState('All')`. If the user opens two Levain panels (different deviceIds), each has its own filter state. If they close and reopen the same panel (which happens on track-list rerenders, panel toggles, or HMR), the filter resets to defaults. There's no per-deviceId or per-user persistence; the user re-types their search every time.

This isn't catastrophic, but it surfaces a deeper structural gap: **none** of the panel-local UI state (search, family, presumably also which articulation tab is open in larger refactors) lives in `levainStore`. The store is patch-only. The view is responsible for view state, but isn't using a store for it — so it's truly ephemeral.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:83-84`

**Needed:** Either (a) accept that filters are session-local (document it), or (b) move them into a `levainViewStore` keyed by deviceId. Option (b) opens the door to per-device personalisation and to persistence across reload.

### 51. `MicBlendSlider` "compact" path mutates mic 0 and mic 2 even when there is no mic 2

**Problem:** `MicBlendSlider.tsx:91-93,101-110`. The compact knob's handler always writes mic 0 (`onUpdateMicPosition(0, …)`/`onSendMicParam(0, …)`), then conditionally writes mic 2. If `micPositions.length === 2` (e.g. the patch has only close + decca-tree), the knob still _displays_ a blend (`roomVol = 0.3` from the literal default at line 92, **not** from the patch — the actual patch has no mic 2 at all) and writes mic 0 unconditionally. The user moves a slider that says "Close/Room"; they get a Close volume change with no Room. That's not user error — the UI promises a feature the patch doesn't support.

`micPositions[2]?.volume ?? 0.3` (line 92) papers over the real check `micPositions.length > 2`. The two checks are inconsistent: `?? 0.3` falls back to a literal that has nothing to do with the patch state.

**Representative files:**

- `src/modules/Levain/presentations/components/MicBlendSlider.tsx:90-110`

**Needed:** If `micPositions.length <= 2`, hide or disable the compact knob. Or render a Close-only fader. Don't display a control that pretends to mix two mics when only one exists.

### 52. `loadPreset` use-case file (`useCases/loadPreset.ts`) does not expose a `loadPreset` function — only `loadInstrument`

**Problem:** `useCases/loadPreset.ts:15` exports `loadInstrument(deviceId, instrumentId)`. The file is named `loadPreset.ts`. Nothing called `loadPreset` is exported from this file. AGENTS.md "One Function Per File" + "the filename matches the exported function name" — when a file is named `loadPreset.ts`, the reader expects `export function loadPreset(...)`. Renaming the file to `loadInstrument.ts` is the easy fix; harder fix is wiring up the actual factory `loadPreset` from `repositories/levainPresets.ts:120-159` (currently dead code per issue #22) under that name.

**Representative files:**

- `src/modules/Levain/useCases/loadPreset.ts:15`
- `src/modules/Levain/repositories/levainPresets.ts:120-159` (orphan `loadPreset(presetId)` function)

**Needed:** Rename file to `loadInstrument.ts`, OR write a real `loadPreset(deviceId, presetId)` use case that calls `repositories/levainPresets.loadPreset(presetId)` and applies the resulting patch. Probably both.

### 53. `applyPatch` private helper in `useCases/loadPreset.ts` is the only place that actually writes the full patch — but it's private and `loadInstrument` is the only consumer

**Problem:** `useCases/loadPreset.ts:25-50` defines `applyPatch(deviceId, patch)`. It is the **only** function in the module that writes the full patch into the store. Nothing else can be used to load a patch from project storage, from a preset, from automation, or from AI scripting. AGENTS.md "Use cases are the cross-module surface". This is a use case dressed as a helper.

If a future feature needs to "load a patch from disk" (project file), there's no public API; the consumer would either re-import this file or duplicate the logic. Combined with issue #25 (no persistence story) the gap is structural: there is no function the persistence layer can call to rehydrate a `LevainState`.

**Representative files:**

- `src/modules/Levain/useCases/loadPreset.ts:25-50`

**Needed:** Promote `applyPatch` to a public use case (`useCases/applyLevainPatch.ts`) and re-export from `useCases/index.ts`. Have `loadInstrument` call it; have a future `loadPreset(deviceId, presetId)` call it; have project rehydration call it. One canonical writer.

### 54. `getDevice(deviceId)` helper in the bridge silently returns `undefined`; every call site repeats `if (!device) return`

**Problem:** `helpers.ts:50-52` `getDevice(deviceId): LevainDevice | undefined`. Used at `:139, :183, :190, :197`. Every call site has a near-identical guard `if (!device) { return; }`. Failures are silent — neither `logger.warn` nor a `notifyUser` fires when an engine call is attempted on a missing device. If the user has the panel open while the engine teardown happens (HMR, unmount race), all macro / knob movement is silently dropped.

This is a missed observability point: every "engine call dropped" is a real symptom that should be surfaced, at least at log level.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:50-52,139-141,183-186,189-193,196-200`

**Needed:** Either log dropped calls (`logger.warn('[LevainBridge] dropped <op> for unregistered device <id>')`) so the failure is visible, or guarantee the device is registered before any engine call (a per-device promise gate).

### 55. `wasmDeviceRegistry.ts` swallows `_unregisterLevainDevice` errors with `try { … } catch {}` — the empty-catch anti-pattern AGENTS.md prohibits

**Problem:** `wasmDeviceRegistry.ts:229-231`:

```ts
destroy: () => {
    result.destroy();
    try {
        _unregisterLevainDevice(deviceId);
    } catch {}
},
```

The empty catch swallows _any_ error. AGENTS.md "No silent catches" — and the user's CLAUDE.md memory bullet on "No fallback hacks" forbids exactly this pattern. A failure to unregister is invisible; the bridge keeps the deviceId in `activeDevices`/`activePorts`, leaks the rAF batches (issue #12), and the next register with the same id silently overwrites the entry without cleanup.

**Representative files:**

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:229-231`

**Needed:** Drop the try/catch. If `_unregisterLevainDevice` can throw, fix the throw site or wrap with `logger.error`. Out-of-Levain-module file but cited because it's the only consumer of `unregisterLevainDevice` and propagates the silent-failure pattern.

### 56. `loadSamplesForInstrument` in the bridge fires `setInstrument` _then_ kicks the load — but `setInstrument` is `?:` optional and silently ignored if missing

**Problem:** `helpers.ts:54-65`:

```ts
function loadSamplesForInstrument(deviceId: string, instrumentId: string): void {
    activeDevices.get(deviceId)?.setInstrument?.(instrumentId);
    const port = activePorts.get(deviceId);
    if (!port) return;
    deps.autoLoadLevainSamples(deviceId, port, instrumentId).catch((err) => …);
}
```

`LevainDevice.setInstrument` is optional (`helpers.ts:12`). The single call site (`wasmDeviceRegistry.ts:250`) does pass a `setInstrument` function, but if any future consumer omits it, the realism layer (body modes, sympathetic strings, breath/bow noise per the comment) **never reconfigures** when an instrument switches — and there's no warning or check.

The bigger smell: `setInstrument` is a side channel into the engine that bypasses the entire param bridge. The patch's `instrumentId` is the source of truth, but `setInstrument` is the only mechanism that propagates a change of `instrumentId` to the engine. There is no rust-key for instrument identity. A future test or refactor that renames `setInstrument` will silently lose realism reconfiguration.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:9-13,54-57`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:250`

**Needed:** Make `setInstrument` required (no `?:` in `LevainDevice`). Or formalise it as a rust-key (`instrument_id`) with a typed enum. Either way, document the contract that switching instruments is two-step: (a) rebuild zones via `loadInstrumentFromManifest`, (b) reconfigure realism via `setInstrument`.

### 57. Module-level `WEB_LOD` is the only LOD setting; there's no plan for "high-quality" or per-device LOD

**Problem:** `repositories/sampleLoader/helpers.ts:16-21` defines `WEB_LOD` as `maxMics: 2, maxVelLayers: 3, maxRoundRobins: 3`. `autoLoadSamples.ts:48` passes it unconditionally to `loadInstrumentFromManifest`. There is no:

- per-device override (Tauri desktop has GBs of memory and could afford more);
- per-instrument override (a 200MB violin and a 30MB triangle don't need the same LOD);
- runtime quality switch (the user can't trade memory for fidelity).

The `DEFAULT_LOD` exported from `loadInstrumentFromManifest.ts:49-54` (no caps) is also dead code.

The audit's previous review of issue #22 (factory presets are dead) is the same shape: configurable knobs that aren't wired to any UI.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/helpers.ts:16-21`
- `src/modules/Levain/useCases/autoLoadSamples.ts:48`
- `src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts:49-54`

**Needed:** Either (a) accept WEB_LOD is the only profile and delete `DEFAULT_LOD`; or (b) thread a `LevainLodProfile` through `autoLoadLevainSamples` (`'web' | 'desktop' | 'high-fidelity'`), with a UI toggle and a `levainStore` field for per-device LOD preference.

### 58. No teardown of pending sample-load progress on `unregisterLevainDevice`

**Problem:** `helpers.ts:88-101` `unregisterLevainDevice` deletes the device from `activeDevices`/`activePorts` and removes the `levainStore` entry — but if `autoLoadLevainSamples` is mid-flight when unregister runs, its `setSampleLoadProgress(deviceId, …)` calls (and the `setTimeout(…, 300)` at `autoLoadSamples.ts:56`) will fire **after** the device is gone. They re-create a `levainStore[deviceId]` entry with `defaultLevainState` (per `setSampleLoadProgress`'s `?? defaultLevainState` fallback at `levainStore.ts:74`), then set progress to a number, then 300ms later set it to `null`. The store is now dirty with a phantom device entry.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:88-101`
- `src/modules/Levain/useCases/autoLoadSamples.ts:45-56`
- `src/modules/Levain/stores/levainStore.ts:72-76`

**Needed:** Track an in-flight `AbortController` per deviceId (issue #6). On unregister, abort and clear the timeout. Or have `setSampleLoadProgress` no-op when the entry doesn't exist (don't fabricate from `defaultLevainState` — currently every store mutator does this fabrication; see issue #59).

### 59. **Every** `levainStore` mutator falls back to `defaultLevainState` when the entry is missing — so they all silently fabricate state for unknown devices

**Problem:** `levainStore.ts:62, :74, :80, :94, :114, :134` all share the pattern `const state = instances[deviceId] ?? defaultLevainState; levainStore.set({ ...instances, [deviceId]: { …state, …updates } })`. This means **calling any mutator with an unknown `deviceId` silently creates a new entry with default values plus the requested change**. There is no "unknown device" failure mode at the store level. Combined with issue #58, any in-flight async write after unregister leaks. Combined with #8, this masks the "device not yet registered" condition.

A defensive store would either log or throw on unknown deviceId; today the store is permissive and defers all consequences to whoever inspects the state later (the panel renders defaults; the engine does whatever).

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:60-130` (all six mutators share the pattern)

**Needed:** Decide ownership semantics: (a) store mutators **require** the entry to exist (no-op or throw if missing); a separate `initLevainState(deviceId, patch)` is the only creator. (b) Or document that any mutator may create an entry, and own the consequences explicitly. Today the choice is implicit and hides bugs (#8, #58).

### 60. `repositories/sampleLoader/` has no `__tests__/` directory at all — issue #42 understated the gap

**Problem:** Issue #42 noted that `loadInstrumentFromManifest` has no test. In fact `repositories/sampleLoader/` has no test directory whatsoever. Three files (`helpers.ts`, `loadInstrumentFromManifest.ts`, `loadSingleSample.ts`) — zero specs. The `OfflineAudioContext` decode pipeline, the LOD filter, the zone-id assignment, the transferable-buffer dance, the global serial queue — none have a single `expect`.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/` (no `__tests__/`)

**Needed:** Add specs for: (a) LOD filter (mic / RR / vel thresholds), (b) zone-id stability across partial failures, (c) transferable buffers detached after post (verify `byteLength === 0` after the postMessage), (d) `clearZones` ordering, (e) progress callback called once per successful fetch, not per zone, (f) the global queue's behaviour under concurrent calls.

### 61. `events/index.ts` is intentionally empty but the module has no replacement event surface — Levain emits no domain events

**Problem:** `events/index.ts` is `// no public events`. AGENTS.md mandates events as the cross-module surface; Levain has none. No `levain.patchLoaded`, `levain.sampleLoadStarted/Completed/Failed`, `levain.macroChanged`, `levain.articulationChanged`. So no other module can react to Levain state changes — e.g. the AI runtime can't observe articulation switches; the project save layer can't subscribe to "patch dirty"; the analytics layer can't count instrument loads.

Combined with issue #24 (no `handlers/`) and issue #25 (no undo), Levain is structurally a sealed module: input via the panel, output to the engine, nothing observable in between.

**Representative files:**

- `src/modules/Levain/events/index.ts:1`

**Needed:** Define at minimum: `levain.patchLoaded { deviceId, instrumentId }`, `levain.sampleLoadStarted/Completed { deviceId, instrumentId }`, `levain.sampleLoadFailed { deviceId, instrumentId, error }`. Emit from `loadInstrument`, `autoLoadLevainSamples`, and the manifest loader. Other modules subscribe via `eventBus.on(...)`.

### 62. `state.uiLevel: 1 | 2 | 3 | 4 | 5 | 6` is in the type but never read or written

**Problem:** `LevainState.uiLevel: LevainUiLevel` (`stores/levainStore.ts:25`), defaulted to `1` (`:36`). Not referenced in the panel, not written by any mutator. The `LevainUiLevel = 1 | 2 | 3 | 4 | 5 | 6` type (`:21`) is exported but unused. Dead state, like `activeVoices`/`peakL`/`peakR` (issue #46), but for a feature that was probably planned (compact / detailed / pro UI levels) and never built.

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:21,25,36`

**Needed:** Delete, or wire to a real UI control. Same prescription as issue #46.

### 63. Articulation list filters by `enabled: true` only at the UI; the patch can mark all articulations disabled and the user has no way to recover

**Problem:** `ArticulationList.tsx:27` `articulations.filter((a) => a.enabled)`. If a future patch (or a project save with corrupted state) sets all articulations to `enabled: false`, the panel renders an empty rail. There's no "All articulations are disabled — re-enable" recovery affordance. Also no `setArticulationEnabled(deviceId, type, enabled)` store mutator anywhere — `enabled` is set once at `createDefaultPatch` (always `true` for everything) and never user-mutable in the UI. So `enabled` is also dead unless the patch comes in pre-disabled from elsewhere (e.g. project file, AI patch).

**Representative files:**

- `src/modules/Levain/presentations/components/ArticulationList.tsx:27`
- `src/modules/Levain/models/LevainPatch.ts:96-101` (`ArticulationEntry.enabled`)

**Needed:** Either expose a UI for enabling/disabling articulations (the field exists for a reason), or remove `enabled` from the `ArticulationEntry` type. If kept, ensure the UI gracefully handles the all-disabled case.

### 64. `instrumentFamily` in the patch is read by panel readout (`LevainPanel.tsx:367`) but is **derived state** — `getInstrumentFamily(instrumentId)` already exists

**Problem:** `LevainPatch.instrumentFamily: InstrumentFamily` (`LevainPatch.ts:188`). `createDefaultPatch` writes it via `getInstrumentFamily(instrumentId)` at `:294`. There's no other writer, but `LevainPanel.tsx:367` reads it. The field duplicates state that's a pure function of `instrumentId`. If a buggy preset or project file writes `instrumentId: 'cello'` with `instrumentFamily: 'brass'`, the panel will render the inconsistent value forever; there's no validator. AGENTS.md "TypeScript — soundness: types must describe real data" — derived data should be either re-computed at read time or branded.

**Representative files:**

- `src/modules/Levain/models/LevainPatch.ts:188,294`
- `src/modules/Levain/presentations/views/LevainPanel.tsx:367`
- `src/modules/Levain/models/LevainPatch.ts:309-342` (`getInstrumentFamily`)

**Needed:** Either remove `instrumentFamily` from the patch and call `getInstrumentFamily(patch.instrumentId)` at read time (it's pure and local); or add an invariant `// invariant: instrumentFamily === getInstrumentFamily(instrumentId)` check at every patch load.

### 65. `defaultLevainState.patch.instrumentId` defaults to `'violin-1'` — so an unknown deviceId reading via `getLevainState` gets a violin patch

**Problem:** `stores/levainStore.ts:35,42,52` — `defaultLevainState.patch = createDefaultPatch('violin-1')`. `getLevainState(deviceId)` falls back to this default. Any cross-module consumer that reads `getLevainState('unknown-id').patch.instrumentId` will get `'violin-1'` — not a sentinel like `'unknown'` or `null`. This silent default is the same shape as the audit's previously-flagged "fabricate from defaults" anti-pattern (issue #59). It also makes `getLevainState` impossible to use defensively: there's no way to distinguish "device not registered" from "device registered with a violin patch".

**Representative files:**

- `src/modules/Levain/stores/levainStore.ts:34-43,51-53`

**Needed:** Make `getLevainState(deviceId): LevainState | undefined` and have callers handle the missing case explicitly. The current "always returns a default" behaviour is the wrong default for any consumer that wants to act conditionally on whether a device exists.

### 66. `LevainPanel.tsx` `instrumentId.replaceAll('-', ' ')` is a presentation-layer string transform that will silently break for any future instrument id with non-dash separators

**Problem:** `LevainPanel.tsx:164` `{instrument.id.replaceAll('-', ' ')}`. Used to render `"violin-1"` as `"violin 1"`. If a future `InstrumentId` is added without a dash (e.g. `'piano'`) or with another separator, the display silently shows the raw id. Display strings should not be derived from ids; the `INSTRUMENTS` array already has a `label` field for exactly this purpose. The `instrument.id.replaceAll('-', ' ')` line is rendered next to `{instrument.label}` (line 157), so the user sees the label twice — once formatted, once spaced — which is also redundant.

**Representative files:**

- `src/modules/Levain/presentations/views/LevainPanel.tsx:155-165`

**Needed:** Remove the `replaceAll` line; the `label` is sufficient. Or use a separate `InstrumentDescriptor.subtitle` field if a subtitle is desired.

---

## Open questions

- [ ] Does the worklet treat `vibrato_depth` and `expression_vibrato_depth_max` as the **same** parameter (with one being an alias), or are they two distinct DSP slots? Issue #9 needs the rust side checked.
- [ ] Does the worklet have `tone`, `attack`, `release` parameters at all? Issue #49 — the `Tone` / `Attack` / `Release` macros write to these keys but no patch field mirrors them.
- [ ] Does the worklet expect deterministic zone IDs from manifest order, or does it accept any IDs from the loader? Issue #7 — the current implementation drifts on partial failures.
- [ ] Why does `loadSamplesForInstrument` exist on `registerLevainDevice` if `levainStore[deviceId]` is empty at register time? Was the original design to populate state first (project hydration), and the hydration path was never built? Issue #8.
- [ ] Are factory presets in `repositories/levainPresets.ts` planned for a UI surface, or should they be deleted (issue #22)?
- [ ] Why does the panel write the store directly instead of going through `executeAppAction` — is there a constraint preventing AppAction integration today (issues #24, #28)?
- [ ] What is the project-save / load contract for Levain patches — is the per-rust-key `persistDeviceParam` flush sufficient for round-trip, or is full-patch serialisation needed (issue #25)?
- [ ] Is `loadSingleSample` used anywhere (no caller found in `src/`)? If not, delete (issue #43).
- [ ] Should macro labels be user-editable? If yes, the engine routing must decouple from labels (issue #17).
- [ ] Are `activeVoices` / `peakL` / `peakR` planned (i.e. waiting on a worklet telemetry channel) or should the panel widgets be removed (issue #46)?
- [ ] Is `LevainUiLevel` a designed-but-never-built feature (issue #62)?
- [ ] Is `ArticulationEntry.enabled` ever set to `false` by anything (issue #63)?
- [ ] Was `loadPreset.ts` (the file) supposed to export `loadPreset` (the function), or was it renamed without renaming the file (issue #52)?

---

## Risks

- **Initial sample load doesn't happen on a fresh device.** Issue #8 (revised). `registerLevainDevice` requires a `levainStore[deviceId]` entry that nothing initialises before it runs. Users see the WASM fallback (sine tone) until they manually pick an instrument. This is the most user-visible correctness defect in the module.
- **Patch / engine divergence on first load and on string/array fields.** Issues #9, #10, #41, #49: rust-key mismatches between register-time push and runtime push (e.g. `vibrato_depth` vs `expression_vibrato_depth_max`); `cc1Curve` (string) is never sent; `tone`/`attack`/`release` macros write engine-only state with no store mirror.
- **Audio drift after fast instrument switching.** Issues #5, #6, #7, #47: a stream of `clearZones`/`addSample`/`addZone`/`buildZoneMap` interleaves under concurrent loads; the global decode queue serialises across all of it; `Promise.allSettled` holds all decoded buffers in memory simultaneously (peak hundreds of MB).
- **Silent sample-load failures.** Issue #19: progress flips to "Ready" on error; the user has no signal the engine is silent. Combined with issues #7 / #58 (stale zone-id reuse, store-leak after async), the failure mode is "instrument plays the wrong samples or nothing".
- **Telemetry dishonesty.** Issue #46: the panel always shows "0 voices" because nothing writes `activeVoices`. Users can't tell if Levain is alive.
- **No undo / no automation / no AI scripting / no observability.** Issues #24, #25, #28, #61: every Levain interaction is panel-only. The AI runtime cannot script Levain; `Command` cannot replay; the project file holds only a leaf-level slice of state; no other module can react via `eventBus`.
- **Permissive store mutators hide race-condition bugs.** Issue #59: every mutator falls back to `defaultLevainState` on missing entry, so unregister-then-async-callback or out-of-order writes silently fabricate phantom entries.
- **Bridge testability is theatre.** Issues #2, #26, #44: the DI seam works (contrary to the previous reviewer) but the test suite is **two** smoke specs plus eight pass-through smoke specs. Behaviour coverage of the riskiest file is zero; the previous reviewer's claim that DI was unfixable was a smokescreen for "nobody wrote the tests".
- **Cross-module contract gap.** Issue #1: no root barrel means consumers deep-import; any subsequent rename inside `Levain/presentations/`, `stores/`, or `useCases/` breaks downstream silently.
- **UX dishonesty in macros.** Issues #17, #18, #49: macro routing keys on user-facing labels; "Space" macro and "Space" knob disagree on mic indices; "Tightness" macro writes a different rust key from the Humanize knob. Two paths that look identical produce different DSP behaviour.
- **Empty catches and silent drops.** Issues #54, #55: `try { _unregisterLevainDevice(deviceId); } catch {}` and `getDevice(...) ?? return` everywhere — every failure is invisible.

---

## Suggested approaches

- **Fix the bootstrap order before anything else** (issues #8, #59, #65). Define `initLevainDevice(deviceId, instrumentId)` that creates a `levainStore` entry **before** `registerLevainDevice` runs. The wasmDeviceRegistry path must call it on `placeholder` creation (not after worklet ready). Then the existing `registerLevainDevice` patch-sync block stops being dead code. Drop the `?? defaultLevainState` fabrication from every mutator; force the contract that the entry must exist.
- **Define `PATCH_TO_ENGINE: Record<PatchLeafPath, string>` once, route both register-time and runtime push through it** (issues #9, #10, #11, #49). Eliminate `camelToSnake` inference and the `Object.entries` recursion. Add a regression test asserting register and runtime push the same rust key for the same field. Add explicit dispatch for string-encoded enums (`cc1Curve`).
- **Wire telemetry from the worklet** (issue #46). Mirror the Fermenter / Bacteria / Grinder pattern: `result.onTelemetry((data) => updateLevainTelemetry(deviceId, data))`. Without this, "0 voices" is permanent.
- **Fix the load pipeline as a single coherent change** (issues #5, #6, #7, #19, #47, #58). Per-load `AbortSignal` plumbed through `autoLoadLevainSamples` → `loadInstrumentFromManifest` → `fetchAndDecode`. Stream `addSample` posts as decodes complete. Pre-assign deterministic zone IDs from manifest order. `sampleLoadError` field on `LevainState`; surface via `notifyUser`.
- **Refactor `createLevainBridge` into proper layers** (issue #3). Move I/O (`device.setParam`, port messages) to `repositories/`, in-memory registry to `stores/`, and split the use cases into thin orchestrators. Once split, the eight pass-through files (issue #4) absorb real responsibilities.
- **Replace the test theatre** (issues #2, #26, #27, #44). Drop the inner `getLevainBridgeSingleton` wrapper. Replace all 9 namespace-import smoke tests with a single behaviour suite per file: register/unregister with port, full-patch sync on register (and assert rust-key parity with runtime push), queue/flush via fake rAF, mic / macro routing, dropped-string regression.
- **Land the module barrel, `handlers/` AppAction surface, and an event surface** (issues #1, #23, #24, #25, #28, #61). The panel writes through `executeAppAction`; project save subscribes to `levain.patchLoaded`; the AI runtime can script Levain via `getLevainHandlers`.
- **Macro routing as a typed table** (issues #17, #18, #49). `MACRO_ROUTING: Record<MacroFunction, (deviceId, value) => void>` keyed on a stable `MacroFunction` enum, not user labels. Add patch fields for `tone` / `attack` / `release` if the engine treats them as parameters, or remove those macros if they're not really there.
- **UI/UX consistency pass** (issues #14, #15, #16, #17, #18, #29, #33, #34, #35, #36, #39, #51, #66). Equal-power crossfade for mic blend; DPR-aware canvases (or SVG); single source of `defaultLevainState`; `aria-pressed` / `aria-current` / `aria-live` on the panel; keyed-by-id list rendering; hide the compact mic-blend knob when fewer than 3 mics; remove redundant id-replaceAll subtitle.
- **Sweep dead code and AGENTS.md violations** (issues #22, #32, #37, #43, #46, #52, #55, #57, #62, #63, #66). Most are mechanical: rename, remove, fix empty catch, single-object params.

---

## Recommendation

Start with **issue #8 (revised) + issue #59 + issue #65** as a single PR. The bootstrap order is wrong, the store mutators silently fabricate state, and `getLevainState` lies on missing devices — these three together produce the "fresh device plays a sine tone" symptom. Fixing one without the others just shifts the failure mode. The fix is mechanical: define `initLevainDevice`, call it before register, and tighten every mutator to require the entry.

Then **issue #9 + issue #11 + issue #49** as a follow-up: define the `PATCH_TO_ENGINE` table and route both paths through it. Add a parity test (the same patch field produces the same rust key from both register and runtime push). This is the second-highest correctness issue (silent param drift), and the previous reviewer's framing ("never-pushed fields") missed the mismatched-key dimension.

Then **issues #5, #6, #7, #19, #47, #58 (load pipeline)** as a single coherent change — these are the most user-visible bugs that share the same plumbing (AbortSignal, deterministic zone IDs, surfaced errors, streamed addSample, store cleanup on unregister).

The previous reviewer's headline (issue #2: bridge DI seam unfixable) was **false**. The DI works. The real test problem is that nobody wrote behaviour specs — issue #26 (revised) + issue #44 cover that, and they're a separate architectural cleanup that can land in parallel.

Architecture work (issues #1, #3, #4, #23, #24, #25, #28, #61) is independent and can run after the load and parameter-sync correctness fixes are in.

---

## Resolved

_No issues resolved yet._
