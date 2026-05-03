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

### Adversarial review log (2026-04-28)

**Verified against source as of HEAD.** Re-walked every cited file:line and
confirmed/refuted each open issue. Key results:

- **Issue #6 / open issue #4 (A/B bypass) — partially WRONG.** The audit
  asserts the engine "doesn't actually have an `ab_bypass` parameter". It
  does — `crates/daw-dsp/src/proof/chain.rs:106` matches `"ab_bypass"`
  and toggles `self.ab_bypass`, which gates the dry/wet bypass with a
  `ab_gain_offset` (chain.rs:175-185). So `setProofParam(deviceId,
  'ab_bypass', 1)` *does* flip a real engine param. The remaining
  problems (view-code mutating store, no setProofAbBypass use case,
  `ab_bypass` not part of `syncFullPatch` so it's not restored on engine
  init) are real. Demoted from "mis-wired contract drift" to "scope drift +
  missing restore wiring". See updated open issue #4.
- **Issue #4 / open issue #3 (meter rate) — PROMOTED.** Confirmed
  `setInterval(..., 16)` in `ProofNode.ts:120` produces ~60 Hz callbacks,
  not 30-60 Hz. Each tick allocates 6 fresh `tapPeaks` objects + dynGr
  array + the spread instances/state map. At ~60 Hz this is ~480
  allocations/sec per Proof instance. With one project = potentially
  multiple Proof instances open this compounds. Severity stays high.
- **Issue #16 / open issue #23 (tapPeaks reference) — DEMOTED.**
  `ProofNode.ts:109-116` constructs a fresh `tapPeaks` array on every
  poll tick, so aliasing is not currently possible. Worth keeping as a
  contract test, not a correctness defect.
- **Issue #19 / open issue #10 (silent no-op on missing bridge) —
  PROMOTED.** Cross-checked `wasmDeviceRegistry.ts:495-542`. Note that
  the **WASM placeholder** has a `pendingParams` queue (line 495-511)
  that flushes on load — but that queue is on `nativeDspControls`, not
  on the `bridges` map that `setProofParam` reaches. So early UI knob
  writes that go through `setProofParam` (via `bridges.get(...)?.…`)
  silently drop while the in-progress `createProofNode` flushes its
  own queue from `nativeDspControls` writes. Two queues, two fates,
  one device. New issue #58 captures this dual-queue divergence.
- **Issue #2 / open issue #2 (persistence gap) — VERIFIED + EXTENDED.**
  Confirmed: `TrackNode.addDevice` (`AudioEngine/engine/TrackNode.ts:401-421`)
  calls `findWasmDescriptor(...).create(...)` for `proof` and **never
  iterates `device.parameterValues`** to push them through the bridge.
  The only path that does is `NativeDspDeviceStrategy.createNativeDspStrategy`
  (`repositories/deviceStrategy/NativeDspDeviceStrategy.ts:93-95`),
  which is on the **offline-render** path through `buildDeviceChain`.
  So the bug surface is asymmetric: live-edit then save → reload-live
  shows defaults, but **the offline render of the same project applies
  the saved `parameterValues`**. So a master that *sounds correct on
  export* shows blank knobs in the live UI. This is worse than the
  audit captured. Updated open issue #2.
- **New issue #58 — Two divergent param queues (`nativeDspControls` vs
  `bridges`).**
- **New issue #59 — `ProofNode.setParam` silently drops boolean values
  via `Number.isFinite(value)`** (`ProofNode.ts:132`). Booleans are not
  `isFinite` ⇒ silent drop. Combined with finding #12 (boolean →
  number conversion is inconsistent across sections), any unconverted
  boolean reaches the worklet, dies there.
- **New issue #60 — `setParam` is bypass-gated at the worklet wrapper.**
  `ProofNode.ts:132` predicates the postMessage on `!bypassed`. So
  while `setBypass(true)` is in effect every UI param write is silently
  swallowed by the bridge layer. The audit missed this entirely.
