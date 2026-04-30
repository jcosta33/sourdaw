# Proof module audit

## Scope

This audit covers `src/modules/Proof/` in full — the mastering-suite plugin
module: `events/`, `models/`, `stores/`, `useCases/proofParamBridge/`,
`useCases/proofPresets.ts`, `presentations/views/ProofPanel.tsx`,
`presentations/hooks/useProofAnalyser.ts`, all `presentations/components/*`,
and every `__tests__` file. It explicitly excludes the WASM/AudioWorklet
implementation in `#/modules/AudioEngine/engine/ProofNode.ts` and the
`wasmDeviceRegistry` integration that wires it up — those are AudioEngine's
problem; we only inspect the contract Proof exposes to them.

It is an adversarial review: bugs, race conditions, type-soundness escapes,
React anti-patterns, performance, UX/a11y, and AGENTS.md violations.

Related spec: none on disk.

---

## Goal

A correctness-first, contract-clean mastering-suite module:

- Exactly one canonical public surface — a root `index.ts` re-exporting the
  cross-module API (`stores/`, `useCases/`, `presentations/views/`,
  `events/`). External consumers import only from the module root.
- Patch state and meter state live in a single keyed-by-deviceId store; all
  mutators are O(1) deltas, not full rebuilds of the instance map. UI code
  never mutates the store directly.
- The "audio bridge" (the per-device `setParam`/`reorderModules`/
  `resetIntegrated` callback object) is owned and tested in one place; UI
  callers never reference `bridges` directly.
- Every preset / target change goes through a single use case that updates
  the patch and forwards to the engine atomically. No drift between UI
  state and engine state.
- Tests assert contract: parameter forwarding, store mutations, drag/
  reorder behaviour, off-by-one and wraparound conditions. No "should
  export X" or "renders without crashing" stubs.
- AGENTS.md hard rules: no `as any` / `as never` / `as unknown as`, no
  `useMemo` / `useCallback` / `forwardRef`, no namespace imports, no
  cross-module imports of internals, one function per `useCases/` file,
  multi-arg functions take a single object parameter, controls have
  accessible names.

---

## Relevant code paths

