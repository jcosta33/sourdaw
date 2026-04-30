# Levain module audit

## Scope

This audit covers `src/modules/Levain/` in full — `events/`, `models/`, `presentations/components/`, `presentations/views/`, `repositories/sampleLoader/`, `repositories/levainPresets.ts`, `stores/`, and the `useCases/` (including `levainParamBridge/` and `autoLoadSamples`, `loadPreset`). It excludes the upstream worklet (`#/modules/AudioEngine`) and consumers under `Arrangement` except where they are imported from this module. Tests under `__tests__/` are reviewed for coverage quality, not in isolation.

It is an adversarial review: races, unhandled errors, hidden global state, type-soundness escapes, AGENTS.md violations, audio-thread / sample-loading hazards, and UX gaps.

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

---

## Priorities

1. **Sample-load concurrency / cancellation** (issues #5, #6, #7, #8, #19) — switching instruments while a load is in flight mixes zone maps in the worklet and silently swallows errors.
2. **Bridge architecture: god-object, unreachable DI, and zero behavioural test coverage** (issues #2, #3, #4, #26, #27) — `createLevainBridge` mixes orchestration / state / I/O, and the only test for it is a smoke test.
3. **Parameter sync gaps: never-pushed expression/legato/humanize fields, dropped strings, dropped nested objects** (issues #9, #10, #11) — patch state and engine state diverge on first load and on string/array fields forever.
4. **Missing module barrel + missing `handlers/` / `executeAppAction` integration** (issues #1, #23, #24, #25) — Levain is unscriptable from outside the panel; no undo/redo; no automation surface.
5. **Direct store writes from the panel + redeclared `defaultLevainState`** (issues #16, #28) — view layer is coupled to store internals; default fallback can drift.
6. **UX/accessibility on the panel and components** (issues #14, #17, #18, #29, #30, #31, #33, #34, #35, #36) — macro routing, mic blend math, key collisions, ARIA labels.
7. **Type-soundness escapes** (issues #20, #30, #40) — `as unknown as` and silent clamping mask real bugs.
8. **Dead code: factory presets, `loadSingleSample`, never-edited `vibratoRateMin`** (issues #22, #32, #43) — sweep or wire up.
9. **AGENTS.md violations: positional params, namespace import, missing barrel** (issues #1, #37, #44) — mechanical follow-up sweep.

---

## Open issues

### 1. Module has no root `index.ts` barrel

**Problem:** `src/modules/Levain/` has no `index.ts`. Every cross-module consumer deep-imports paths under `presentations/views/`, `stores/`, or `useCases/`. AGENTS.md "Cross-module imports MUST only target the destination module's root `index.ts`" — Levain cannot be consumed within its contract. There is no curated public surface; what counts as "public" is whatever a consumer happens to deep-import.

**Representative files:**

- `src/modules/Levain/` (no `index.ts`)
- `src/modules/Levain/stores/index.ts` (partial barrel, three names only)
- `src/modules/Levain/useCases/index.ts` (three names only — see issue #23)

**Needed:** Create `src/modules/Levain/index.ts` re-exporting `LevainPanel` from `presentations/views`, the store handles intended for cross-module use (likely `levainStore` and `LevainState` as a type), and the use cases needed externally (`registerLevainDevice`, `unregisterLevainDevice`, `autoLoadLevainSamples`, plus any `setLevainParamWithAudio` family if scriptability matters). Audit current consumers (`grep -r "from '#/modules/Levain"`) and rewrite them through the barrel.

### 2. `levainBridge` `inject(...)` indirection is non-overridable in tests

**Problem:** `inject(levainBridgeDependencies)((deps) => { const bridge = createLevainBridge(deps); return function getLevainBridgeSingleton(): LevainBridgeApi { return bridge; }; })` evaluates `createLevainBridge(deps)` once at module load and closes over the result. Subsequent `injectDependencies(levainBridge, ...)` calls — which the JSDoc claims are the test seam — change the outer factory's arg, but the inner closure has already captured the old bridge. The "DI" surface is therefore decorative.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts:11-16`
- `src/modules/Levain/useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9` (cannot meaningfully exercise the bridge as-is)

**Needed:** Either (a) move `createLevainBridge(deps)` inside the inner getter so each `getLevainBridgeSingleton()` call resolves dependencies fresh (cache the result keyed on identity if you want a singleton), or (b) drop `inject` and pass `deps` directly, exposing a factory the consumer calls once. Update the JSDoc to match reality.

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

### 5. Decode pipeline: shared `OfflineAudioContext` + ever-chaining `decodeQueue`, no abort

**Problem:** `repositories/sampleLoader/helpers.ts:33-43,45-82` keeps `decodeCtx` and `decodeQueue` at module scope. The queue serialises decodes globally (across all instruments / devices / loads), which is overzealous (it was intended for Safari's `EncodingError` on concurrent decodes, but it now bottlenecks the entire app). There is no abort / cancellation: a stale load cannot be killed mid-flight; its decodes simply complete and post stale messages to the worklet.

**Representative files:**

- `src/modules/Levain/repositories/sampleLoader/helpers.ts:33-82`

**Needed:** Replace the global queue with a per-instrument-load `AbortSignal` plumbed from `loadInstrumentFromManifest` (and from `autoLoadLevainSamples`). For Safari concurrency, batch decodes per-load with a small concurrency cap (e.g. 2) instead of globally serialising. `OfflineAudioContext` should be local to each `fetchAndDecode` (or pooled per-load) so a `close()` can release resources after the load.

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

### 8. Race: `registerLevainDevice` synchronously triggers a load that resets the device's store entry

**Problem:** `registerLevainDevice` in `helpers.ts:67` synchronously calls `loadSamplesForInstrument`, which calls `autoLoadLevainSamples`, which immediately calls `setSampleLoadProgress(deviceId, 0.01)`. `setSampleLoadProgress` falls back to `defaultLevainState` if the entry is missing — replacing any pre-existing state for that device with a fresh default plus progress=0.01.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67-86`
- `src/modules/Levain/useCases/autoLoadSamples.ts:45`
- `src/modules/Levain/stores/levainStore.ts:72-76`

**Needed:** Either (a) make state mutators no-op when the entry doesn't exist (don't fabricate from defaults), or (b) ensure `levainStore` has an entry for `deviceId` before the bridge calls into the load path. The bridge should also not _force_ a sample reload on every register — register/unregister cycles can happen on HMR, panel mount/unmount, etc., and each one currently kicks a fresh decode pipeline.

### 9. `registerLevainDevice` only pushes 4 + N_mics params; the rest of the patch is silently divergent until first edit

**Problem:** `helpers.ts:73-83` queues `master_gain`, `legato_enabled`, `humanize_amount`, `vibrato_depth`, plus per-mic `mic_{i}_{volume,pan,enabled}`. Everything else in the patch (`expression.dynamicCrossfadeTime`, `expression.cc1Curve`, `expression.vibratoRateMin/Max`, `expression.vibratoOnsetDelay`, all of `legato.*` except `enabled`, all of `humanize.*` except `amount`, all `releaseTriggers.*`, `currentArticulation`, every macro and macro label) defaults to whatever the worklet's Rust side initialised — the patch and engine drift on first load.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/helpers.ts:67-86`

**Needed:** On register, iterate the entire patch and queue every leaf (numbers, booleans, articulation index, macros). Add a test that asserts `Set<rustKey>` = the full patch leaves. Or formalise a single `applyPatchToEngine` use case that `loadPreset` and `registerLevainDevice` both call.

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

### 26. `levainBridge.spec.ts` is a placeholder

**Problem:** `useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9` is `import * as subject from '../levainBridge'; expect(subject).toBeDefined();`. The bridge — the highest-risk file — has zero behavioural coverage. Combined with issue #2 (DI is non-overridable), there's no path to test it without rewriting the indirection.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/__tests__/levainBridge.spec.ts:1-9`

**Needed:** After fixing issue #2 (real DI seam), add a behaviour suite: register / unregister, queue+flush per rAF, full-patch sync on register, articulation index push, mic param routing, macro routing, dropped-string regression test (issue #10).

### 27. Test seam claimed by `levainBridge` JSDoc doesn't actually work

**Problem:** `levainBridge.ts:8-10` JSDoc claims `injectDependencies(levainBridge, …)` is the test seam. As above (issue #2), the eager closure capture means it doesn't.

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/levainBridge.ts:8-16`

**Needed:** Coupled to issue #2 — once the inner getter calls `createLevainBridge(deps)` per-call, `injectDependencies` will work as advertised. Update JSDoc only after the behaviour matches.

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

### 44. Namespace import in `levainBridge.spec.ts`

**Problem:** `useCases/levainParamBridge/__tests__/levainBridge.spec.ts:3` `import * as subject from '../levainBridge';`. AGENTS.md "Imports: Never use namespace imports".

**Representative files:**

- `src/modules/Levain/useCases/levainParamBridge/__tests__/levainBridge.spec.ts:3`

**Needed:** Replace with `import { levainBridge } from '../levainBridge'` and assert behaviour (issue #26).

### 45. `stores/index.ts` partial barrel masks the actual public store surface

**Problem:** `stores/index.ts:1` exports only `defaultLevainState`, `levainStore`, `setEngineReady`. Other mutators (`setLevainParam`, `setSampleLoadProgress`, `setCurrentArticulation`, `setMacro`, `updateMicPosition`, `getLevainState`) are reachable only by deep file imports — yet they are intended for module-internal use. The barrel implies "these three are public" and "the rest are private", but consumers happily reach in for the private ones.

**Representative files:**

- `src/modules/Levain/stores/index.ts`
- `src/modules/Levain/presentations/views/LevainPanel.tsx:15`
- `src/modules/Levain/useCases/loadPreset.ts:7-8`

**Needed:** Decide what's intra-module-private vs cross-module-public. Per AGENTS.md, store mutators should not be cross-module surfaces — they should be reachable only via use cases or handlers. Tighten the barrel and route all writes through use cases.

---

## Open questions

- [ ] Is the `inject(...)` indirection on `levainBridge` intentional as DI, or is it a vestige? If intentional, what is the test seam expected to look like (issue #2)?
- [ ] Are factory presets in `repositories/levainPresets.ts` planned for a UI surface, or should they be deleted (issue #22)?
- [ ] Why does the panel write the store directly instead of going through `executeAppAction` — is there a constraint preventing AppAction integration today (issue #24, #28)?
- [ ] What is the project-save / load contract for Levain patches — is the per-rust-key `persistDeviceParam` flush sufficient for round-trip, or is full-patch serialisation needed (issue #25)?
- [ ] Does the worklet expect deterministic zone IDs derived from manifest order, or does it accept arbitrary IDs from the loader? The current implementation drifts on partial failures (issue #7).
- [ ] Is `loadSingleSample` used anywhere (no caller found in `src/`)? If not, delete (issue #43).
- [ ] Should macro labels be user-editable? If yes, the engine routing must decouple from labels (issue #17).

---

## Risks

- **Audio drift after fast instrument switching.** Issues #5, #6, #7: the user clicks five instruments in rapid succession, the worklet ends up in a half-mixed state with stale samples and zone IDs from earlier loads. Voice playback for long sustains held across the switch can hit the wrong sample.
- **Patch / engine divergence.** Issues #9, #10, #41: on first load the patch and engine state are inconsistent; string fields (curve type) and array fields (articulations, macro labels) never sync; articulation type / index drift silently. Users hear the engine's defaults under the patch UI.
- **Silent sample-load failures.** Issue #19: progress flips to "Ready" on error; the user has no signal that the engine is silent. Combined with issue #7's stale zone-id reuse, the failure mode is "instrument plays the wrong samples or nothing".
- **No undo / no automation / no AI scripting.** Issues #24, #25, #28: every Levain interaction is panel-only. The AI runtime cannot script Levain; Command cannot replay; the project file holds only a leaf-level slice of state.
- **Bridge testability.** Issues #2, #26: the riskiest file in the module has no real test seam and a smoke-only spec; refactors will land without behavioural coverage.
- **Cross-module contract gap.** Issue #1: no root barrel means consumers deep-import; any subsequent rename inside `Levain/presentations/`, `stores/`, or `useCases/` breaks downstream silently.
- **UX dishonesty in macros.** Issue #17, #18: macro routing keys on user-facing labels and disagrees with the slider on which mics map to "Space" — users get inconsistent results from two paths that look like they do the same thing.

---

## Suggested approaches

- **Land the module barrel and an `AppAction` surface first** (issues #1, #23, #24, #25, #28). Once the panel writes through `executeAppAction`, the rest of the architecture can be refactored without breaking the UI. Add `handlers/` with `createHandler` per action.
- **Fix the load pipeline** (issues #5, #6, #7, #8, #19) as a single coherent change: AbortSignal plumbing through `autoLoadLevainSamples` → `loadInstrumentFromManifest` → `fetchAndDecode`; deterministic zone IDs; surfaced errors via `notifyUser` + a `sampleLoadError` store field; mutators that don't fabricate from defaults.
- **Refactor `createLevainBridge` into proper layers** (issue #3). Move I/O (`device.setParam`, port messages) to `repositories/`, in-memory registry to `stores/`, and split the use cases into thin orchestrators. Once split, the eight pass-through files (issue #4) can absorb real responsibilities.
- **Make the bridge testable** (issues #2, #26, #27). Either restructure `inject` to resolve per-call, or remove `inject` and accept deps directly. Then add behaviour suites: register/unregister, full-patch sync, queue/flush, mic / macro routing, dropped-string regression.
- **Patch domain hygiene** (issues #10, #11, #30, #31, #38, #40, #41). Define an explicit `PATCH_TO_ENGINE` mapping (no `camelToSnake` inference), validate at model boundaries (no inline clamping), brand units (cents, ms, beats) in the type, and unify store + engine writes under single use cases.
- **UI/UX consistency pass** (issues #14, #15, #16, #17, #18, #29, #33, #34, #35, #36, #39). Equal-power crossfade for mic blend; DPR-aware canvases (or SVG); single source of `defaultLevainState`; `aria-pressed` / `aria-current` / `aria-live` on the panel; keyed-by-id list rendering.
- **Sweep AGENTS.md violations** (issues #37, #44) as a final pass.

---

## Recommendation

Start with **issue #2 (bridge DI seam)** + **issue #26 (write a real bridge spec)** together. The bridge is the riskiest file in the module and is currently untested; fixing the DI is mechanical and unblocks all subsequent test-driven refactors. Land them in one PR.

Then tackle **issue #6 (sample-load cancellation)** + **issue #7 (deterministic zone IDs)** + **issue #19 (surfaced load errors)** as a single coherent change — these are the most user-visible correctness bugs and they share the same plumbing.

Architecture work (issues #1, #3, #4, #23, #24, #25, #28) is independent and can run in parallel after the bridge is testable.

---

## Resolved

_No issues resolved yet._