- **New issue #61 — `ProofPanel.spec.tsx` mocks `useStore` with `(store,
  defaultValue) => defaultValue` and renders `<ProofPanel />` without a
  `deviceId`.** When the mock returns `{}` and `state` falls back to
  `getProofState(undefined)`, the test's render goes through the entire
  panel with `deviceId === undefined`, which then propagates to every
  `setProofParam(undefined, …)` and `bridges.get(undefined)` call site.
  None of the existing tests trigger those handlers, so the broken
  state never surfaces — but a future test that clicks a chip would
  send `'ab_bypass'` to a `bridges.get(undefined)` lookup. The spec
  isn't just type-broken (issue #14); it teaches future writers a
  poisoned pattern.
- **New issue #62 — `ProofEqCurve` `peakingMag` formula treats
  positive- and negative-gain peaking filters asymmetrically.** Lines
  35-38: `A = 10^(gainDb/40)`, then `num = (1-w²)² + (bw·A)²` and
  `den = (1-w²)² + (bw/A)²`. For `gainDb < 0`, `A < 1`, so the
  numerator denominator pair flips sign-style and the resulting
  `10·log10(num/den)` is the **inverse** of what it should be. Cuts
  display as boosts. Combined with #28 (shelves rendered as bumps),
  the EQ curve is misleading for **every band type with negative
  gain** plus shelves. The audit lumped this into #28; it deserves
  its own line.
- **New issue #63 — `proofStore.set({})` on project reset destroys
  every `uiLevel` selection.** `resetModuleStoresToDefault.ts:36`
  resets to `{}`, but `uiLevel` is `ProofState`-only (not `ProofPatch`),
  so re-loading the project rehydrates `parameterValues` (in offline
  render only — see open issue #2) but never the UI level. The user's
  "Lab" view becomes "Play" on every reload.
- **New issue #64 — `ProofEqCurve` HP/LP types 3/4 fall through the
  `band.type <= 2` guard at line 134** but the dot-render loop at
  186-220 has **no type guard**, so a HP at 30 Hz with `enabled: true`
  appears as a coloured dot floating at zero gain on the canvas with
  no visible curve and no per-band fill. The drag handler at 253-273
  then **mutates `freq` and `gain` regardless of type** — dragging a
  HP band up the y-axis sets `gain` even though Q (not gain) is the
  meaningful Y-axis param for HP/LP. This is a UX correctness bug
  beyond the rendering bug in #27.
- **New issue #65 — `getProofState` is called from a `useStore`
  fallback path on every render that lands on missing data**
  (`ProofPanel.tsx:174`). Each call returns
  `{ ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } }` — a
  freshly-allocated object with a freshly-allocated patch. **All
  child components see this as a different state object every
  render**, breaking React Compiler's render bailouts. The original
  audit's #7 noted this; what was missed is that `DEFAULT_PROOF_STATE`
  itself contains an inner `tapPeaks` array allocated once at module
  init via `Array.from(...)` (`proofStore.ts:61`). The spread copies
  the reference of that *singleton* array, so two parallel `ProofPanel`
  instances each rendering the fallback share the same tapPeaks
  reference. That's safe today, but `tapPeaks` is then meant to be
  mutated/written by `updateProofMeters`. If a future code path
  mutates a tapPeaks element via the fallback path, it corrupts the
  module-global default. Defensive cloning needed at the fallback.
- **New issue #66 — `setProofParamWithPatch` does not handle the
  `target`, `targetLufs`, or `name` keys.** Lines 20-69 enumerate
  every other key but the `Mission` panel chip (`ProofPanel.tsx:219-227`)
  fires `setProofParamWithPatch(deviceId, 'target', option.value)`
  and `setProofParamWithPatch(deviceId, 'targetLufs', option.lufs)`.
  The function calls `updateProofPatch(deviceId, { [key]: value })`
  (line 13) which lands in the store, but then the if/else chain
  has no branch for `target` or `targetLufs`, so the bridge gets
  nothing. That's correct because the engine has no target param,
  but it's silent — no `default` branch to assert that an unknown
  key was a UI-only field. A typo (`'targe'`) would silently update
  the patch with a junk field and no engine forward. Type-safe in
  declaration (`Key extends keyof ProofPatch`) but defensive coding
  would assert exhaustiveness.
- **New issue #67 — `Level1Play` target buttons use deprecated chip
  pattern duplicated from the rail.** `ProofPanel.tsx:407-423` is a
  plain `<button>` with no `DawPluginChip` wrapper, even though the
  rail at line 211-227 uses `DawPluginChip`. Two implementations of
  the same UI element with different a11y/styling. Pick one.
- **New issue #68 — `proofPresets.ts` `preset` factory drops user-
  facing display name into the patch.** Line 14: `patch: { ...DEFAULT_PATCH,
  ...overrides, name }` overwrites `patch.name` with the preset's
  `name` argument (e.g. `'Streaming Master'`). `DEFAULT_PATCH.name`
  is `'Init'`. This means the patch's `name` field is reused as both
  a save/restore identifier and a UI display label, conflating
  identity with presentation. `ProofPanel.tsx:193` uses
  `preset.patch.name === patch.name` to mark the preset row active —
  so loading a preset, then editing one knob, leaves the preset
  marked active even though the patch has diverged. Pick a different
  identity field (`patch.id` or hash) or drop `name` from `ProofPatch`
  altogether and keep it on the preset.
- **New issue #69 — `formatLufs` boundary check uses `<= -100` magic
  literal in three places.** `ProofPanel.tsx:60, 68` and the
  surrounding components. `-100` is the sentinel "no signal" value
  defined in `DEFAULT_PROOF_STATE` (`proofStore.ts:52-56`); it's the
  initial-value-meaning-nothing convention. Promote to a named
  constant `SILENT_LUFS_SENTINEL`. Same kind of bug as #11 (the +1
  threshold).
- **New issue #70 — `LoudnessHistory` history is keyed solely on
  `momentaryLufs` deps**, but the component is rendered every meter
  tick (issue #4). The `useEffect` at `LoudnessHistory.tsx:53-182`
  re-runs and **re-pushes a new history sample on every `momentaryLufs`
  change** — i.e. ~60 times per second when the audio is live. The
  comment claims "~10 fps" (line 5) but the real rate is the meter
  rate. The 300-sample buffer therefore covers 5 seconds at 60Hz, not
  30 seconds at 10Hz as the comment claims. **Documentation lies and
  the time axis is silently 6× shorter than advertised.**
- **New issue #71 — `LoudnessHistory` grid loop has dead branches.**
  Line 89: `db === -14 || db === -24` — but the iteration is over
  `[-6, -12, -18, -24, -36, -48]`. `-14` is never in that array;
  `-24` is. So the `-14` branch is dead. Either the original intent
  was a target-line sentinel that should be `targetLufs` (the dashed
  line below already handles that) or it's a typo. Either way, dead.

---

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

1. **Persistence path is broken AND asymmetric** (open issue #2,
   findings #9-#11, #32). Half of UI writes never persist;
   the half that do persist are not restored by the live runtime
   but ARE applied by offline render. Live UI and exported audio
   disagree after reload. Highest-impact correctness issue.
2. **Render storm at meter rate** (open issue #3, findings #4, #7,
   #20, #29, #41). Every meter tick rebuilds the entire `proofStore`
   instances map and triggers a re-render of `ProofPanel` and every
   section. `LoudnessHistory` writes its history buffer at 6× the
   documented rate, compounding. The single largest performance
   issue in the module.
3. **EQ canvas correctness has three independent bugs** (open issues
   #8, #33, #35). Shelf filters render as bumps; negative-gain
   peaks render mirrored; HP/LP draggable dots edit `gain` (which
   WASM ignores) with no curve drawn. Drag fires uncoalesced
   store updates at pointer rate.
4. **A/B bypass UI is mis-wired** (open issue #4, finding #6).
   View code reaches around the use-case layer; `syncFullPatch`
   doesn't restore the flag. (The audit's earlier "engine doesn't
   recognise the param" claim was wrong — corrected in this pass.)
5. **Two divergent param queues** (open issue #29). Bridge writes
   between device construction and Proof bridge registration
   silently drop while the parallel `nativeDspControls` queue
   succeeds. Race-window bug.
6. **Type-soundness escapes** (open issues #5, #17, #25). `as never`
   and `as` casts in `setProofParamWithPatch` and `Level2Shape`'s
   knob handlers; AGENTS.md explicitly forbids them. Replacing with
   a typed dispatch closes both the cast and the parameter-shape
   mismatch.
7. **No real test coverage** (open issues #6, #7, #32, finding
   #15, #56). Eight identity-only tests + six "renders" tests
   cover nothing. `ProofPanel.spec.tsx` actively certifies the
   broken `deviceId === undefined` state as baseline. Bridge
   forwarding, persistence, drag handling, preset loading — all
   uncovered.
8. **Worklet wrapper silently drops writes** (open issues #30, #31).
   `Number.isFinite` filter eats booleans; `!bypassed` gate eats
   writes during `setBypass(true)`. Defensive coding hides bugs.
9. **Module has no root `index.ts`** (open issue #1, finding #36).
   The cross-module public surface is ad-hoc; AGENTS.md "Barrel
   files" mandates a root barrel.

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

### 2. Persistence is missing for `setProofParamWithPatch` / `reorderChain` / `loadProofPatchWithAudio` (and the live-reload path silently swallows what *is* persisted)

**Problem:** Two compounding bugs.

**(a) Half the writes never persist.** `setProofParam` calls
`persistDeviceParam`; the typed-key variants
(`setProofParamWithPatch`, `reorderChain`, `loadProofPatchWithAudio`
and the `syncFullPatch` it triggers) do not. Every UI write that
goes through these paths is lost on save: the in-memory store and
the engine know the new value, but `Track.devices[*].parameterValues`
does not.

**(b) Of the writes that *are* persisted, the live runtime never
reads them back.**
`AudioEngine/engine/TrackNode.ts:401-421` is the live path for
WASM Proof devices. It calls
`findWasmDescriptor(...).create(...)` and never iterates
`device.parameterValues` to push values through the bridge. The
*only* path that does this is
`AudioEngine/repositories/deviceStrategy/NativeDspDeviceStrategy.ts:93-95`,
which is reached via `buildDeviceChain` for **offline render**.
Net effect: a project saved through `setProofParam`-only knobs
(`Level3Build` controls — see #32) reloads with **`Track.devices[*].parameterValues`
intact**, the live UI shows the persisted patch *only because the
patch lives in `proofStore` (which is reset to `{}` on load —
issue #4 of the new findings)*. Wait — actually `proofStore` is
reset (`resetModuleStoresToDefault.ts:36`) and never repopulated
from `parameterValues`. So even the values that are persisted to
disk show as defaults on the live UI, while the same project
exported as offline render uses the saved `parameterValues`
correctly. **The audible mix and the visible UI disagree after a
reload.**

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:13-69`
- `src/modules/Proof/useCases/proofParamBridge/reorderChain.ts:5-8`
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:78-120`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:550, 584, 596, 769, 786`
- `src/modules/AudioEngine/engine/TrackNode.ts:401-421` (live path
  doesn't apply `parameterValues`)
- `src/modules/AudioEngine/repositories/deviceStrategy/NativeDspDeviceStrategy.ts:93-95`
  (offline path does)
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:36`
  (proofStore wiped on load, never rehydrated from track.devices)

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

### 4. A/B bypass mutates the store from view code (mis-routed, but the param IS real)

**Problem (corrected):** `ProofPanel.tsx:347-358` reaches `proofStore.value`
and calls `proofStore.set(...)` directly inside an `onClick`
handler. It also calls `setProofParam(deviceId, 'ab_bypass', ...)`.
**The original audit asserted the engine does not have an `ab_bypass`
parameter — that is wrong:** `crates/daw-dsp/src/proof/chain.rs:106`
matches `"ab_bypass"` and toggles `self.ab_bypass`, which gates
dry/wet bypass with auto level-matching (`ab_gain_offset`,
chain.rs:175-185). So the engine call succeeds. What the audit
got *right*:

- View code reaches around the use-case layer to mutate the store.
- There's no `setProofAbBypass(deviceId, value)` use case.
- `syncFullPatch` (`loadProofPatchWithAudio.ts:78-115`) does not
  forward the `abBypass` flag — so on engine reload the toggle is
  lost (the WASM chain comes back up with `ab_bypass: false` from
  `chain.rs:98`).
- `persistDeviceParam(deviceId, 'ab_bypass', ...)` writes
  `Track.devices[*].parameterValues.ab_bypass`, but
  `TrackNode.addDevice` for WASM devices doesn't push
  `parameterValues` through the bridge (verified at
  `AudioEngine/engine/TrackNode.ts:401-421`). So the field is
  persisted to the project file and consumed only by the offline
  render path (`NativeDspDeviceStrategy.createNativeDspStrategy:93-95`).
  Live reload doesn't see it.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:346-369`
- `src/modules/Proof/stores/proofStore.ts` (no `setProofAbBypass`)
- `src/modules/Proof/useCases/proofParamBridge/loadProofPatchWithAudio.ts:78-115`
  (syncFullPatch doesn't include `ab_bypass`)
- `crates/daw-dsp/src/proof/chain.rs:106, 175-185` (real engine param)
- `src/modules/AudioEngine/engine/TrackNode.ts:401-421` (live path
  drops `parameterValues` for WASM devices)

**Needed:**

- Add a `setProofAbBypass({ deviceId, value })` use case that
  (a) updates `proofStore` via a dedicated mutator, (b) forwards to
  `bridges.get(deviceId)?.setParam('ab_bypass', value ? 1 : 0)`, and
  (c) calls `persistDeviceParam(deviceId, 'ab_bypass', value ? 1 : 0)`.
- Remove the direct `proofStore.set(...)` call from `ProofPanel.tsx:357`.
- Add `bridge.setParam('ab_bypass', state.abBypass ? 1 : 0)` to
  `syncFullPatch` so the engine restores the flag on reload (or
  treat A/B as ephemeral and don't persist it — pick one).
- Either way, fix the live-reload `parameterValues` gap (open issue #2).

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

### 29. Two divergent param queues: `nativeDspControls` vs `bridges`

**Problem:** `wasmDeviceRegistry.ts:495-511` registers a
`nativeDspControls.setParam` that pushes into a local
`pendingParams: Array<[string, number]>` while `createProofNode`
is loading; on resolve it flushes that queue at line 509. **A
separate** `bridges` map (Proof's, in `helpers.ts:7`) is registered
*at line 518* — only after the queue flush. The result: any
parameter write that reaches `nativeDspControls.setParam` between
device construction and bridge registration is queued and applied
correctly. But UI knob writes go through
`setProofParam` → `bridges.get(deviceId)?.setParam(...)`, which
returns `undefined` for that interval and silently drops. Two queues,
two fates.

**Representative files:**

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:495-511, 518-522`
- `src/modules/Proof/useCases/proofParamBridge/helpers.ts:7`
- `src/modules/Proof/useCases/proofParamBridge/setProofParam.ts:5-8`

**Needed:** Either (a) `registerProofDevice` flushes a Proof-side
`pendingParams` map alongside (mirroring the WASM registry), or
(b) `setProofParam` falls back to the `nativeDspControls` queue
exposed via the device registry while waiting. Or, simpler: drop
the dual queues and have `setProofParam` write directly to
`nativeDspControls.setParam` via a lookup, eliminating the second
map entirely.

### 30. `ProofNode.setParam` silently drops boolean values via `Number.isFinite`

**Problem:** `ProofNode.ts:132`:
```ts
setParam(name: string, value: number) {
    if (!bypassed && Number.isFinite(value)) {
        node.port.postMessage({ type: 'param', name, value });
    }
}
```
`Number.isFinite(true)` is `false`. Any boolean that arrives
unconverted at the bridge gets dropped silently. Combined with
finding #12 (booleans handled inconsistently across sections —
`ProofExciterSection` and `ProofDynSection` have explicit `typeof
value === 'boolean'` guards but the toggles in section files do
ad-hoc `? 1 : 0` conversion at every call site), a future regression
in a single section would leak booleans straight through to the
worklet wrapper, which says nothing. No log, no warn.

**Representative files:**

- `src/modules/AudioEngine/engine/ProofNode.ts:131-135`
- `src/modules/Proof/presentations/components/ProofDynSection.tsx:41-49`
- `src/modules/Proof/presentations/components/ProofExciterSection.tsx:25-32`

**Needed:** Either tighten the type at the bridge (`setParam(name:
string, value: number)` with a runtime assertion that throws or
warns on non-finite/non-number) or add a `setBoolParam(name, value)`
overload at the engine boundary that handles the conversion in one
place.

### 31. `ProofNode.setParam` is bypass-gated; UI writes vanish under `setBypass(true)`

**Problem:** `ProofNode.ts:132`: `if (!bypassed && Number.isFinite(value))`.
While `setBypass(true)` is in effect, every parameter write is
silently swallowed at the wrapper. A user toggling bypass to
audition the unprocessed signal, then nudging a knob, then toggling
bypass off, **sees the patch back at its pre-bypass value** — the
nudges are lost. `wasmDeviceRegistry.ts:531-538` exposes `setBypass`
on the controller, but no Proof use case calls it (the A/B bypass
goes through `setParam('ab_bypass', ...)`). Today this is dormant;
once a future caller wires it up, the behaviour is silently broken.

**Representative files:**

- `src/modules/AudioEngine/engine/ProofNode.ts:131-139`

**Needed:** Drop the `!bypassed` gate from `setParam` — the engine
itself can check `bypassed` inside the worklet's `process()`. The
wrapper's job is transport, not policy. Or, document the contract
loudly so a future caller doesn't expect knob writes to land while
bypassed.

### 32. `ProofPanel.spec.tsx` mock teaches a poisoned pattern

**Problem:** `ProofPanel.spec.tsx:6-8` mocks `useStore` with
`(store, defaultValue) => defaultValue`. The four `render(<ProofPanel />)`
calls pass no `deviceId`, so the component runs with
`deviceId === undefined`. `state` falls back to
`getProofState(undefined)`, the panel renders, and the chip
handlers never fire — so the broken contract is invisible. A
future test that fires a click would call `setProofParam(undefined,
'ab_bypass', 1)` and `bridges.get(undefined)`, both returning
`undefined`, both silent. The spec doesn't just under-cover —
it *certifies* the broken state as the testing baseline.

**Representative files:**

- `src/modules/Proof/presentations/views/__tests__/ProofPanel.spec.tsx:6-8, 16-32`

**Needed:** Replace the mock with a real `proofStore.set(...)`
seed in `beforeEach`. Pass `deviceId="test-1"`. Register a mock
bridge in `beforeEach`. Assert behaviours, not "renders without
crashing".

### 33. `ProofEqCurve.peakingMag` mis-renders both shelves AND negative-gain peaks

**Problem:** `ProofEqCurve.tsx:27-39`:
```ts
const A = 10 ** (gainDb / 40);
const num = (1 - w2) ** 2 + (bw * A) ** 2;
const den = (1 - w2) ** 2 + (bw / A) ** 2;
return 10 * Math.log10(num / den);
```
For `gainDb < 0`, `A < 1` so `bw·A < bw/A` ⇒ `num < den` ⇒
`log10(num/den) < 0`. The signed magnitude IS reported — but the
formula is the **standard peaking-EQ magnitude** which only fits
peak filters (type 0). For low-shelf and high-shelf (types 1, 2),
the response asymptotes to `gainDb` at one extreme and `0 dB` at
the other; the formula renders a symmetric bell instead. **A
6 dB low-shelf at 80 Hz displays as a peak centred on 80 Hz with
zero response below 40 Hz** — the opposite of an actual low-shelf.
The audit's #28 correctly flagged the shelf mis-render but missed
that even the peaking case displays incorrectly for negative-gain
cuts because the formula's symmetry assumption breaks down on the
inverse-A side. (The cut ends up displayed mirrored.)

**Representative files:**

- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:27-39, 134-141`

**Needed:** Replace the hand-rolled magnitude with the Web Audio
API's `BiquadFilterNode.getFrequencyResponse(...)` against a
transient `OfflineAudioContext` node (or a math-correct biquad
magnitude per type — RBJ cookbook formulas exist). Add a snapshot
test per band type & sign combination.

### 34. `proofStore.set({})` on project reset destroys UI level

**Problem:** `Project/.../resetModuleStoresToDefault.ts:36`
sets `proofStore.set({})`. `uiLevel` is on `ProofState`, not
`ProofPatch`, so even if patch persistence worked (it doesn't —
issue #2), the user's selected desk depth (`Play`/`Shape`/`Build`/
`Route`/`Lab`) reverts to the default `1` on every project reload.
Same for `abBypass`.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:36`
- `src/modules/Proof/stores/proofStore.ts:32, 46` (uiLevel,
  abBypass live on ProofState only)

**Needed:** Decide whether `uiLevel`/`abBypass` are session-scoped
(then this is correct) or project-scoped (then they need a
persistence target — Track.devices[*].uiState or a Proof-side
saved subset). Document the decision.

### 35. `ProofEqCurve` HP/LP bands have no curve, no Q axis on drag, but do drag freq/gain

**Problem:** `ProofEqCurve.tsx:128-141` skips bands with `band.type
> 2` from the curve summation, so HP/LP types render no filled
band, no glow, no combined-curve contribution. But the dot loop
(line 186-220) has no type guard — the dot is drawn at
`(band.freq, band.gain)`. For HP/LP, `gain` is **meaningless**
(filter has unity passband and -∞ stopband; Q sets the resonance
peak height). Drag handler (line 253-273) writes `freq` and
`gain` regardless of band type. So a HP at 30 Hz, dragged up the
y-axis, sets its `gain` to 12 dB — which Rust EQ silently ignores
(the WASM HP/LP code path uses `freq` and `q` only,
`crates/daw-dsp/src/proof/eq.rs:64-65`) — and the dot moves
visually but the audio doesn't change.

**Representative files:**

- `src/modules/Proof/presentations/components/ProofEqCurve.tsx:128-141, 186-220, 253-273`
- `crates/daw-dsp/src/proof/eq.rs:60-65`

**Needed:** Either (a) implement the correct HP/LP magnitude curves
and let the dot represent (`freq`, `q`), with the y-axis switching
between gain-axis (peak/shelf) and Q-axis (HP/LP) per band; or
(b) hide the dots for HP/LP types and provide a separate Q knob
in `ProofEqSection`.

### 36. `getProofState` fallback shares `tapPeaks` reference with the module-level default

**Problem:** `proofStore.ts:70-72` returns
`{ ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH } }` — a
shallow spread. `DEFAULT_PROOF_STATE.tapPeaks` is a singleton
`Array.from(...)` allocated at module init (line 61). Every
fallback-state instance reads the **same** `tapPeaks` reference
as every other fallback-state instance, **and** as `DEFAULT_PROOF_STATE`
itself. Today nothing mutates an array element via the fallback
state, so this is dormant. A future code path that does (e.g.
animation interpolation, or a "snapshot the meters for later
comparison" feature) would corrupt the module-global default and
poison every subsequent `getProofState` call.

**Representative files:**

- `src/modules/Proof/stores/proofStore.ts:49-72`

**Needed:** Deep-clone the fallback:
`{ ...DEFAULT_PROOF_STATE, patch: { ...DEFAULT_PATCH }, tapPeaks:
DEFAULT_PROOF_STATE.tapPeaks.map((p) => ({ ...p })), dynGr:
[...DEFAULT_PROOF_STATE.dynGr] }`. Or, freeze
`DEFAULT_PROOF_STATE` deeply with `Object.freeze` on all reachable
arrays/objects so any future mutation throws in dev.

### 37. `setProofParamWithPatch` accepts `target`/`targetLufs`/`name` keys silently

**Problem:** `setProofParamWithPatch.ts:13` does
`updateProofPatch(deviceId, { [key]: value })` for *any* key that
extends `keyof ProofPatch`, then dispatches on key in a long
if/else chain (lines 20-69). `target`, `targetLufs`, `name` are
valid `keyof ProofPatch` values, so the patch update lands, but
no else-if branch handles them ⇒ the bridge gets nothing. Today
that's correct (the engine doesn't have these params), but
there's no `default:` case to assert UI-only keys, no exhaustive
union check, no comment. A typo in a future caller (`'targe'`)
would either fail at compile time (good) or, if the caller widens
the key type with an `as`, silently update a junk patch field.

**Representative files:**

- `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts:13-69`

**Needed:** After the if/else chain, add a `// fallthrough` comment
for known UI-only keys (`name`, `target`, `targetLufs`) and a
`default:` arm that asserts the key is one of those, throwing in
dev. Or, split the function: one for engine params (typed via a
discriminated dispatch table — issue #5), one for UI-only patch
fields.

### 38. `Level1Play` target buttons use plain `<button>` instead of `DawPluginChip`

**Problem:** `ProofPanel.tsx:407-423` is a styled `<button>` with
a hand-rolled active class. The same conceptual element (target
selector) is implemented as `DawPluginChip` in the rail at line
214-227. Two implementations means two a11y stories, two style
sources of truth.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:211-227, 407-423`

**Needed:** Replace the hand-rolled button with `DawPluginChip` in
`Level1Play`. Match the rail's pattern.

### 39. `proof preset.patch.name` overwrites `DEFAULT_PATCH.name` and conflates identity with display

**Problem:** `proofPresets.ts:13-15`:
```ts
function preset(id, name, category, overrides): ProofPreset {
    return { id, name, category, patch: { ...DEFAULT_PATCH, ...overrides, name } };
}
```
The trailing `name` overwrites `patch.name` with the preset's
display name. `ProofPanel.tsx:193` uses
`preset.patch.name === patch.name` to mark the preset row active.
After a user loads "Streaming Master" then nudges a knob, the
patch is no longer the streaming preset — but `patch.name` is
still `'Streaming Master'`, so the row stays active. Active-state
logic is broken whenever the patch diverges from the preset.

**Representative files:**

- `src/modules/Proof/useCases/proofPresets.ts:13-15`
- `src/modules/Proof/presentations/views/ProofPanel.tsx:193`

**Needed:** Either (a) drop `name` from `ProofPatch` and put it on
`ProofPreset` only, or (b) introduce a `presetId: string | null`
field on `ProofPatch` that is set when loading and cleared on the
first patch mutation. (b) preserves the active-state UX correctly.

### 40. `formatLufs`/`-100 LUFS` sentinel duplicated; magic literal everywhere

**Problem:** `ProofPanel.tsx:60` (`if (v <= -100)`), line 68 (same
for dB), and at least three other comparison sites (`453, 809, 911`)
use the literal `-100` to mean "no signal". `DEFAULT_PROOF_STATE`
seeds the field with `-100` (`proofStore.ts:52-56`). Same magic
literal scattered across UI code.

**Representative files:**

- `src/modules/Proof/presentations/views/ProofPanel.tsx:60, 68,
  453, 809, 910-911`
- `src/modules/Proof/stores/proofStore.ts:52-56`

**Needed:** Define `LUFS_SENTINEL_NO_SIGNAL = -100 as const` in
`models/ProofPatch.ts` (or a `models/proofMeterConstants.ts`).
Use everywhere. Add a helper `isLufsSignal(v: number): boolean`
that returns `v > LUFS_SENTINEL_NO_SIGNAL`.

### 41. `LoudnessHistory` advertises 10 fps but actually pushes at meter rate (~60 Hz)

**Problem:** `LoudnessHistory.tsx:5, 22` claim the component
updates at "~10fps" with a "300-sample / 30-second" buffer. The
`useEffect` at line 53-182 deps on `momentaryLufs` — which the
parent passes from `state.outputLufs`, mutated at every meter
tick (~60 Hz, see issue #4). So a sample lands every ~16 ms and
the 300-sample buffer covers **5 seconds**, not 30. The time axis
on the graph is therefore 6× shorter than the documentation
implies. Even worse: the component does its own re-render-driven
history-write at meter rate, compounding issue #4's render storm.

**Representative files:**

- `src/modules/Proof/presentations/components/LoudnessHistory.tsx:5, 22, 53-58, 182`

**Needed:** Throttle history writes via rAF to ~10 fps inside
`useEffect`. Or, accept ~60 Hz and bump `HISTORY_LENGTH` to 1800
to cover 30 s. Either way, fix the comment.

### 42. `LoudnessHistory` grid has dead `db === -14` branch

**Problem:** `LoudnessHistory.tsx:89`:
```ts
ctx.strokeStyle = db === -14 || db === -24 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.035)';
```
The iteration at line 87 is `[-6, -12, -18, -24, -36, -48]`. `-14`
is never produced, so the branch is dead. `-24` *is* produced,
making the highlight inconsistent (only `-24` is highlighted, not
`-14`). Either intent was to highlight the streaming target line
(`targetLufs = -14`), in which case the dashed line at line 96-116
already does that and this branch is redundant — or it's a typo.

**Representative files:**

- `src/modules/Proof/presentations/components/LoudnessHistory.tsx:87-93`

**Needed:** Remove the dead `-14` branch. Decide whether the
`targetLufs` should drive a per-frame grid highlight (then thread
it through) or whether the dashed line at 96-116 is sufficient
(probably is).

### 43. `useProofAnalyser` hook sample rate dependency lies about stability

**Problem:** `useProofAnalyser.ts:99-103` returns `sampleRate:
getAudioSampleRate()` — a function call evaluated on every hook
invocation. The hook is invoked on every parent render (Level5Lab,
which re-renders at meter rate via #4). Each call returns the same
number in practice, but a consumer using `sampleRate` in a
`useEffect` deps array would technically be safe — except the
returned object is freshly constructed each call, so any consumer
that diffs **the whole object** would see infinite changes. The
audit's #18 noted the symptom; the deeper issue is that the hook
violates "stable reference for stable data" by allocating a new
object literal on every render.

**Representative files:**

- `src/modules/Proof/presentations/hooks/useProofAnalyser.ts:98-103`

**Needed:** Cache the stable parts (`sampleRate`, `fftSize`) in a
ref or just accept the React Compiler will memoize. But removing
the function call in the return path makes the contract honest:
move `getAudioSampleRate()` into the `useEffect` body and store
it in state.

---

## Open questions

- [x] **(answered)** Is the audio-side `ab_bypass` parameter
      intentional? **Yes** — `crates/daw-dsp/src/proof/chain.rs:106`
      handles it as a real engine param; `chain.rs:175-185` is the
      gain-matched dry/wet bypass. The audit's earlier "engine
      doesn't recognise it" claim was wrong; see updated open
      issue #4. The remaining problem is that `syncFullPatch`
      doesn't restore it on engine init, and that
      `Track.devices[*].parameterValues.ab_bypass` is persisted
      but the live-reload path never reads it (issue #2).
- [x] **(answered)** Is `ProofNode.setBypass` wired? It's called
      by `wasmDeviceRegistry.ts:531` (exposed on the controller)
      and the offline `NativeDspDeviceStrategy.setBypass`. **No
      Proof use case calls it directly.** A/B bypass routes through
      `setParam('ab_bypass', ...)` instead. The two bypass
      mechanisms are different: `setBypass` is process-bypass
      (the worklet's `process()` short-circuits, no metering, no
      latency reporting); `ab_bypass` is dry/wet at the chain head
      with full metering on the dry signal. Document the
      distinction.
- [x] **(answered)** Source-of-truth for project save?
      `Project/.../resetModuleStoresToDefault.ts:36` resets
      `proofStore.set({})` and **never repopulates** the patch
      from saved data. `Track.devices[*].parameterValues` is the
      persistence target, but the live runtime
      (`AudioEngine/engine/TrackNode.ts:401-421`) doesn't push
      `parameterValues` through the WASM bridge. Only the offline
      render path (`NativeDspDeviceStrategy.createNativeDspStrategy:93-95`)
      does. Confirms issue #2 as a real bug — and adds the
      asymmetric live/offline aspect.
- [ ] Is there a designated React Compiler escape valve for
      meter-rate updates, or should the meter store be split (issue
      #3)?
- [x] **(answered)** Are the EQ filter type integers (`0..4`)
      part of the WASM contract? **Yes** — `crates/daw-dsp/src/proof/eq.rs:145-153`
      decodes the integer with a hard-coded switch (`0=>Peak,
      1=>LowShelf, 2=>HighShelf, 3=>HighPass, 4=>LowPass`).
      Issue #17's recommendation stands: define string-literal
      types in TS, add a `eqBandTypeToWasm()` translator at the
      bridge boundary.
- [ ] Should `uiLevel` and `abBypass` be persisted to the project
      file? See issue #34. Today they are session-scoped by accident
      (no persistence exists for them).
- [ ] Should `setProofParamWithPatch` reject UI-only keys
      (`name`, `target`, `targetLufs`) at the type level rather
      than silently no-op for them in the dispatch chain? See
      issue #37.

---

## Risks

- **Data loss on project save/reload (issue #2) — and a confusing
  asymmetry between live and offline render.** Half of UI knob
  twists never persist (issue #2a). Of the writes that *are*
  persisted (`Level3Build` knobs via `setProofParam`), the live
  runtime drops them on reload but the offline render *applies*
  them. Net user experience: a project mastered to perfection
  exports correctly but reloads in the editor showing default
  knob positions. This breaks the contract "what I see is what I
  hear". Highest-impact correctness issue, and arguably worse than
  pure data loss because the engineer believes the master is gone
  when it's actually just hidden.
- **A/B bypass restores incorrectly (open issue #4).** Engine
  has `ab_bypass` as a real param. `syncFullPatch` doesn't
  restore it. Reload defaults to dry, no warning. Mild correctness
  bug compounded by issue #2's asymmetry.
- **Two divergent param queues (issue #29).** Bridge writes between
  device construction and Proof bridge registration silently drop
  while the parallel `nativeDspControls` queue catches and flushes
  successfully. Race-window-only, but reproducible: open Proof,
  twist a knob in the first ~50 ms, see the UI move and the audio
  not.
- **Worklet-level boolean drop & bypass-gated writes (issues #30, #31).**
  Two layers below the bridge silently swallow writes under
  specific conditions. If a future caller uses `setBypass(true)`
  for an A/B comparison, every knob nudge during the comparison
  vanishes.
- **Performance death spiral at meter rate (issue #3, compounded
  by #41).** Every meter callback rebuilds the entire instances
  map and forces five canvas redraws + section re-renders; the
  `LoudnessHistory` component pushes a sample on every tick,
  inflating its history-write rate 6× past the documented value.
  On low-end hardware or with multiple Proof instances on a
  project, the UI thread saturates, audio glitches because the
  message-port queue backs up, and the user blames "the audio
  engine".
- **EQ canvas shows wrong filter shapes (issues #8 / #33 / #35).**
  Shelves render as bumps. Negative-gain peaks render mirror-image.
  HP/LP types render no curve but a draggable dot whose y-axis
  edits a meaningless field (`gain`) that the engine ignores.
  Three independent correctness bugs in the same component.
- **Type-system erosion (issues #5, #17, #25).** `as never` and
  string-typed enums normalise the pattern; future contributors
  copy it and the module accumulates blind casts. AGENTS.md exists
  to prevent this; left unaddressed it sets a precedent.
- **Test theatre (issues #6, #7, #32).** Fifteen spec files create
  the appearance of coverage and trip no flags in CI.
  `ProofPanel.spec.tsx` actively certifies a broken contract
  (`deviceId === undefined` working) as the testing baseline. A
  regression in preset loading, drag handling, or persistence will
  ship without any test failing. The first hint will be a user
  report.
- **Accessibility blocker (issue #18).** A keyboard-only user
  cannot operate the EQ canvas, cannot hear the chain-reorder
  swap, cannot perceive a clip warning. For an audio-engineering
  tool this is plausibly an audience exclusion (visually impaired
  audio engineers exist; mastering happens by ear).
- **Architectural drift (issues #1, #4, #19, #38).** Lack of root
  barrel, view code mutating the store, sub-path cross-module
  imports, parallel UI implementations of the same control — all
  individually small, collectively normalising deviation.
- **Module-default mutation hazard (issue #36).** `getProofState`
  fallback shares a module-singleton `tapPeaks` reference. Today
  benign; one future code path that mutates an element and the
  module-global default is poisoned for every instance.

---

## Suggested approaches

- **Land persistence first (issue #2). The fix is now two-sided.**
  - **Patch-side:** every bridge use case
    (`setProofParamWithPatch`, `reorderChain`,
    `loadProofPatchWithAudio` and the `syncFullPatch` it calls)
    forwards each parameter write to `persistDeviceParam`. Mirrors
    the existing `setProofParam` pattern. Mechanical.
  - **Engine-side:** `TrackNode.addDevice` for WASM devices must
    push `device.parameterValues` through the bridge after
    `registerProofDevice` resolves. Either inline (mirror
    `NativeDspDeviceStrategy.createNativeDspStrategy:93-95`) or
    via a generic post-load hook on the `WasmDeviceDescriptor`
    contract. Without this, the live-reload path stays broken
    even after the patch-side fix.
  - **Or, leapfrog both:** persist the entire `ProofPatch` JSON
    to a new `Track.devices[*].patchJson?: string` field. Engine
    init reads it, calls `loadProofPatchWithAudio`. One write per
    save, deterministic round-trip, no per-param loss. Larger
    refactor; cleanest contract.
- **Split the store and add selectors (issue #3, #41).** A
  `proofMetersStore` keyed by deviceId that takes only meter writes
  is a small surface. `ProofPanel`'s outer shell subscribes to the
  patch store; only the meter-displaying components subscribe to
  the meter store. `useProofAnalyser` already isolates a high-rate
  visualisation cleanly — same pattern for meters. While here,
  fix `LoudnessHistory`'s rate mismatch.
- **Replace `setProofParamWithPatch` with a typed dispatch (issue
  #5, with the corrected #37 in mind).** A record
  `<Key, (bridge, patch[Key]) => void>` indexed by patch key,
  excluding UI-only keys. Each entry is type-safe by construction.
  Removes every `as` in the file and the `as never` in
  `ProofPanel`'s callers. Adds an exhaustive check that catches
  UI-only-key call sites at compile time.
- **Unify the param queues (issue #29).** Either delete the
  Proof-side `bridges` map and have all use cases reach
  `nativeDspControls.setParam` via the `wasmDeviceRegistry`
  surface (single queue, single fate); or replicate the
  `pendingParams` flush in `registerProofDevice` so Proof has its
  own pre-registration queue.
- **Convert the identity-only specs to behavioural specs (issue
  #6, #32).** Mock `bridges` (or expose a `__test__resetBridges()`
  helper from `helpers.ts`), register a mock bridge, exercise the
  API, assert calls. The `ProofPanel.spec.tsx` rewrite must pass
  a real `deviceId` and seed the store. This is the single most
  valuable change for long-term correctness.
- **Add a root `index.ts` (issue #1).** Three lines re-exporting
  the existing curated surface. Update three external import sites.
- **EQ canvas: replace `peakingMag` wholesale (issues #8, #33,
  #35).** Use `BiquadFilterNode.getFrequencyResponse(...)` against
  a transient `OfflineAudioContext`, one per active band, summed.
  Handle HP/LP correctly. Resolve the gain-vs-Q axis question for
  HP/LP in the same pass.
- **A/B bypass (issue #4).** Add `setProofAbBypass({ deviceId,
  value })` use case. Drop the direct store mutation from
  `ProofPanel.tsx:357`. Add `ab_bypass` to `syncFullPatch`'s
  forwarded param list (or treat as ephemeral, drop the
  `persistDeviceParam` call — pick one explicitly).
- **Group i18n / a11y / magic-number cleanups (issues #11, #12,
  #18, #28, #40, #67).** A single "polish pass" PR can land them
  together.
- **Worklet wrapper hygiene (issues #30, #31).** Drop the
  `!bypassed` gate from `ProofNode.setParam`; let the worklet's
  `process()` handle bypass policy. Add a runtime warn when a
  non-finite/non-number value reaches `setParam` so booleans
  surface loudly instead of silently disappearing.

---

## Recommendation

Start with **open issue #2 (persistence) — the two-sided version**.
The audit's earlier "just call `persistDeviceParam` everywhere"
recipe was incomplete: the live-reload path also has to push
`Track.devices[*].parameterValues` through the bridge in
`TrackNode.addDevice`. Without that, even fixing the write side
leaves a project where the live UI shows defaults and the
exported audio uses the saved values. Add a behavioural test:
set knob → save → reset stores → hydrate from `parameterValues`
→ assert patch restored AND engine got the writes.

In parallel, **issues #6 / #32 (test theatre)**. Without
behavioural tests the persistence fix has no safety net, and
fixes #3, #5, #8, and #29 will each ship without coverage. The
bridge mock pattern from issue #6 unlocks every other test. Fix
the `ProofPanel.spec.tsx` deviceId-undefined regression here —
otherwise the test file teaches future writers a poisoned
pattern.

Then **issue #3 (meter-rate render storm)**, with #41
(`LoudnessHistory` rate) as a co-fix because it shares the
mechanism.

Then **#4 (A/B bypass restoration)** and **#29 (param queue
unification)** — small, contained, eliminate two of the three
silent-drop surfaces.

EQ canvas correctness (#8 / #33 / #35) is independent and large —
schedule as its own task. Same for accessibility (#18).

---

## Resolved

_No issues resolved yet. The 2026-04-28 adversarial review pass
corrected open issue #4's "engine doesn't recognise `ab_bypass`"
claim (the engine does), but did not close the issue — the
mis-routed view-code mutation and the missing `syncFullPatch`
restoration remain._