- `src/modules/Proof/` (no root `index.ts` — see issue #1)
- `src/modules/Proof/events/index.ts` (placeholder — "no public events")
- `src/modules/Proof/models/ProofPatch.ts`
- `src/modules/Proof/stores/index.ts`
- `src/modules/Proof/stores/proofStore.ts`
- `src/modules/Proof/useCases/index.ts`
- `src/modules/Proof/useCases/proofParamBridge/helpers.ts`
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts`
- `src/modules/Proof/useCases/proofParamBridge/registerProofDevice.ts`
- `src/modules/Proof/useCases/proofParamBridge/unregisterProofDevice.ts`
- `src/modules/Proof/useCases/proofParamBridge/setProofParam.ts`
- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts`
- `src/modules/Proof/useCases/proofParamBridge/reorderChain.ts`
- `src/modules/Proof/useCases/proofParamBridge/resetIntegratedMeters.ts`
- `src/modules/Proof/useCases/proofPresets.ts`
- `src/modules/Proof/presentations/views/ProofPanel.tsx`
- `src/modules/Proof/presentations/views/index.ts`
- `src/modules/Proof/presentations/hooks/useProofAnalyser.ts`
- `src/modules/Proof/presentations/components/{ProofEqCurve,ProofEqSection,ProofDynSection,ProofImagerSection,ProofExciterSection,ProofLimiterSection,LoudnessHistory,TonalBalance}.tsx`
- `src/modules/Proof/**/__tests__/*` (15 spec files)

External cross-module call sites (for context):

- `src/modules/Workspace/presentations/views/AppShell.tsx:62` —
  `import { ProofPanel } from '#/modules/Proof/presentations/views'`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:19-20` —
  `updateProofMeters` from `#/modules/Proof/stores`,
  `registerProofDevice`/`unregisterProofDevice`/`syncFullPatch` from
  `#/modules/Proof/useCases`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:12`
  — `proofStore` from `#/modules/Proof/stores`

---

## Current behavior

**Patch model.** `models/ProofPatch.ts` defines `ProofPatch` (8-band EQ,
4-band multiband dynamics with 3 crossovers, 4-band imager, 4-band
exciter, lookahead limiter, dither, target). `DEFAULT_PATCH` and
`TARGET_LUFS` are exported alongside.

**Per-device store.** `stores/proofStore.ts` holds a `Record<string,
ProofState>` keyed by `deviceId`. `ProofState` carries `{ patch, uiLevel
1..5, meters..., abBypass }`. Mutators (`setProofUiLevel`,
`updateProofPatch`, `loadProofPatch`, `updateProofMeters`) all rebuild
the entire instances map and the affected device entry on every call.

**Bridge registry (`helpers.ts`).** A module-level
`bridges = new Map<string, ProofAudioBridge>()` holds the
WASM-worklet callbacks (`setParam`, `reorderModules`, `resetIntegrated`).
`registerProofDevice` writes; `unregisterProofDevice` deletes. Every other
use case in `proofParamBridge/` reads `bridges.get(deviceId)?.…` directly.

**Use cases.** The `useCases/index.ts` re-exports only three of the eight
files: `registerProofDevice`, `unregisterProofDevice`, and `syncFullPatch`
(aliased from `loadProofPatchWithAudio.ts`). The other five
(`setProofParam`, `setProofParamWithPatch`, `loadProofPatchWithAudio`,
`reorderChain`, `resetIntegratedMeters`) are **not** in the barrel —
`ProofPanel.tsx` reaches them via deep relative imports.

**Presentation.** `ProofPanel.tsx` is a single ~1000-line file with five
inline level components (`Level1Play` … `Level5Lab`), two helpers
(`MiniMeter`, `KnobColumn`), and a `MeterCard`. Five section components
(`ProofEqSection`, `ProofDynSection`, `ProofImagerSection`,
`ProofExciterSection`, `ProofLimiterSection`) live separately. Two canvas
visualisations (`LoudnessHistory`, `TonalBalance`) plus the EQ canvas
(`ProofEqCurve`) round out the surface. `useProofAnalyser` creates a
4096-FFT analyser tap.

**Tests.** Every file has at least one spec. Eight of the nine
`useCases/proofParamBridge/__tests__` specs are **identity-only**:
they `import * as subject` and assert the named export is defined. Five
of the eight component specs assert "renders without crashing" or "has
the section title". `ProofPanel.spec.tsx` renders `<ProofPanel />` with
no `deviceId` prop despite `deviceId` being required by the component
signature.

---

## Findings

1. **Module has no root `index.ts`.** Every other audited module exposes a
   curated cross-module surface via `src/modules/<Name>/index.ts`. Proof
   does not. External consumers therefore reach in through
   `#/modules/Proof/stores`, `#/modules/Proof/useCases`, and
   `#/modules/Proof/presentations/views` — i.e. they import the bare
   directories, which works because TypeScript resolves `index.ts`
   children, but it leaves no single barrel to audit and no place to
   restrict what leaks. When the AGENTS.md "Barrel files" rule says "each
   module's root `index.ts` is the sole cross-module public surface", the
   guarantee here is that there isn't one.

2. **The `bridges` registry is a module-level mutable singleton with no
   isolation.** `useCases/proofParamBridge/helpers.ts:7` exports a live
   `Map`. Every use case in the directory imports it as a top-level
   binding, so:
    - The map persists across HMR (every reload re-`set`s the entries —
      good for survivability, bad for tests that fail to clear it).
    - Registering the same `deviceId` twice silently overwrites the
      first bridge with no warning.
    - There is no `clearAllBridges()` for tests; the `proofParamBridge.spec.ts`
      tests pass only because every test calls `setProofParam('device-1',
      ...)` which lands in `persistDeviceParam` (mocked) rather than the
      bridge (a real but absent device-1 bridge — `bridges.get('device-1')`
      returns `undefined` and the optional-chain is silently a no-op,
      see issue #19).

3. **`useCases/index.ts` does not re-export five of its eight use cases.**
   Only `registerProofDevice`, `unregisterProofDevice`, and `syncFullPatch`
   (aliased) are in the barrel (`useCases/index.ts:1-3`). The other five
   (`setProofParam`, `setProofParamWithPatch`, `reorderChain`,
   `resetIntegratedMeters`, `loadProofPatchWithAudio`) are reached only
   via deep relative imports from `ProofPanel.tsx:17-21`. AGENTS.md
   "**Cross-module — same module — relative imports**" allows that for
   intra-module use, but the barrel asymmetry is intentional: those use
   cases are effectively private. That contradicts their name (`useCases`
   = public per AGENTS.md "Barrel files"). They should either be promoted
   to the barrel or moved into the presentation layer as helpers.

4. **`updateProofMeters` rebuilds the entire instances map at the audio
   meter rate.** `stores/proofStore.ts:92-112` is invoked from
   `wasmDeviceRegistry.ts:516` on **every meter callback** from the
   WASM worklet (typically ~30–60 Hz). Each call:
    - Spreads `instances` (a fresh object).
    - Spreads the device's previous `state` (a fresh object).
    - Rewrites every meter field including `dynGr` and `tapPeaks` (the
      latter is an **array of objects**, copied by reference — so the
      next render still sees a "new" `tapPeaks` reference even when the
      contents have not changed structurally).
    - Calls `proofStore.set(...)` which calls `notify()` which fires
      every subscriber and React listener.
   Every `<ProofPanel>` instance re-renders at meter rate; every section
   that depends on `state` (i.e. all of them) re-rasterises its canvas
   on every meter tick because the canvas `useEffect` deps include
   `patch` and the patch reference is stable but the canvases also
   depend on per-meter values (`limiterGrDb`, `truePeakDb`, `dynGr`).
   No throttling, no per-field selector — the entire UI repaints at
   meter rate. **This is the dominant performance issue in the module.**

5. **`updateProofMeters` does not capture the `abBypass` field.** Lines
   95-110 spread `state` then write meter fields, omitting `abBypass`.
   This is correct as written (spread keeps `abBypass`), but the
   imperative shape — "spread the old state and overwrite specific
   fields" — means a future refactor that adds a UI-only field will
   silently get lost. There is no test that exercises both an
   `abBypass=true` set and an `updateProofMeters` round-trip.

6. **`proofStore.set` from inside the React render path.** `ProofPanel.tsx:357`
   reads `proofStore.value`, computes a new map, and calls
   `proofStore.set(...)` directly inside a `<DawPluginChip onClick={...}>`
   handler — bypassing every use case in `proofParamBridge/`. This is
   architectural drift: the rest of the surface uses
   `setProofParamWithPatch` for patch fields, but the A/B-bypass toggle
   reaches around the use-case layer to mutate the store. There is also
   no `setProofAbBypass` use case and no patch field for it (it's a
   `ProofState`-only flag, not a `ProofPatch` flag), so the chosen
   solution is "monkey-patch the store from the view." Worse, the
   handler (a) calls `setProofParam(deviceId, 'ab_bypass', next ? 1 : 0)`
   which both forwards to the engine **and** writes through
   `persistDeviceParam` — but the engine doesn't actually have an
   `ab_bypass` parameter in `ProofMeterData`/`ProofNode`'s contract;
   the value just disappears into `bridges.get(deviceId)?.setParam`
   silently. (b) Then it manually flips `state.abBypass` in the store.
   So `ab_bypass` is persisted to `Track.devices[*].parameterValues.ab_bypass`
   on every toggle but never applied on engine load (no consumer reads
   it on `syncFullPatch`).

7. **`getProofState` returns a fresh object on every call when the
   instance is missing.** `stores/proofStore.ts:70-72` returns
   `{ ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } }` when
   `proofStore.value?.[deviceId]` is undefined. `ProofPanel.tsx:174` calls
   it as the fallback for every render where the device hasn't yet been
   registered:
    `const state: ProofState = allInstances?.[deviceId] ?? getProofState(deviceId);`
    Each render that lands on the fallback path gets a fresh object,
    breaking React Compiler's referential-equality optimisations and
    forcing every child's `useEffect` to re-fire. Combine with finding
    #4 and you have a render storm during the brief window between
    panel mount and bridge registration.

8. **`setProofParamWithPatch` uses `as` casts to dispatch on key names.**
   `setProofParamWithPatch.ts:21-69` is a giant `if/else if` chain that
   casts `value` to `number`, `boolean`, or
   `[number, number, number, number, number]` based on the key string.
   Each cast is the kind of "type assertion to silence the compiler"
   AGENTS.md "TypeScript — soundness" forbids:
   ```
   bridge.setParam('input_gain', value as number);          // line 21
   bridge.setParam('eq_bypass', (value as boolean) ? 1 : 0);// line 25
   bridge.reorderModules(value as [number, number, number, number, number]); // line 68
   ```
    The function is generic over `Key extends keyof ProofPatch` so the
    type-system *could* know the value type per branch with a discriminated
    helper, but as written it relies on the dev getting every cast
    right. There is no test that covers any branch except the existence
    of the export (`setProofParamWithPatch.spec.ts:6-10`).

9. **`setProofParamWithPatch` never persists.** `setProofParam.ts:5-8`
   forwards to `bridges.get(...)?.setParam(name, value)` **and**
   `persistDeviceParam(deviceId, name, value)`.
   `setProofParamWithPatch.ts` (the typed-key variant the UI calls
   far more often — every knob, every chip, every preset) calls
   `bridge.setParam(...)` but **never** calls `persistDeviceParam`.
   So the patch is in the store (so the UI sees it), the engine has it
   (because the bridge sent it), but the project save layer
   (`Track.devices[*].parameterValues`) has no record of it. **Every
   knob turn done through `setProofParamWithPatch` is lost on project
   reload unless `syncFullPatch` runs after store hydration and
   re-pushes from the patch.** Looking at `Project/.../resetModuleStoresToDefault.ts:12`
   — the project layer wipes `proofStore` to default on reset, and
   nothing repopulates it from saved data. The "save round-trip" is
   broken by construction.

10. **`reorderChain` does not persist either.** `reorderChain.ts:5-8`
    calls `updateProofPatch` (in-memory only) and `bridges.get(...)?.reorderModules`.
    Same persistence gap as #9. A re-routed signal chain is lost on
    project save/reload.

11. **`loadProofPatchWithAudio` has the same gap when loading a
    preset.** `loadProofPatchWithAudio.ts:117-120` writes the patch
    into the store and calls `syncFullPatch` which forwards every
    parameter via `bridge.setParam(...)`. None of the per-parameter
    sends call `persistDeviceParam` — so loading a preset updates
    the engine and the store but does **not** persist any value to
    `Track.devices[*].parameterValues`. Reload the project and the
    `parameterValues` map is empty, the `ProofNode` re-applies the
    SAB-default initial parameters (whatever the WASM module starts
    with), and the user sees a blank patch.

12. **Boolean parameters are stuffed through a `number` channel.**
    `helpers.ts:1-5` types `setParam: (name: string, value: number) =>
    void`. Boolean fields (`enabled`, `bypassed`, `imgAutoMonoBass`,
    `autoMakeup`) get stringly converted via `? 1 : 0` at every call
    site. Centralising would help but the contract is set by the WASM
    AudioWorklet. Note that `setProofParam` / `persistDeviceParam`
    accept `number` only, so any boolean already loses its type by the
    time it crosses the bridge — but `persistDeviceParam` validates
    `Number.isFinite(value)` and silently drops `NaN`. If a booleans
    accidentally arrives unconverted, it becomes `NaN` and disappears.
    `ProofExciterSection.tsx:25-32` and `ProofDynSection.tsx:41-49`
    have explicit `typeof value === 'boolean'` guards inside
    `onSendParam` — but `ProofEqSection.tsx:39-42` does not (it only
    fires `onSendParam` for explicit numeric writes; the boolean
    `enabled` toggle has its own dedicated `onSendParam(`eq_band${i}_enabled`,
    next ? 1 : 0)` call). The pattern is inconsistent across sections.

13. **`ProofPanel.tsx` Level 2 forces `setProofParamWithPatch(deviceId,
    'dynBands' as never, bands as never)`.** Lines 550, 584:
    ```ts
    setProofParamWithPatch(deviceId, 'dynBands' as never, bands as never);
    ```
    AGENTS.md "TypeScript — soundness" calls out `as never` /
    `as unknown` / `as any` as escape hatches. The `as never` is here
    because `setProofParamWithPatch`'s generic constraint
    (`<Key extends keyof ProofPatch>`) can't discriminate between
    array-vs-scalar branches when the Key is determined by a runtime
    string. The fix is a typed dispatch (a record of writers per key,
    or a discriminated union), not `as never`.

14. **`ProofPanel.spec.tsx` renders `<ProofPanel />` without a
    `deviceId`.** The component signature is
    `({ deviceId }: { deviceId: string })` (`ProofPanel.tsx:172`). The
    spec calls `render(<ProofPanel />)` four times (`ProofPanel.spec.tsx:16,
    21, 26, 31`) — TypeScript should reject this, but
    `ProofPanel.spec.tsx` does not have a `// @ts-expect-error` and the
    test passes. Either the test file is being type-checked with a
    laxer config, or the component file's prop types differ from what
    the test uses (e.g., the test sees `deviceId?: string`). Inspecting
    the component shows `deviceId` is required. So the spec is
    type-broken and the runtime tolerates `undefined` only because
    `allInstances?.[undefined]` is `undefined` and the fallback path
    runs (issue #7).

15. **Most spec files are `expect(subject.foo).toBeDefined()` no-ops.**
    Eight of the eleven `useCases/proofParamBridge/__tests__/*.spec.ts`
    files are identity-only — they import the module as `* as subject`
    and assert the named export exists, then assert
    `typeof subject.foo === 'function' || === 'object'`. They cover **zero**
    behaviour. The `loadProofPatchWithAudio.spec.ts` even tests for the
    presence of *six* helpers that are not used cross-module — those
    helpers are exported but the only consumer is the same file's
    `syncFullPatch`, so the export is purely for the test. Other
    examples:
    - `useCases/proofParamBridge/__tests__/helpers.spec.ts:5-9` —
      `expect(subject).toBeDefined()` for a module that only exports a
      `Map`.
    - `presentations/components/__tests__/LoudnessHistory.spec.tsx:7-12`
      — renders, checks a canvas element exists.
    - `presentations/components/__tests__/TonalBalance.spec.tsx:7-12`
      — renders with `fftData={null}`, checks a canvas element exists.
      Never feeds non-null FFT data.
    - `presentations/components/__tests__/ProofEqCurve.spec.tsx:8-19`
      — renders, checks a canvas. Never exercises drag handling.

    AGENTS.md "TypeScript — soundness — Tests" forbids stopping at
    "defined / truthy". This is the textbook violation.

16. **`updateProofMeters` mutates `tapPeaks` by reference.**
    `proofStore.ts:108`: `tapPeaks: meters.tapPeaks` — the array passed
    in from the WASM message handler is stored as-is. If the WASM layer
    reuses the array for the next callback (a typical optimisation),
    every previously-stored snapshot will mutate after-the-fact. Looking
    at `ProofNode.ts:18-30` (out of scope but inspected for context),
    the meter callback receives a fresh object built from the SAB read
    each tick — so this is currently safe. But the contract makes no
    guarantee, and the spec for `updateProofMeters` does not exist
    (none of the listed test files cover it) — so a future change in
    `ProofNode` to reuse a buffer would silently corrupt all UI snapshots
    via the shared reference.

17. **`useProofAnalyser` violates audio-graph hygiene on cleanup.**
    `useProofAnalyser.ts:35-95` connects a fresh `AnalyserNode` to
    `getMasterAnalyser()` on every mount. Cleanup calls
    `analyser.disconnect()` *and* `masterAnalyser.disconnect(analyser)`
    inside double `try {} catch {}` blocks. If the component is mounted
    in StrictMode (development), the effect runs twice, and the second
    mount creates a second `AnalyserNode` connected to the master tap;
    the first cleanup successfully disconnects the first one. However:
    - `getMasterAnalyser()` could return a different node between
      mount and cleanup (if the audio engine reset). The
      `masterAnalyser.disconnect(analyser)` call would throw, the
      `catch {}` swallows it, but the connection is leaked — the
      original analyser keeps tapping the original master and the
      reference is held until GC, plus the `requestAnimationFrame`
      loop is gone but no one calls
      `getFloatFrequencyData` on the dangling analyser anymore.
      So it's effectively idle but not cleaned up.
    - The `try { masterAnalyser.connect(analyser); } catch { return; }`
      at line 48-53 returns `undefined` (no cleanup function) on
      failure, so subsequent unmounts don't run any cleanup — but the
      `analyser` node is still constructed and held in
      `analyserRef.current`. A second mount that succeeds would
      replace the ref but the first analyser is still a
      `ctx.createAnalyser()` allocation living in `Audio*Context`
      until GC.

18. **`useProofAnalyser` returns `sampleRate` and `fftSize` from
    `getAudioSampleRate()` outside the effect — they re-evaluate on
    every render.** Line 101: `sampleRate: getAudioSampleRate()` is a
    function call evaluated on every `useProofAnalyser()` invocation
    (which is ~15 fps via `setTick` in the rAF loop, since each tick
    setState bumps `tick` and re-renders the parent). Each render
    calls `getAudioSampleRate()`. Cheap, but conceptually wrong: the
    returned values are part of the hook's return object and would be
    treated as stable by callers using them in `useEffect` deps. They
    are stable in practice (sample rate doesn't change), but the
    contract is "will re-fire if `getAudioSampleRate()` ever differs"
    — and there is no memoisation around this.

19. **All bridge use cases silently no-op when `bridges.get(deviceId)`
    is missing.** Every file in `proofParamBridge/` does
    `bridges.get(deviceId)?.someMethod(...)`. There is no logging, no
    user feedback, no error path. If the panel renders before the
    `wasmDeviceRegistry` callback has fired
    (`wasmDeviceRegistry.ts:518`), every UI interaction is a silent
    drop. The user turns a knob, sees the UI move (because
    `updateProofPatch` fired), but the engine doesn't change. There
    is no test that asserts the missing-bridge path emits a warning
    or queues the parameter.

20. **`ProofPanel.tsx` has 1018 lines and five inline level
    sub-components (`Level1Play`…`Level5Lab`), plus `MiniMeter`,
    `KnobColumn`, `MeterCard`, `SideCard`, and helper functions.**
    The file is doing the work of ~8-10 components. Each level
    component receives `state` (the entire `ProofState`, including
    fields it doesn't use) and `deviceId`; they all re-render on every
    meter tick because of finding #4. Splitting by level into separate
    files under `presentations/views/` (or `presentations/components/`
    if they're not entry points) would let the Compiler do its job.

21. **`Level2Shape.KnobColumn` always passes `defaultValue={value}`.**
    `ProofPanel.tsx:1007`: `defaultValue={value}` — i.e. the "double-
    click to reset" target is always the current value. So
    double-clicking a knob does nothing. This is a UX dead-end for
    every knob in `Level2Shape` (EQ output gain, dynamics threshold,
    imager width, exciter drive, limiter ceiling).

22. **`Level2Shape` "EQ output gain" knob is a no-op stub.**
    `ProofPanel.tsx:537-542`:
    ```ts
    <KnobColumn
        label="EQ"
        sublabel="Output Gain"
        value={0}
        onChange={() => {}}
        ...
    />
    ```
    The patch has no EQ-specific output gain (`outputGain` is the
    *master* output, edited in `Level4Route`). The knob is decorative.
    The user turns it; nothing happens. No comment, no `// TODO`.

23. **`MiniMeter.normalize` uses `(db + 60) / 60`.** `ProofPanel.tsx:951`:
    ```ts
    const normalize = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));
    ```
    A peak of `0 dB` (full scale) maps to `1.0` (full meter); `-60 dB`
    maps to `0.0`. Reasonable, but no peak hold, no clip indicator —
    a true-peak overshoot is invisible because the meter clamps to
    `1.0`. The dedicated `truePeakDb` is shown in the header strip
    but the per-tap mini-meters give no visual warning of clip.

24. **`Level1Play` streaming-warning logic uses `+ 1` magic number.**
    `ProofPanel.tsx:453`:
    ```ts
    state.integratedLufs > (TARGET_LUFS[patch.target] ?? -14) + 1
    ```
    The threshold for "warn the user about platform normalization"
    is hard-coded as `target + 1 dB`. `Level5Lab` (line 874) uses
    `delta > 1` for the same purpose. Same magic number, two places.
    Move to a constant.

25. **`Level5Lab` `platformNormalizationTarget` switch is a string
    template with no i18n.** Lines 812-817: hard-coded
    "Spotify, Apple Music, and YouTube" / "broadcast television". In
    a multilingual UI these strings are unreachable to the translator.
    All other `Proof` UI text has the same problem (no
    `react-i18next`/`<Trans>`), but this one is unusually long and
    user-facing.

26. **`Level4Route` reports latency assuming 44100 Hz.**
    `ProofPanel.tsx:759`:
    `${((state.latency / 44100) * 1000).toFixed(1)}ms`
    The actual sample rate is available from `getAudioSampleRate()`
    (already imported elsewhere). Hard-coding 44100 silently
    mis-displays latency on 48 kHz / 96 kHz contexts (off by ~9% /
    ~117%).

27. **`ProofEqCurve` only renders peak/shelf curves; HP/LP bands are
    silently dropped from the display.** `ProofEqCurve.tsx:134` —
    `if (band.type <= 2) { … }`. Bands of type 3 (HP) and 4 (LP) are
    enabled by default in `DEFAULT_PATCH` (band 0 HP at 30 Hz, band
    7 LP at 18 kHz, both with `enabled: false`) but if the user
    enables them, the curve does not show their effect. The dot is
    drawn (line 186 onward, no type filter on the dot loop), so the
    user sees a dot floating in the middle of the canvas with no
    associated curve. The drag handler (line 253-273) updates `freq`
    and `gain` regardless of band type, so the user can drag an HP
    band to a freq/gain combo that looks right on the dot but doesn't
    match the inaudible-on-canvas filter response.

28. **`ProofEqCurve.peakingMag` formula is incorrect for shelf
    filters.** Lines 27-39 implement a peaking-EQ magnitude. The
    function is then applied to bands of type ≤ 2 — i.e. peak (type
    0), low-shelf (type 1), and high-shelf (type 2). For shelf
    filters, the magnitude response is fundamentally different: a
    low-shelf doesn't have the symmetric `(1 - w²)²` shape — it
    asymptotes to `gainDb` at `w → 0` and to `0 dB` at `w → ∞`. The
    user sees a peaking bump centred on `band.freq` for shelves
    instead of an actual shelf shape.

29. **`ProofEqCurve` uses `useEffect` for canvas painting with a
    dependency array that excludes `dragBandRef.current`.** Line
    221: `[patch, width, height]`. The drag handler (line 253) calls
    `onPatchChange({ eqBands: bands })` which is the parent's
    `updateProofPatch` (`ProofPanel.tsx:618`), which mutates the
    store. The store change triggers a re-render with a new `patch`
    object, the `useEffect` re-fires, the canvas redraws. **For
    every pointer-move event during a drag.** No throttling, no
    rAF batching. Drag a band rapidly across the canvas and you
    can produce 60+ store updates per second, each triggering a
    full instances-map rebuild (issue #4) and a full canvas redraw.

30. **`ProofEqCurve.handlePointerMove` allocates and dispatches on
    every move.** Lines 269-272:
    - allocates a new `bands` array via `.map`,
    - dispatches `onPatchChange({ eqBands: bands })`,
    - dispatches `onSendParam('eq_band${idx}_freq', newFreq)`,
    - dispatches `onSendParam('eq_band${idx}_gain', newGain)`,
    each pointer-move event. Combine with #29 and #4 and you have an
    O(N×M) cascade per pointer event (N store subscribers, M bands).

31. **`onPatchChange` from `ProofEqCurve` and the parent's
    `updateProofPatch` form a duplicate write path.** The
    parent (`ProofPanel.tsx:619`) wires `onPatchChange={(p) =>
    updateProofPatch(deviceId, p)}` and `onSendParam={(n, v) =>
    setProofParam(deviceId, n, v)}`. So every drag fires:
    - `updateProofPatch(deviceId, { eqBands })` — store mutation,
    - `setProofParam(deviceId, 'eq_band${idx}_freq', newFreq)` — bridge
      forward + persistDeviceParam,
    - `setProofParam(deviceId, 'eq_band${idx}_gain', newGain)` — bridge
      forward + persistDeviceParam.
   That's correct, but there's no guard against the `freq`/`gain` fields
   in the patch and the persisted parameter values diverging
   (e.g. if `setProofParam` no-ops because `bridge` isn't set yet —
   issue #19 — the patch is still updated, persistence is still
   updated, but the engine isn't, and on next engine init the
   `ProofNode` doesn't read from `Track.devices[*].parameterValues`
   so the patch and engine stay out of sync).

32. **`ProofImagerSection.imgMonoBassFreq` knob writes patch + sends
    raw param without persisting.** `ProofImagerSection.tsx:99-115`:
    ```ts
    onChange={(v) => {
        onPatchChange({ imgMonoBassFreq: v });
        onSendParam('img_mono_bass_freq', v);
    }}
    ```
    Same issue as #9–#11: `onSendParam` resolves to `setProofParam`
    *only* when called via `ProofPanel`'s `onSendParam={(n, v) =>
    setProofParam(deviceId, n, v)}` wiring (line 619, 626, 633, 639,
    647). All five sections route `onSendParam` through `setProofParam`,
    which **does** persist. So `Level3Build` knob turns *do* persist.
    Compare to `Level2Shape` (`ProofPanel.tsx:485-605`) and
    `Level4Route` (`ProofPanel.tsx:697-802`) which call
    `setProofParamWithPatch(deviceId, 'limCeiling', v)` etc. directly
    — no persistence. **So Level 2 and Level 4 knob writes are lost
    on reload; Level 3 writes are kept.** Same UI, different write path,
    different persistence behaviour.

33. **`ProofLimiterSection.dither_bits` `onSendParam` value is
    `bits` (a parsed number), but the WASM contract may expect an
    enum-like.** `ProofLimiterSection.tsx:166-170`:
    ```ts
    const bits = parseInt(e.target.value);
    onPatchChange({ ditherBits: bits });
    onSendParam('dither_bits', bits);
    ```
    The patch types `ditherBits: number` (no enum) but the only
    options exposed are `<option value={16}>16</option>` and
    `<option value={24}>24</option>`. Engine may accept arbitrary
    integers; UI doesn't constrain. Probably fine in practice; flag
    as type drift.

34. **`ProofLimiterSection.ditherMode` cast.** Line 146:
    `value={DITHER_VALUES.indexOf(patch.ditherMode as (typeof DITHER_VALUES)[number])}`.
    The cast tells TS that `patch.ditherMode` is one of the literal
    values — which the type already enforces (`DitherMode` =
    `'off' | 'tpdf' | 'noise_shaped'`). The cast is redundant and is
    a dead `as` escape per AGENTS.md.

35. **`ProofPanel.tsx` tests mock only `useStore` — every store mutation
    in the production code is a real call to `proofStore.set(...)`,
    persisting state across tests.** `ProofPanel.spec.tsx:6-8`:
    `vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn(...) }))`.
    No mock for `proofStore` itself. If a future test exercises
    `setProofUiLevel` or `loadProofPatchWithAudio`, the real store
    accumulates state across tests in the same file (the module-level
    `bridges` map likewise leaks).

36. **`presentations/views/index.ts` exports `ProofPanel` directly,
    but there is no module-level `index.ts` so this surface is
    `#/modules/Proof/presentations/views`.** AGENTS.md "Barrel files":
    "Do not add `index.ts` barrels [...] **except** each module's
    **root** `index.ts`. That file is the sole **cross-module**
    public surface and may **only** re-export from `useCases/`,
    `events/`, `stores/`, and `presentations/views/`." The presence
    of `presentations/views/index.ts` is fine *if* there's a root
    `index.ts` re-exporting it. There isn't (issue #1), so consumers
    reach `#/modules/Proof/presentations/views` directly — same
    effect, different syntax — but the architecture rule is about
    intent: this should be a curated surface from `Proof/index.ts`.

37. **`getProofState` and `getProofUiLevel` mutators take positional
    params (AGENTS.md violation).** `proofStore.ts:70, 74, 80, 86,
    92`: every public mutator is `(deviceId: string, ...)` with two
    or three positional params. AGENTS.md "Function Signatures":
    "Functions with more than one parameter take a single object
    param. For module-level functions, the input type is named
    `FunctionNameInput` ...". Same in `setProofParam.ts`,
    `setProofParamWithPatch.ts`, `reorderChain.ts`,
    `loadProofPatchWithAudio.ts`, `registerProofDevice.ts`,
    `unregisterProofDevice.ts`. Eight files.

38. **`registerProofDevice` parameter is named `b`.** AGENTS.md
    "Naming Constraints": "No single-letter variable names". Line 5:
    `export function registerProofDevice(deviceId: string, b: ProofAudioBridge)`.

39. **`ProofPatch.eqBands.type` and `eqBands.channel` are typed as
    `number` with prose comments instead of discriminated unions.**
    `ProofPatch.ts:31-32`:
    ```ts
    type: number; // 0=peak, 1=lowShelf, 2=highShelf, 3=highPass, 4=lowPass
    channel: number; // 0=stereo, 1=mid, 2=side
    ```
    AGENTS.md "TypeScript — soundness": "**Forbidden:** [...] `Record<string,
    …>` as a stand-in for a domain model when a concrete shape or
    discriminated union exists". Same applies for these. The
    `EqBandChannel` type *exists* in the same file (line 15), it's just
    not used in `eqBands.channel`. `ProofModuleId`, `SaturationType`,
    `EqBandChannel` are exported from the model but every consumer
    types the field as `number`.

40. **`ProofPatch.excBands.type` likewise.** Lines 60-65: `type:
    number; // 0=tape, 1=tube, 2=transistor, 3=warm`. `SaturationType`
    is defined and unused.

41. **`updateProofMeters` does not validate `meters.tapPeaks.length`.**
    The store's `DEFAULT_PROOF_STATE.tapPeaks` has length 6 (one input
    + five module taps); the WASM contract emits 6, but if a future
    chain change emits fewer or more, the UI's `state.tapPeaks[1]?.peakL`
    paths silently render `-100` (the `??` fallback). No length check,
    no warning.

42. **`proofStore.ts:10-15` defines `ProofMeterData` locally
    "to avoid importing from AudioEngine/engine/ (private internal)"
    with a comment that it "must remain structurally compatible with
    the ProofMeterData type in AudioEngine".** This is correct per
    AGENTS.md "Model isolation". But there is **no test** that asserts
    the structural compatibility — a change in
    `AudioEngine/engine/ProofNode.ts:18-30` that adds a field would
    silently leave Proof's local copy out of sync. There is also a
    duplicate type in `AudioEngine/engine/ProofNode.ts:18` (audited in
    AudioEngine's audit, not here, but worth flagging the pair).

43. **`proofPresets.ts` IIFE ladders for narrowed band updates.**
    Lines 24-33, 60-71, 110-120, 124-134:
    ```ts
    eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
        (() => {
            if (i === 1) { return { ...b, gain: 1.5 }; }
            if (i === 6) { return { ...b, gain: 1.0 }; }
            return b;
        })()
    ),
    ```
    Four separate IIFE-in-`map` ladders, identical structure, magic
    indices `1` and `6` (low-shelf and high-shelf bands). No comment
    explaining why those bands. Move to a named helper
    (`adjustBandsAtIndices`) and let presets describe their changes
    declaratively.

44. **`proofPresets.ts` `'cd'` preset assigns `targetLufs: -9`.**
    Line 38. The CD spec is closer to `-12 LUFS` for modern masters
    (RP 200; CDs aren't EBU-normalized at all — `-9` is a "loud
    master" target, not "CD"). This is a UX/correctness call for the
    DSP team; flag for review.

45. **`proofPresets.ts` `target: 'club'` LUFS = -6.** Aggressive but
    matches the streaming-loudness arms race; OK as a target *option*,
    but two presets (`club` and `loud`) point at it. Worth checking
    that the UI doesn't double-list them.

46. **`presentations/components/__tests__/ProofPanel.spec.tsx` is in
    `presentations/views/__tests__/`, not `presentations/components/__tests__/`.**
    This is consistent with the file's location (`views/`) but the
    audit listed it under `presentations/components/`; ignore.

47. **`useStore` defaultValue is `{}` for `proofStore`.** `ProofPanel.tsx:173`:
    `useStore(proofStore, {})`. The store's `TData` is
    `ProofInstances = Record<string, ProofState>`; `{}` is a valid
    `Record<string, ProofState>`. Fine. But the next line
    `const state: ProofState = allInstances?.[deviceId] ?? getProofState(deviceId);`
    assumes `allInstances` is the bare record, which it is — except
    that React tracks `allInstances` referentially: if the bare
    fallback `{}` is returned multiple times,
    `useSyncExternalStore` returns the *same* `{}` reference (via
    `getSnapshot()` returning `null` → fallback to `defaultValue`).
    A subtle bug surface: if `proofStore.value` flips from `null`
    to `{}` to `null` to `{}` (unlikely but possible if a reset
    runs), the snapshot reference oscillates and React can tear.

48. **`presentations/hooks/` — only one file (`useProofAnalyser.ts`).**
    AGENTS.md "Private Internals" lists `presentations/hooks/` as
    private. OK.

49. **`events/index.ts` is `// no public events`.** The presence of an
    empty `events/` exists to satisfy AGENTS.md "Module structure".
    Fine, but there's no `Proof/index.ts` re-exporting it (#1), so the
    "events module" is empty *and* invisible. If Proof is meant to
    publish events later, this is a placeholder; if not, drop the
    folder.

50. **No keyboard / a11y on chain reorder.** `Level4Route.moveModule`
    (`ProofPanel.tsx:700-710`) is wired to `←` / `→` buttons (lines
    729-744). The buttons are `<button type="button">` with text
    arrows but no `aria-label`. Screen readers see "← arrow" without
    context. Same for the disabled state (`disabled={slot === 0}`) —
    the button still has no accessible name beyond "←".

51. **No keyboard navigation for EQ band drag.** `ProofEqCurve`
    handles `pointerDown/Move/Up` only. There is no keyboard
    alternative to drag a band — no focus, no arrow-key adjustment.
    A keyboard-only user cannot operate the EQ canvas. The
    surrounding `<canvas aria-label="8-band parametric EQ frequency
    response" />` is a nominal accessible name but the canvas is not
    operable.

52. **`<canvas>` elements have `aria-label` but no role / focus / value
    semantics.** All three canvas components
    (`ProofEqCurve`, `LoudnessHistory`, `TonalBalance`) use
    `aria-label="..."`. They should also be `role="img"` (for the
    static visualisations) or expose interactive controls via DOM
    children for the EQ canvas. As-is, screen reader users get a
    label and nothing else.

53. **`button` for `←`/`→` chain reorder has no swap announcement.**
    When the user presses `←`/`→`, the chain reorders silently. No
    `aria-live` region announces "EQ moved to slot 1". For a
    keyboard-and-screen-reader workflow this is invisible.

54. **`MiniMeter` has no `role="meter"` or `aria-valuenow`.** For
    every `<MiniMeter>` (per chain step in `Level2Shape`,
    `ProofPanel.tsx:493-524`) the visual is a stack of pixel-height
    `<div>`s. AT users see nothing. Should be `<meter>` or
    `role="meter"` with `aria-valuemin/-max/-now` and
    `aria-valuetext`.

55. **No live region for limiter clip / true-peak overshoot.**
    `ProofLimiterSection.tsx:131-135` colours the true-peak readout
    red when `> -1 dBTP`, but there is no `role="alert"` or
    `aria-live="polite"` to announce the overshoot. Same for the
    streaming-loudness warning (`ProofPanel.tsx:454-459`) and
    Level5Lab's delta warning (line 874-880). All three are visual-
    only.

56. **No tests assert any of the section components' onChange wiring.**
    Every section spec is "renders, has a title". None call
    `fireEvent.click` on a toggle, none assert that
    `onPatchChange`/`onSendParam` mocks were called with specific
    args. Considering #8/#9/#11, the actual *behaviour* of each
    section is uncovered.

57. **Cross-module reach into `#/modules/Arrangement/stores` from a
    use case.** `setProofParam.ts:1` imports `persistDeviceParam` from
    `#/modules/Arrangement/stores`. AGENTS.md "Contract Boundaries":
    "Cross-module imports MUST only target the destination module's
    root **`index.ts`** (e.g. `#/modules/Arrangement`). Deep imports
    into `useCases/`, `events/`, `stores/`, [...] from outside the
    module are forbidden." The import targets `Arrangement/stores`
    — a sub-path. The same comment block in
    `Arrangement/stores/persistDeviceParam.ts:1-11` defends the
    location ("colocated with the store instance ... so synth param
    bridges (Bacteria, Crust, Fermenter, Gluten, Grinder, Levain,
    Proof) can call it without importing the full Arrangement/useCases
    graph"), so this is a knowing exception. But it remains a
    cross-module sub-path import; either Arrangement should expose
    `persistDeviceParam` from its root `index.ts`, or this rule
    needs an explicit carve-out for "`*/stores` is a permitted
    sub-path." From Proof's perspective, document the rule violation
    but flag as an Arrangement-side decision.

---

## Priorities

1. **Persistence path is broken** (issues #9, #10, #11, #32). Most knob
   writes (every `setProofParamWithPatch`/`reorderChain`/`loadProofPatchWithAudio`
   call site) update the patch + the engine but never call
   `persistDeviceParam`. Project save/reload silently drops user changes.
   This is a data-loss bug.
2. **Render storm at meter rate** (issues #4, #7, #20, #29). Every meter
   tick rebuilds the entire `proofStore` instances map and triggers a
   re-render of `ProofPanel` and every section. The single largest
   performance issue in the module.
3. **Type-soundness escapes** (issues #8, #13, #34). `as never` and
   `as` casts in `setProofParamWithPatch` and `Level2Shape`'s knob
   handlers; AGENTS.md explicitly forbids them. Replacing with a typed
   dispatch closes both the cast and the parameter-shape mismatch.
4. **A/B bypass UI is mis-wired** (issue #6). The toggle reaches around
   the use-case layer to mutate the store, persists `ab_bypass` through
   `persistDeviceParam` but no consumer reads it back, and the parameter
   isn't part of the engine's known param set.
5. **No real test coverage** (issue #15, #56). Eight identity-only
   tests + six "renders" tests cover essentially nothing. Bridge
   forwarding, persistence, drag handling, preset loading — all
   uncovered.
6. **Module has no root `index.ts`** (#1, #36). The cross-module
   public surface is ad-hoc; AGENTS.md "Barrel files" mandates a
   root barrel.
7. **EQ canvas correctness** (issues #27, #28, #29, #30). Shelf
   filters render as bumps; HP/LP bands have draggable dots with no
   curve; drag fires uncoalesced store updates at pointer rate.

---

## Open issues

### 1. No root `index.ts` — cross-module surface is ad-hoc

**Problem:** `src/modules/Proof/` has no `index.ts`. External
consumers reach in via `#/modules/Proof/stores`, `#/modules/Proof/useCases`,
`#/modules/Proof/presentations/views`. AGENTS.md "Barrel files"
requires the root `index.ts` to be the sole cross-module surface.

**Representative files:**

- `src/modules/Proof/` (missing `index.ts`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:62`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:19-20`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:12`

**Needed:** Add `src/modules/Proof/index.ts` that re-exports the
intended public surface (the three callable use cases already in
`useCases/index.ts`, `proofStore` and `updateProofMeters` from
`stores/`, `ProofPanel` from `presentations/views/`). Update the
four cross-module imports to target the root.

### 2. Persistence is missing for `setProofParamWithPatch` / `reorderChain` / `loadProofPatchWithAudio`

**Problem:** `setProofParam` calls `persistDeviceParam`; the
typed-key variants (`setProofParamWithPatch`, `reorderChain`,
`loadProofPatchWithAudio` and the `syncFullPatch` it triggers) do
not. Every UI write that goes through these paths is lost on project
save/reload — the in-memory store and the engine know the new value,
but `Track.devices[*].parameterValues` does not, and `ProofNode` does
not read from the patch on init.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:13-69`
- `src/modules/Proof/useCases/proofParamBridge/reorderChain.ts:5-8`
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:78-120`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:550, 584, 596, 769, 786`

**Needed:** Either (a) every bridge use case forwards to
`persistDeviceParam` for each parameter it sends, or (b) the
`ProofNode` audio worklet reads the patch from
`Track.devices[*].parameterValues` on init and the patch
itself becomes the persistence target (with one `persistDevicePatch`
write per change). Pick one. Audit cross-references to
`Project/useCases/projectPersistence` to confirm the chosen
contract.

### 3. Meter-rate full-store rebuild

**Problem:** `updateProofMeters` rebuilds the `instances` map and
the device's full state on every WASM meter callback (~30-60 Hz).
Every `useStore(proofStore, {})` subscriber re-renders on every
meter tick. `ProofPanel` and all five section components re-render at
meter rate; their canvas `useEffect`s re-execute (issue #29).

**Representative files:**

- `src/modules/Proof/stores/proofStore.ts:92-112`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:173`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:515-517`

**Needed:** Either:
- Split the store: `proofPatchStore` (low-rate, patch-only) and
  `proofMetersStore` (high-rate, per-device meter snapshot). UI
  components subscribe to whichever they actually need.
- Or, keep one store but add a per-device `Store<ProofState>` that
  isolates updates per device, and ensure subscribers read only
  meter fields they need via a `useStoreSelector` (and confirm the
  selector returns the same primitive for unchanged values).
Add a test: render `ProofPanel`, dispatch 100 meter updates, assert
sub-component render count.

### 4. A/B bypass mutates the store from view code

**Problem:** `ProofPanel.tsx:347-358` reaches `proofStore.value`
and calls `proofStore.set(...)` directly inside an `onClick`
handler. It also calls `setProofParam(deviceId, 'ab_bypass', ...)`
which forwards to a parameter the engine does not recognise, and
persists the value to a parameter map nothing reads back.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:346-369`
- `src/modules/Proof/stores/proofStore.ts` (no `setProofAbBypass`)
- `src/modules/AudioEngine/engine/ProofNode.ts:18-30` (no `ab_bypass`
  in the meter contract; check the param API)

**Needed:** Decide what A/B bypass means.
- If it's a UI-only toggle (the "compare" mute on the Proof channel
  strip) — add `setProofAbBypass(deviceId, value)` use case that
  updates the store and routes through the bridge's `setBypass`
  method, not `setParam`. Drop the `persistDeviceParam` call.
- If it's an engine-level dry/wet — define the parameter formally,
  read it on engine init, and document the contract.

### 5. `setProofParamWithPatch` uses `as` / `as never` to dispatch on key

**Problem:** A 50-line `if/else if` dispatching on string keys with
`value as number`, `value as boolean`, `value as [number, ...]`
casts. The `Level2Shape` callers compound the issue with `'dynBands'
as never, bands as never` casts. AGENTS.md "TypeScript — soundness"
forbids both.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:13-69`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:550, 584`

**Needed:** Build a typed dispatch table:
```ts
type Sender<Key extends keyof ProofPatch> = (bridge: ProofAudioBridge,
    deviceId: string, value: ProofPatch[Key]) => void;
const senders: { [Key in keyof ProofPatch]?: Sender<Key> } = { ... };
```
Each sender has the correct value type. The callers in `ProofPanel`
then drop the `as never` because the typed function signature
already constrains them. Add tests per branch.

### 6. Identity-only and "renders" tests cover no behaviour

**Problem:** Eight `useCases/proofParamBridge/__tests__/*.spec.ts`
files assert only that exports exist. Six component specs assert
only that a section title or a canvas element renders. None
exercise the actual contract: bridge forwarding, store mutations,
preset loading, drag handling, sample-rate-dependent latency
display.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/__tests__/helpers.spec.ts:5-9`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/registerProofDevice.spec.ts:5-11`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/loadProofPatchWithAudio.spec.ts:5-36`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/reorderChain.spec.ts:5-11`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/resetIntegratedMeters.spec.ts:5-11`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/setProofParam.spec.ts:5-11`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/setProofParamWithPatch.spec.ts:5-11`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/unregisterProofDevice.spec.ts:5-11`
- `src/modules/Proof/presentations/components/__tests__/{LoudnessHistory,ProofEqCurve,ProofEqSection,ProofDynSection,ProofImagerSection,ProofExciterSection,ProofLimiterSection,TonalBalance}.spec.tsx`
- `src/modules/Proof/presentations/views/__tests__/ProofPanel.spec.tsx`

**Needed:** Replace each with behavioural tests:
- `registerProofDevice`/`unregisterProofDevice`: register, send a
  param via `setProofParam`, assert the bridge mock received it.
  Unregister, assert subsequent sends silently drop.
- `setProofParamWithPatch`: per-key, assert the correct
  `bridge.setParam(name, value)` call.
- `reorderChain`: assert both `updateProofPatch` and
  `bridge.reorderModules` are called, in that order.
- `loadProofPatchWithAudio`/`syncFullPatch`: assert all expected
  param sends occur for a known patch.
- `resetIntegratedMeters`: assert `bridge.resetIntegrated()` fires.
- `ProofPanel`: render with `deviceId="d1"`, mount, assert preset
  click triggers `loadProofPatchWithAudio`. Test the A/B toggle.
  Test level switching (1 → 5).
- `ProofEqCurve`: simulate pointer drag, assert
  `onPatchChange`/`onSendParam` mocks fire with expected args.
- Section specs: simulate toggle clicks, assert mock contracts.

### 7. `ProofPanel.spec.tsx` renders without `deviceId`

**Problem:** `<ProofPanel />` is called four times with no prop;
`deviceId` is required. The test passes only because the component
runtime tolerates `deviceId === undefined` (issue #7's fallback path
returns a fresh state object). The spec is type-broken.

**Representative files:**

- `src/modules/Proof/presentations/views/__tests__/ProofPanel.spec.tsx:16, 21, 26, 31`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:172`

**Needed:** Pass `deviceId="test-device-1"` (and any required setup
in `beforeEach` to register a mock bridge for it). Replace the four
near-duplicate "renders without crashing" cases with behavioural
tests (issue #6).

### 8. EQ canvas misrenders shelf filters and skips HP/LP

**Problem:** `peakingMag` is applied to band types ≤ 2 (peak +
shelves). For shelves the formula is wrong (asymmetric shelf
response is rendered as a symmetric bell). Bands of type 3 (HP)
and 4 (LP) have no curve drawn at all but their dot is drawn (line
186 has no type guard). The user sees a floating dot with no
associated curve and a draggable freq/gain that doesn't reflect
the audible filter shape.

**Representative files:**

- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:27-39, 134-141, 186-220`

**Needed:** Implement the correct biquad magnitude formulas per
band type:
- Peaking: existing.
- Low/high shelf: `2A·s·sqrt((A²+1)/(s²+s/Q))/...`.
- HP/LP: 2nd-order Butterworth magnitude.
Or, use the Web Audio API's `BiquadFilterNode.getFrequencyResponse`
on a transient node to compute the response — guaranteed accurate.
Add a snapshot test for each band type's response shape.

### 9. EQ drag fires uncoalesced store updates at pointer rate

**Problem:** `handlePointerMove` fires on every pointer event
(potentially > 60 Hz on high-DPI mice). Each fires:
`onPatchChange({ eqBands })` (full instances rebuild, full canvas
redraw via deps), plus two `onSendParam` calls (each: bridge send
+ `persistDeviceParam` walking the track tree).

**Representative files:**

- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:253-273`
- `src/modules/Proof/stores/proofStore.ts:80-84`

**Needed:** Coalesce drag updates via rAF: batch pointer events
into a single end-of-frame patch. Or, keep a local "dragging" state
and only flush to the store on `pointerUp`. Either way, decouple
pointer rate from store rate.

### 10. Bridge writes silently no-op when device is not yet registered

**Problem:** Every `bridges.get(deviceId)?.method(...)` returns
`undefined` when the bridge isn't registered. The user turns a
knob, the store updates (UI moves), the engine doesn't (bridge
no-op). No log, no warning, no queue.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParam.ts:6`
- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:14-69`
- `src/modules/Proof/useCases/proofParamBridge/reorderChain.ts:7`
- `src/modules/Proof/useCases/proofParamBridge/resetIntegratedMeters.ts:4`
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:7-115`

**Needed:** One of:
- Queue pending parameter writes per-deviceId; flush on
  `registerProofDevice`. (`wasmDeviceRegistry.ts:509` already does
  this for *initial* params via `pendingParams`; mirror it here.)
- Log a warning at `bridges.get(deviceId) === undefined` and surface
  a UI toast on first occurrence.
Add a test for "ProofPanel mounted before bridge registered" that
asserts no engine writes happen but the patch still updates and the
queued writes flush after register.

### 11. `Level1Play` and `Level5Lab` magic +1 dB threshold

**Problem:** Both levels independently implement "warn user if mix
is more than 1 dB above target." Same threshold, two literal
locations.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:453, 874`

**Needed:** Define `STREAMING_OVERSHOOT_THRESHOLD_DB = 1` once. Use
in both call sites. (Even better: extract a `<StreamingNormalizationWarning>`
component used in both levels.)

### 12. `Level4Route` latency display assumes 44.1 kHz

**Problem:** `${((state.latency / 44100) * 1000).toFixed(1)}ms`
hard-codes 44100. At 48 kHz this is 9% off; at 96 kHz over 100% off.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:759`

**Needed:** Use `getAudioSampleRate()` (already imported in
`useProofAnalyser.ts:10`). Add a regression test using
`OfflineAudioContext` at 48 kHz.

### 13. `Level2Shape` "EQ Output Gain" knob is a no-op

**Problem:** The knob displays value=0, has an empty `onChange`,
no documentation. User-visible but inert.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:537-542`

**Needed:** Either wire it to a real parameter (the patch has
`outputGain` for master output but no EQ-specific output gain) or
remove it from `Level2Shape`'s knob row.

### 14. `Level2Shape` `defaultValue={value}` makes double-click reset useless

**Problem:** Every `KnobColumn` in `Level2Shape` passes
`defaultValue={value}` to the underlying `RotaryKnob` — i.e. the
"reset to default" target is always the current value, so
double-click does nothing.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:1007`
  (the `KnobColumn` definition)
- All five `<KnobColumn>` instantiations in `Level2Shape`.

**Needed:** Pass real defaults (`0`, `-20`, `1`, `0.2`, `-1`) per
knob, or pass them through from the call site.

### 15. `proofStore.ts` mutators take positional args

**Problem:** AGENTS.md "Function Signatures" mandates a single
object parameter for multi-arg functions. All eight mutators
(`getProofState`, `setProofUiLevel`, `updateProofPatch`,
`loadProofPatch`, `updateProofMeters`) use 2-3 positional args.
Same in every `proofParamBridge/` file.

**Representative files:**

- `src/modules/Proof/stores/proofStore.ts:70, 74, 80, 86, 92`
- `src/modules/Proof/useCases/proofParamBridge/registerProofDevice.ts:5`
- `src/modules/Proof/useCases/proofParamBridge/setProofParam.ts:5`
- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:8-12`
- `src/modules/Proof/useCases/proofParamBridge/reorderChain.ts:5`
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:117`

**Needed:** Define `<FunctionName>Input` types per AGENTS.md.
Mostly mechanical, but cross-module consumers
(`wasmDeviceRegistry.ts:518, 536, 542`) and the panel will need to
update call sites.

### 16. `b: ProofAudioBridge` single-letter parameter

**Problem:** AGENTS.md "Naming Constraints" forbids single-letter
variables.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/registerProofDevice.ts:5`

**Needed:** Rename to `bridge: ProofAudioBridge` (and refactor to
single-object param per #15).

### 17. `ProofPatch.eqBands.type/channel` and `excBands.type` are `number` with prose comments

**Problem:** `ProofPatch.ts:31, 32, 60-65` types these as `number`
with `// 0=peak, 1=lowShelf, ...` comments. AGENTS.md "TypeScript —
soundness" forbids using `number` as a stand-in for a domain enum
when a discriminated union (or `as const` literal type) exists.
`EqBandChannel` (`'stereo' | 'mid' | 'side'`) and `SaturationType`
(`'tape' | 'tube' | 'transistor' | 'warm'`) are exported in the
same file and unused.

**Representative files:**

- `src/modules/Proof/models/ProofPatch.ts:5, 7, 9, 11, 13, 15, 17-80`
- `src/modules/Proof/presentations/components/ProofEqSection.tsx:144, 159`
- `src/modules/Proof/presentations/components/ProofExciterSection.tsx:84`
- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:134, 213`

**Needed:** Define `EqBandType = 'peak' | 'lowShelf' | 'highShelf' |
'highPass' | 'lowPass'` as `as const` literal type. Convert
`eqBands.type` to that type. Map at the WASM boundary (the integer
contract is the *bridge's* business; the model can stay typed). Same
for `excBands.type` → `SaturationType`. Same for `eqBands.channel`
→ `EqBandChannel`. Update `ProofEqCurve.tsx`'s `band.type <= 2`
check to a proper `if (type === 'peak' || type === 'lowShelf' ||
type === 'highShelf')`.

### 18. `<canvas>` interactions lack keyboard / a11y

**Problem:** `ProofEqCurve` has pointer-only drag; no keyboard
alternative. `MiniMeter` is a stack of `<div>`s with no
`role="meter"`. `←`/`→` chain reorder buttons have no `aria-label`.
True-peak overshoot, streaming-loudness overshoot, and Level5Lab
delta warnings are visual-only with no `role="alert"`.

**Representative files:**

- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:223-289`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:454-459, 730-744, 874-880, 949-973`
- `src/modules/Proof/presentations/components/ProofLimiterSection.tsx:131-135`

**Needed:** EQ canvas: add a list of focusable `<button>`s (one per
band) with aria-labels and keyboard adjustment. MiniMeter: replace
with `<meter>` or `role="meter"` with `aria-valuemin/-max/-now/-text`.
Reorder buttons: `aria-label="Move EQ left in chain"` etc., plus
an `aria-live="polite"` region announcing the new order. Warnings:
wrap in `<div role="alert" aria-live="polite">`.

### 19. Cross-module sub-path import (`#/modules/Arrangement/stores`)

**Problem:** `setProofParam.ts:1` imports `persistDeviceParam` from
`#/modules/Arrangement/stores`. AGENTS.md "Contract Boundaries":
cross-module imports must target the destination module's root
`index.ts`.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParam.ts:1`

**Needed:** Re-export `persistDeviceParam` from
`src/modules/Arrangement/index.ts`. Update Proof's import.
(`Arrangement/stores/persistDeviceParam.ts:1-11` deliberately
colocates with the store; that's fine. The fix is at the barrel
level, not the file level.) — note that this is also called out in
the Arrangement audit if one exists; cross-reference.

### 20. `useProofAnalyser` cleanup leaks on context replacement / connect failure

**Problem:** If `getMasterAnalyser()` returns a different node
between mount and cleanup, `masterAnalyser.disconnect(analyser)`
throws and the dangling `analyser` is leaked. If
`masterAnalyser.connect(analyser)` throws on mount, the early
`return undefined` skips cleanup — the constructed analyser is
held in memory until GC.

**Representative files:**

- `src/modules/Proof/presentations/hooks/useProofAnalyser.ts:35-95`

**Needed:** On connect failure, explicitly `analyser.disconnect()`
before returning. On cleanup, snapshot the master analyser
reference at connect time (don't re-call `getMasterAnalyser()`
inside the cleanup) so disconnect targets the right node.

### 21. `loadProofPatchWithAudio.ts` exports six "internal" helpers that the test treats as public

**Problem:** The file exports `syncEqBands`, `syncDynBands`,
`syncImager`, `syncExciter`, `syncFullPatch`, and
`loadProofPatchWithAudio`. Only the last two are intended cross-
module consumers; the first four are internal sequencing helpers.
The barrel re-exports only `syncFullPatch` (`useCases/index.ts:3`).
The spec asserts all six exports exist (`loadProofPatchWithAudio.spec.ts:11-35`)
— treating internals as test fixtures.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:7, 25, 48, 62, 78, 117`
- `src/modules/Proof/useCases/proofParamBridge/__tests__/loadProofPatchWithAudio.spec.ts:11-35`

**Needed:** Either split: move `syncEqBands`/`syncDynBands`/
`syncImager`/`syncExciter` into a private `syncBands.ts` (or
prefix with `_` and not export), or accept they're public and add
behavioural tests. Either way, drop the "should export X" tests.

### 22. `ProofPatch.eqBands` length is an array but the WASM contract is fixed-size 8

**Problem:** `ProofPatch.eqBands: Array<{ ... }>` (no length).
`DEFAULT_PATCH.eqBands` has 8 entries. The bridge sync
(`loadProofPatchWithAudio.ts:13`) iterates `patch.eqBands.length`,
so a 7-entry patch loaded from a presets-with-fewer-bands file
would silently leave band-7 at its previous WASM value. Same
issue for `dynBands` (length 4 expected), `excBands` (length 4),
`imgBandWidth` (typed correctly as a 4-tuple), `dynCrossoverFreqs`
(typed correctly as a 3-tuple).

**Representative files:**

- `src/modules/Proof/models/ProofPatch.ts:29-36, 41-50, 60-65`

**Needed:** Type as fixed-length tuples (e.g. `eqBands: [Band,
Band, Band, Band, Band, Band, Band, Band]`) so the compiler
catches preset mismatches. Or, validate `length` at the patch
boundary.

### 23. Updating tapPeaks by reference makes UI snapshots aliasing

**Problem:** `proofStore.ts:108` stores `meters.tapPeaks` directly.
If WASM ever reuses the array buffer, every previously-stored
snapshot would alias. The contract is currently safe (a fresh
object is built each tick), but the contract is undocumented and
untested.

**Representative files:**

- `src/modules/Proof/stores/proofStore.ts:108`
- `src/modules/AudioEngine/engine/ProofNode.ts:18-30` (contract
  source)

**Needed:** Either add a `meters.tapPeaks.map((p) => ({ ...p }))`
defensive copy at the boundary, or document the contract in the
type. Add a test that mutates the input `meters.tapPeaks` after
`updateProofMeters` and asserts the stored snapshot is unaffected.

### 24. Preset definitions use IIFE-in-`map` ladders with magic indices

**Problem:** Four occurrences of the same pattern with band indices
1 and 6 (low-shelf and high-shelf bands). No comment.

**Representative files:**

- `src/modules/Proof/useCases/proofPresets.ts:23-33, 60-71, 110-120, 124-134`

**Needed:** Helper `withBandAdjustments(bands, adjustments)` that
accepts a `Map<number, Partial<EqBand>>`. Replaces the IIFEs with
declarative `withBandAdjustments(bands, [[1, { gain: 1.5 }], [6, {
gain: 1.0 }]])`.

### 25. `ProofLimiterSection` redundant cast on `ditherMode`

**Problem:** `value={DITHER_VALUES.indexOf(patch.ditherMode as
(typeof DITHER_VALUES)[number])}` — the `as` is redundant; the
type already matches.

**Representative files:**

- `src/modules/Proof/presentations/components/ProofLimiterSection.tsx:146`

**Needed:** Drop the `as`.

### 26. `ProofPanel` is 1018 lines with five inline level components

**Problem:** Single file holds the panel shell, five level
components, three sub-components, four helpers. Every render of
any level re-creates closures for `onPatchChange`, `onSendParam`,
`onClick`, `onPress`. React Compiler can memoise some, but
splitting allows the Compiler clearer module boundaries.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx`

**Needed:** Extract `Level1Play.tsx`, `Level2Shape.tsx`,
`Level3Build.tsx`, `Level4Route.tsx`, `Level5Lab.tsx`, plus
`MiniMeter.tsx`, `KnobColumn.tsx`, `MeterCard.tsx`, into
`presentations/components/`. Keep `ProofPanel.tsx` for the shell.

### 27. No cross-link between local `ProofMeterData` and AudioEngine's

**Problem:** `proofStore.ts:16-28` defines `ProofMeterData` locally
with a comment. There is no compile-time check that the two stay
structurally compatible.

**Representative files:**

- `src/modules/Proof/stores/proofStore.ts:10-28`
- `src/modules/AudioEngine/engine/ProofNode.ts:18-30`

**Needed:** Use `satisfies`-pattern in the AudioEngine boundary —
e.g. add a function `dispatchProofMeters(deviceId: string, meters:
ProofMeterDataFromEngine)` in AudioEngine that forwards to
`updateProofMeters(deviceId, meters)`; the function signature
forces structural compatibility at compile time. Or, write a type-
level assertion: `type _Assert = ProofMeterData extends
EngineProofMeterData ? true : false; const _: _Assert = true;` in
a private `__tests__/types.ts` (Proof can't import from
AudioEngine/engine, so the assertion has to live in AudioEngine
verifying its type matches Proof's).

### 28. `Level5Lab.platformNormalizationTarget` literal strings (i18n gap)

**Problem:** Hard-coded marketing copy in a switch:
`'Spotify, Apple Music, and YouTube'`, `'broadcast television'`.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:812-817`

**Needed:** Add `react-i18next` keys (`proof.target.streaming`,
`proof.target.broadcast`, etc.) and translate via `t()`. Project
memory notes `react-i18next` is the chosen i18n library.

---

## Open questions

- [ ] Is the audio-side `ab_bypass` parameter intentional — i.e., is
      there a WASM param the engine recognises by that name, and the
      `setProofParam` call succeeds in flipping bypass at the engine
      end? If so, rename the parameter to follow the existing
      convention (`*_bypass` already covers per-module bypass) and
      document.
- [ ] Is the `ProofNode.setBypass` API (`AudioEngine/engine/ProofNode.ts:35`)
      currently wired to anything in Proof, or is it dead?
      `wasmDeviceRegistry.ts:531-538` exposes it on the controller;
      no Proof use case calls it.
- [ ] What is the source-of-truth for project save? Does
      `Project/.../resetModuleStoresToDefault.ts` reset the store
      and *then* a separate hydration step reads the saved patch
      from `Track.devices[*].parameterValues` and pushes it back?
      If so, confirming the round-trip is what should determine
      whether issue #2 (persistence) is a real bug or a
      misunderstanding of the load order.
- [ ] Is there a designated React Compiler escape valve for
      meter-rate updates, or should the meter store be split (issue
      #3)?
- [ ] Are the EQ filter type integers (`0..4`) part of the WASM
      contract or a Proof-side convention? If WASM defines them,
      issue #17 (use string-literal types) needs a translator at
      the bridge boundary.

---

## Risks

- **Data loss on project save/reload (issue #2).** Most user knob
  twists in `Level2Shape`, `Level4Route`, and the preset rail
  silently disappear. A user spends an hour dialling a master, hits
  save, reopens the project, and the patch is back to default. There
  is no telemetry or test that would flag this — the in-memory
  store and the engine *do* see the writes; only the persisted
  layer is missing. Highest-impact correctness issue.
- **Performance death spiral at meter rate (issue #3).** Every meter
  callback rebuilds the entire instances map and forces five canvas
  redraws + section re-renders. On low-end hardware or with multiple
  Proof instances on a project, the UI thread saturates, audio
  glitches because the message-port queue backs up, and the user
  blames "the audio engine".
- **Type-system erosion (issues #5, #17, #25).** `as never` and
  string-typed enums normalise the pattern; future contributors
  copy it and the module accumulates blind casts. AGENTS.md exists
  to prevent this; left unaddressed it sets a precedent.
- **Test theatre (issues #6, #7).** Fifteen spec files create the
  appearance of coverage and trip no flags in CI. A regression in
  preset loading, drag handling, or persistence will ship without
  any test failing. The first hint will be a user report.
- **Accessibility blocker (issue #18).** A keyboard-only user
  cannot operate the EQ canvas, cannot hear the chain-reorder
  swap, cannot perceive a clip warning. For an audio-engineering
  tool this is plausibly an audience exclusion (visually impaired
  audio engineers exist; mastering happens by ear).
- **Architectural drift (issues #1, #4, #19).** Lack of root barrel,
  view code mutating the store, sub-path cross-module imports —
  individually small, collectively normalising deviation.

---

## Suggested approaches

- **Land persistence first (issue #2).** Either every bridge use
  case calls `persistDeviceParam` per-write, or ProofNode reads the
  patch on init from `Track.devices[*].parameterValues`. The first
  is mechanical (a few lines per use case) and matches the existing
  `setProofParam` pattern; the second is cleaner long-term but
  requires AudioEngine changes. Pick (a) for the bug fix, then plan
  (b) as a follow-up.
- **Split the store and add selectors (issue #3).** A
  `proofMetersStore` keyed by deviceId that takes only meter writes
  is a small surface. `ProofPanel`'s outer shell subscribes to the
  patch store; only the meter-displaying components subscribe to
  the meter store. `useProofAnalyser` already isolates a high-rate
  visualisation cleanly — same pattern for meters.
- **Replace `setProofParamWithPatch` with a typed dispatch (issue
  #5).** A record `<Key, (bridge, patch[Key]) => void>` indexed by
  patch key. Each entry is type-safe by construction. Removes every
  `as` in the file and the `as never` in `ProofPanel`'s callers.
- **Convert the identity-only specs to behavioural specs (issue
  #6).** Mock `bridges` (or expose a `__test__resetBridges()` helper
  from `helpers.ts`), register a mock bridge, exercise the API,
  assert calls. This is the single most valuable change for
  long-term correctness.
- **Add a root `index.ts` (issue #1).** Three lines re-exporting
  the existing curated surface. Update three external import sites.
- **Group i18n / a11y / magic-number cleanups (issues #11, #12,
  #18, #28).** A single "polish pass" PR can land them together.
- **EQ canvas correctness (issue #8) is independent.** Tackle it
  separately; uses the Web Audio response API.

---

## Recommendation

Start with **issue #2 (persistence)**. It is the only correctness
bug with user-visible data loss. The fix is per-use-case: forward
each parameter write to `persistDeviceParam` exactly as
`setProofParam` already does. Add a behavioural test for the round-
trip (set knob → save store → reset → hydrate → assert patch
restored).

In parallel, **issue #6 (test theatre)**. Without behavioural tests
the persistence fix has no safety net, and fixes #3, #5, and #8 will
each ship without coverage. The bridge mock pattern from issue #6
unlocks every other test.

Then **issue #3 (meter-rate render storm)** because it's the
performance ceiling on the module — and once tests exist (issue
#6), splitting the store is mechanical.

Issues #5, #8, #18 are independent follow-ups.

---

## Resolved

_No issues resolved yet._
