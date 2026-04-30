# Plugin module audit

## Scope

Adversarial review of `src/modules/Plugin/` in full — every file: stores,
models, errors, services, repositories (`pluginBridge/`,
`proofChamberPresets/`), use cases (`pluginLifecycle/`, `wamPluginHost/`,
`faustEngine/`, `proofChamber/`, `pluginScan/`, `pushIntegration/`,
`midiEffectPlugins/`, `nodeView/`, `proModulationEffects.ts`), handlers
(`pluginHost/`), presentations (views, components), and tests.

Out of scope: the Rust plugin host implementation (`src-tauri/`), the
`AudioEngine` graph that consumes plugin instances, and other modules that
import via the root barrel. Cross-references to those subsystems appear only
where this module's contract assumes their behaviour.

This is an adversarial review focused on bugs, contracts, plugin format
isolation, lifecycle/race hazards, preset migration, audio-thread rules,
type soundness, and UX/accessibility gaps.

Related spec: none on disk.

---

## Goal

A correctness-first plugin layer for the DAW:

- **Lifecycle integrity.** Load/unload/openGui/closeGui/processAudioIPC have
  symmetric, idempotent contracts. Concurrent loads of the same plugin id
  coalesce; unloads always reach the host even on error.
- **Format isolation.** Native Tauri plugins (VST/AU/CLAP via `pluginBridge`),
  WAM plugins (in-browser), Faust-compiled plugins, ProofChamber, MIDI effect
  plugins, and the Push controller live in separate folders with no
  cross-format leakage. Failure in one format does not cascade.
- **Parameter automation.** A single, typed contract from UI →
  `setDeviceParameter` AppAction → host. Booleans, enums, and continuous
  params share a discriminated payload. UI never reaches into format-specific
  IPC directly.
- **Preset round-trip and schema migration.** `exportPresetJson` /
  `importPresetJson` produce/consume an explicit, versioned schema. Imports
  validate every field, migrate older versions, and fall back to defaults for
  unknown values rather than letting a malicious or stale JSON inject typed
  garbage into the engine.
- **No audio-thread allocations or blocking.** Anything that runs in or
  feeds an `AudioWorkletProcessor` (Faust nodes, IPC bridge, ProofChamber
  parameter feeders) avoids per-block `new Float32Array`, `Map.set`, or
  awaited IPC.
- **AGENTS.md compliance.** Cross-module access only through `index.ts`. No
  `as any`/`as unknown as` escapes. One function per `useCase` /
  `repository` file. Use-case types stay private; runtime values only in the
  barrel. Multi-parameter functions take a single object param. No
  `useMemo`/`useCallback`/`React.memo`/`forwardRef` in presentations.
- **Tests verify behaviour, not "called with X returns X".** Mocks point at
  the same import paths the production code uses. No `as any` in fixtures.

---

## Relevant code paths

- `src/modules/Plugin/index.ts` (root barrel — re-exports `useCases/`,
  `stores/`, `presentations/views/`)
- `src/modules/Plugin/useCases/index.ts` (cross-module surface)
- `src/modules/Plugin/useCases/pluginLifecycle/*.ts` (5 thin
  pass-throughs to repositories — `loadPlugin`, `unloadPlugin`,
  `openPluginGui`, `closePluginGui`, `processAudioIPC`)
- `src/modules/Plugin/useCases/wamPluginHost/builtinDescriptors.ts`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/*.ts`
  (`loadWAMPlugin`, `unloadWAMPlugin`, `initWAMEnvironment`,
  `registerWAMPlugin`, `getRegisteredPlugins`, `getPluginsByCategory`,
  `getActiveInstances`, `helpers.ts` — module-private `Map<string, …>`
  singletons)
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts`
- `src/modules/Plugin/useCases/faustEngine/builtinDSP.ts` (~1100 lines of
  Faust source + descriptors)
- `src/modules/Plugin/useCases/faustEngine/dsp/*.dsp` (17 DSP source files
  imported via `?raw`)
- `src/modules/Plugin/useCases/proofChamber/*.ts`
- `src/modules/Plugin/useCases/midiEffectPlugins/registry.ts` and
  `effectFactories/*.ts`
- `src/modules/Plugin/useCases/pluginScan/scanning/*.ts`
- `src/modules/Plugin/useCases/pushIntegration/*.ts`
- `src/modules/Plugin/useCases/nodeView/*.ts`
- `src/modules/Plugin/useCases/proModulationEffects.ts`
- `src/modules/Plugin/repositories/pluginBridge/*.ts` (12 thin Tauri IPC
  wrappers)
- `src/modules/Plugin/repositories/proofChamberPresets/*.ts`
- `src/modules/Plugin/services/pluginLoaderRegistry.ts`
- `src/modules/Plugin/handlers/pluginHost/handleScanPlugins.ts`
- `src/modules/Plugin/stores/{push,chamberStore,pluginScanStore,nodeView}.ts`
- `src/modules/Plugin/models/{ProofChamberState,FaustEngineTypes,WamPluginHostTypes,MidiEffectTypes}.ts`
- `src/modules/Plugin/errors/FaustError.ts`
- `src/modules/Plugin/presentations/views/{ProofChamberPanel,SpectrogramView}.tsx`
- `src/modules/Plugin/presentations/components/{SignalFlowDiagram,DecayEqOverlay,IrBrowser}.tsx`

---

## Current behavior

**Plugin lifecycle (Tauri IPC).** Five `useCases/pluginLifecycle/*.ts`
files (`loadPlugin`, `unloadPlugin`, `openPluginGui`, `closePluginGui`,
`processAudioIPC`) each export exactly one function whose body is a
single line forwarding to the same-named repository function in
`repositories/pluginBridge/*.ts`. Each repository function checks
`isTauri()`, returns a hardcoded "no-op" shape if the app is running in
the browser, and otherwise calls `tauriInvoke('<command_name>', { … })`
with a raw `as Promise<…>` cast. There is no validation, retry, or
error mapping anywhere. `processAudioIPC` is the only repo that wraps
the call in try/catch — on error it logs `'Audio IPC failed'` and
returns the **input** Float32Array unchanged.

**WAM host.** `wamPluginHost/hostOperations/helpers.ts` declares two
module-level `Map`s (`registry: Map<string, WAMDescriptor>`,
`instances: Map<string, WAMInstance>`). All eight operations
(`registerWAMPlugin`, `loadWAMPlugin`, `unloadWAMPlugin`,
`getRegisteredPlugins`, `getPluginsByCategory`, `getActiveInstances`,
`initWAMEnvironment`, `getActiveInstances`) read/write these maps
directly. No `Store<T>` wrapper. `loadWAMPlugin` consults the
`pluginLoaderRegistry` (the prefix → loader inversion that Faust
registers into) and falls back to:

1. If `descriptor.isHighEnd`: `new AudioWorkletNode(context,
   'HighEndPluginProcessor', …)` — relies on a worklet processor that
   must already be registered elsewhere.
2. Otherwise a `context.createGain()` GainNode — i.e. a literal
   pass-through.

`initWAMEnvironment` writes a custom property `__wamGroupId` onto the
`AudioContext` instance using `(context as unknown as Record<string,
unknown>).__wamGroupId = groupId` — disabling the
`sourdaw/no-type-assertion-escape` lint with a justification comment.

**Faust engine.** `compilerEngine.ts` is the heart. Module-level state:
`modules: Map<string, FaustModule>`, `compilationPromises: Map<string,
Promise<boolean>>`, `contextCreateLock: WeakMap<BaseAudioContext,
Promise<unknown>>`, and `compilerState: { promise, ready, error }`
(holder pattern). The compiler is loaded lazily from
`window.location.origin + '/faust/libfaust-wasm.js'` (~15 MB).
`createFaustNode` serialises per-context and retries on two known error
strings (`'already registered'` and `'is not defined in
AudioWorkletGlobalScope'`) with manual exponential backoff capped at
five attempts. At module init, `compilerEngine.ts` calls
`registerPluginLoader('faust.', …)` as a side effect — registering
itself with the cross-format loader registry. `builtinDSP.ts` registers
17 Faust modules at app boot via 17 `registerFaustDSP(...)` calls
loading `?raw` DSP source.

**ProofChamber.** A first-party reverb plugin with its own `chamberStore`
keyed by device id, `models/ProofChamberState.ts` describing 21 engine
parameters, a hardcoded factory-presets array (15 presets) in
`repositories/proofChamberPresets/helpers.ts`, and user presets in
`localStorage` (key `'proof-chamber-user-presets'`). The view
(`ProofChamberPanel.tsx`, ~830 lines) has its own
`ReverbSpectrogram` canvas component that synthesises decaying
"transients" client-side — it is not real audio analysis, just a visual
prop driven by `decay` and `damping` knobs.

**Preset I/O.**
`exportPresetJson(params)` is a one-liner: `JSON.stringify(params,
null, 2)`. `importPresetJson(json)` parses, then **only** verifies
that `mix` and `decay` are numbers; if so it spreads the parsed
object into `DEFAULT_PARAMS`. There is no schema version, no
per-field type check, no clamping to allowed ranges, no enum
validation for `space`/`algorithm`, and no migration from older
schemas. `saveUserPreset` blindly pushes to localStorage with
`id: 'user-${Date.now()}'`.

**Push controller.** `pushStore` holds a 64-element `pads` array, an
8-element `encoders` array, a 4-line display, and connection state.
Every pad/encoder mutation rebuilds the entire array via `.map(...)`
(see `handlePadPress`, `handlePadRelease`, `setEncoderValue`,
`setPadColor`, `setPadMode`, etc.). The store file's own header comment
acknowledges this is O(n) for high-frequency real-time MIDI events.
There is no actual hardware I/O — `connectPush(model)` just sets
`{ connected: true, model }` on the store. No MIDI subscription, no
SysEx for Push 2 colour codes, no sysex display rendering. The
"controller" surface is store-only.

**MIDI effects.** Seven factories (`createChordGenerator`,
`createScaleFilter`, `createVelocityCurve`, `createMidiDelay`,
`createNoteQuantizer`, `createTranspose`, `createCCMap`) each return a
`{ id, name, process: (notes) => notes }`. None are wired into the
audio engine — they exist as pure factories with zero callers in the
module barrel beyond the registry array. The chord generator
allocates a fresh `MidiNote` per interval per input note inside
`process()` — fine for offline use, fatal for any RT MIDI loop.

**Plugin scan.** `pluginScanStore` mirrors `repositories/pluginBridge/types.ts`'s
`ScannedPlugin` type but redeclares it locally (the `ScannedPlugin`
exported from the store is a duplicate definition, not the one the
repo uses). `startPluginScan` writes `isScanning: true`, fetches
default + user paths, calls `scanPlugins(allPaths)`, then writes the
result back. There is no cancellation; a second `startPluginScan` while
the first is in flight would race the store writes.

**Pro modulation effects.** `proModulationEffects.ts` calls
`registerFaustDSP` five times with inline DSP source strings (chorus,
flanger, phaser, tremolo, auto-pan). Same module-init side-effect
pattern as `builtinDSP.ts`.

**Tests.** Most files have a sibling `__tests__/` spec. Coverage is
mostly mechanical (call shape + return shape). Several specs use `as
any` and partial fixtures.

---

## Findings

1. **Five `pluginLifecycle/*.ts` use cases are no-op pass-throughs.** Each
   re-exports a same-named function from `repositories/pluginBridge/*.ts`
   with no orchestration, validation, or error mapping. These exist to
   satisfy the "useCases wrap repositories" architectural shape
   cosmetically, but introduce five files of indirection plus a
   `ReturnType<typeof X>` declaration. This is the same anti-pattern
   flagged in the AudioAnalysis audit as `audioAi/*.ts`.

2. **`processAudioIPC` swallows IPC errors and silently returns
   unprocessed audio.** `repositories/pluginBridge/processAudioIPC.ts:24`
   catches every error from `tauriInvoke('audio_ipc', …)`, logs `warn`,
   and returns the **input** Float32Array. The audio thread continues
   sending samples to a plugin that may have crashed/unloaded, and the
   user hears unprocessed audio with no UI signal. Combined with the
   fact that this is called per audio block, every block error logs
   another warning (log spam at audio rate).

3. **`processAudioIPC` reuses `audioData.buffer` directly without
   detaching/copying.** `processAudioIPC.ts:15` writes
   `new Uint8Array(audioData.buffer)` then awaits `tauriInvoke`. Tauri v2
   IPC may or may not transfer ownership of the underlying ArrayBuffer
   depending on serializer. If the worklet reuses the same buffer
   across invocations and the IPC layer detaches it, the next worklet
   block will see a zero-length buffer. The current implementation does
   not document or guard this. If it does NOT detach, the bytes are
   serialised by copy — fine for correctness but introduces ~2× memory
   bandwidth in the audio path.

4. **Per-audio-block `new Uint8Array(audioData.buffer)` and
   `new Float32Array(responseArray.buffer)`.**
   `processAudioIPC.ts:15,23` allocates two typed-array headers per
   block. At 44.1 kHz / 128-frame blocks that is ~700 allocations per
   second. The Float32Array constructor on a Uint8Array buffer assumes
   the response buffer is byte-aligned and sized to a multiple of 4 —
   nothing validates this. A truncated response yields a `RangeError:
   buffer length must be a multiple of 4` thrown into the worklet.

5. **`unloadPlugin` cannot fail noisily.**
   `repositories/pluginBridge/unloadPlugin.ts:7` does `await
   tauriInvoke('unload_plugin', { instanceId })` with no try/catch.
   Failures propagate to whatever called `unloadPlugin` — but the
   use-case wrapper does not document the throw, and the only handler
   that calls it through the contract surface is whatever cleans up
   tracks. If the unload fails (e.g. native plugin crashed), the JS
   side has no way to mark the instance as gone; subsequent
   `loadPlugin(pluginId, instanceId)` may collide on the same
   `instanceId` because the host still tracks it.

6. **No "lifecycle race" coalescing.** `loadPlugin(pluginId, instanceId)`
   is async with no module-level promise cache. Two concurrent
   `loadPlugin` calls with the same `(pluginId, instanceId)` issue two
   IPC commands in parallel. The Rust side is the only thing
   guaranteeing idempotency; the JS layer does not coalesce. Same for
   `loadWAMPlugin` — `wamPluginHost/hostOperations/loadWAMPlugin.ts`
   builds a `WAMInstance` and writes to `instances.set(...)` with no
   guard against a parallel call writing under the same key (last
   write wins; the earlier instance's audio node is leaked).

7. **`unloadPlugin` (Tauri) and `unloadWAMPlugin` (in-process) are not
   coordinated.** A track switching plugin format goes through
   different code paths with no shared "tear down whatever's there"
   abstraction. Bypass is similarly bifurcated. This is a recipe for
   leaks when format-mixed device chains are saved/loaded.

8. **`importPresetJson` does no schema migration and only validates
   two of 21 fields.** `repositories/proofChamberPresets/importPresetJson.ts:6`
   only checks `typeof parsed.mix === 'number' && typeof parsed.decay
   === 'number'`. Any other field can be missing, of the wrong type, or
   an enum value not in the model (`space: 'cosmic'`,
   `algorithm: 'foo'`, `vintage: 99`, `freeze: 'true'`). Spreading into
   `DEFAULT_PARAMS` keeps unknown fields, then the UI / Rust engine
   sees them downstream. There is no `schemaVersion` field at all, so
   migrating to a future v2 is impossible.
   - The `as ProofChamberEngineState` cast on `JSON.parse` is a
     `as`-escape (AGENTS.md TypeScript-soundness violation): the parsed
     JSON is `unknown` until validated, but it is asserted as
     `ProofChamberEngineState` immediately, then the runtime checks
     only two of its fields.

9. **`exportPresetJson` exports the engine state with no version, no
   metadata, and no provenance.** `repositories/proofChamberPresets/exportPresetJson.ts`
   is `JSON.stringify(params, null, 2)`. Round-trip via
   `importPresetJson` works today, but tomorrow's `ProofChamberEngineState`
   shape change will break every saved preset on the user's disk.

10. **`saveUserPreset` ID is non-collision-safe.**
    `saveUserPreset.ts:9`: `id: 'user-${Date.now()}'`. Saving two
    presets within the same millisecond produces two presets with the
    same id. The id is used as the key for `deleteUserPreset` so the
    second one cannot be deleted independently.

11. **`getUserPresets` swallows `JSON.parse` errors.**
    `helpers.ts:209-211`: `catch { /* ignore */ }`. A corrupted
    localStorage entry produces a silent `[]` — the user's saved
    presets just disappear with no warning, no recovery, and no error
    surfaced.

12. **`FACTORY_PRESETS` includes invalid preset shapes for
    `infinite`/`spring`.** `helpers.ts:162`: `infinite-hold` sets
    `decay: 0.999` and `freeze: true` — but `freeze` already implies
    infinite-hold semantics in the engine. Combining them is either
    redundant or contradicts the engine's freeze behaviour. The
    `spring-guitar` and `spring-dark` presets spread `(SPACE_PRESETS.spring ?? {})`
    — `SPACE_PRESETS.spring` is defined (line 77) so the `?? {}`
    fallback is dead code that signals a defensive accommodation for a
    `Partial<Record<…>>` typing mistake.

13. **`SPACE_PRESETS` declared as `Record<SpaceType, Partial<…>>` but
    spread without the model type.** `helpers.ts:36-44`: every preset
    does `params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.hall, space:
    'hall' as SpaceType, algorithm: 'fdn-8' as ProofChamberAlgorithm }`.
    The `as SpaceType` / `as ProofChamberAlgorithm` casts proliferate
    through 15 presets and are decorations on string literals — they
    silently bypass the union check. If the model adds a new space and
    forgets a preset, no compile error fires.

14. **Plugin format isolation: ProofChamber preset code lives **inside**
    the generic `Plugin` module.** `repositories/proofChamberPresets/`
    is one of two repository sub-folders. The other is
    `pluginBridge/` (native VST/AU/CLAP via Tauri). They share the
    `repositories/` flat directory but have nothing to do with each
    other. There is no separation between "Plugin-format-agnostic IPC
    bridge" and "first-party reverb data". A new first-party plugin
    would compete for the same flat directory.

15. **`loadWAMPlugin` returns `null` for two failure modes but
    succeeds (returning a GainNode pass-through) for the third.**
    `wamPluginHost/hostOperations/loadWAMPlugin.ts:59`: vanilla
    pass-through plugins (any descriptor with no `customLoader` and
    `isHighEnd === false`) silently get a `context.createGain()`
    audio node. Per the comment "this is the expected 'untouched
    audio' path, not a silent failure" — but in
    `builtinDescriptors.ts:5-126` there are 13 pass-through descriptors
    (EQ, Compressor, Reverb, Delay, Chorus, Distortion, Limiter, Synth,
    DrumKit, Sampler) that have full param expectations and no actual
    DSP. When the user adds "Compressor" to a track, they get a
    GainNode unity-pass-through with the **Compressor** label — no
    parameters, no compression. This is shipped behaviour today.

16. **`registerPluginLoader` has no overwrite guard, no unregister.**
    `services/pluginLoaderRegistry.ts:18-22` calls `loaders.set(idPrefix,
    loader)` — silently overwriting any previously registered loader.
    HMR re-execution of `compilerEngine.ts` (re-running the
    `registerPluginLoader('faust.', …)` side effect) will replace the
    loader, but the previous closure may still be referenced by an
    in-flight load. There is no `unregisterPluginLoader` and no test
    that two registrations of the same prefix are caught.

17. **`findPluginLoader` is O(n) over loader prefixes.**
    `pluginLoaderRegistry.ts:26-33`: linear scan of all prefixes for
    every plugin load. Today there's one prefix (`'faust.'`), but a
    `for…of Map` iteration without sorting means the first matching
    prefix wins — if `'faust.'` and `'faust.synth.'` are both
    registered, dispatch is non-deterministic depending on insertion
    order.

18. **`compilerEngine.attemptCreateNode` retries on string-matched error
    messages.** `compilerEngine.ts:255,261` checks `msg.includes('already
    registered')` and `msg.includes('is not defined in
    AudioWorkletGlobalScope')` to decide retry strategy. These are
    upstream library error strings — any version bump of `@grame/faustwasm`
    that rephrases its errors silently disables the retry, and the
    Faust node creation will fail without backoff. Use `instanceof` or
    a typed error code.

19. **`compilerEngine.compileFaustDSP` returns `false` for
    "module not registered".** `compilerEngine.ts:148-151`: if the
    module is not in the registry, `logger.warn` and return `false`.
    Same return value as "compilation failed for syntax error".
    Callers cannot distinguish "you typo'd the id" from "the DSP
    code is broken" from "compiler not loaded yet". The
    `pluginLoaderRegistry`-wired Faust loader (`compilerEngine.ts:305-313`)
    returns `null` for both cases, propagating into
    `loadWAMPlugin`'s "custom loader returned null → notifyUser
    error" path — so the user sees the same message regardless of
    cause.

20. **`compileAllFaustModules` parallelises 17+ compilations on app
    boot.** `compilerEngine.ts:200-203`:
    `Promise.all([...modules.keys()].map(compileFaustDSP))`. Each
    compilation runs Faust → WASM via the same `LibFaust` instance
    (singleton, not reentrant per the upstream API). The
    `compilationPromises` cache deduplicates same-id calls but cannot
    serialise across different ids — so the upstream library is being
    called 17 times in parallel. If `LibFaust` is internally
    single-threaded (which the doc strongly implies — it shares the
    WASM instance memory), this either serialises behind the FFI lock
    or thrashes the heap.

21. **`createFaustNode` retry paths catch and discard the second error
    silently.** `compilerEngine.ts:257-260`: the "already registered"
    branch calls `invoke()` once more in a try/catch, and on failure
    `logger.warn(...)` and falls through to the
    `'is not defined in AudioWorkletGlobalScope'` branch (which is
    not a re-test — the `else if` already failed). End result: the
    error is logged but a second branch may not run because the
    early `if (msg.includes('already registered'))` path doesn't fall
    through into the `else if` for a different message. The control
    flow is shaped such that some error/retry combinations bottom-out
    at "logger.warn ... return null" with no clear recovery.

22. **`compilerEngine.ts` has a `// eslint-disable …` for an
    `@typescript-eslint/require-await` violation in
    `initWAMEnvironment.ts`, but the same file uses `(context as
    unknown as Record<string, unknown>).__wamGroupId = groupId`.**
    `wamPluginHost/hostOperations/initWAMEnvironment.ts:5`: the
    `as unknown as Record<…>` double-cast is exactly the kind of escape
    AGENTS.md "TypeScript — soundness" forbids. Stamping a custom
    property onto a host-provided `AudioContext` is also a coupling
    risk: any future `AudioContext` API addition that uses
    `__wamGroupId` would silently collide. Use a `WeakMap<AudioContext,
    string>` instead.

23. **`unloadWAMPlugin.ts` sniffs for a `destroy` method via two casts
    plus a `try/catch`.** `unloadWAMPlugin.ts:9-15`: `const
    nodeAsUnknown: unknown = instance.audioNode` then `(nodeAsUnknown
    as { destroy: unknown }).destroy` and `(nodeAsUnknown as { destroy:
    () => void }).destroy()` — three escapes for one duck-type. Either
    the `WAMInstance.audioNode` type should be a union including a
    `{ destroy?(): void }` member, or the type-narrowing should use a
    proper `if (typeof (node as { destroy?: unknown }).destroy ===
    'function')` predicate without the `unknown` indirection.

24. **`getActiveInstances()` returns a fresh `Map` clone every call.**
    `getActiveInstances.ts:5-7`: `new Map(instances)` allocates O(n)
    every call and produces a snapshot that is decoupled from future
    mutations. Most callers want either a live read or a typed
    iterator; the clone-per-call is wasted work and makes "watch for
    new instances" patterns impossible.

25. **`getRegisteredPlugins()` and `getPluginsByCategory()` allocate on
    every call.** `getRegisteredPlugins.ts:5-7`:
    `[...registry.values()]`. `getPluginsByCategory.ts:5-7`: same +
    `.filter(...)`. Fine for an "open the plugin browser" event; bad
    for any UI that subscribes and re-renders on every store tick.

26. **WAM `helpers.ts` exposes raw `Map` mutation surface
    cross-file.** `wamPluginHost/hostOperations/helpers.ts:6-8` exports
    `registry` and `instances` as plain `Map`s. Every operation in
    `hostOperations/*.ts` mutates them directly. There is no
    encapsulation, no event emission, no React-safe subscription
    pattern (the rest of the codebase uses `Store<T>`). UI components
    cannot react to plugin load/unload without polling
    `getActiveInstances()`.

27. **No `AppAction` for plugin load/unload/openGui.** The
    `pluginLifecycle/*` use cases are exported from `useCases/index.ts`
    but `getPluginHostHandlers` only wires `scanPlugins`. Other
    lifecycle commands (load, unload, openGui, closeGui, processAudio)
    must therefore be invoked by direct module-internal calls or by
    other modules importing the use cases — bypassing the AppAction
    contract. The handler pattern in `handlers/pluginHost/` has only
    one handler, undermining the whole "command-bus for plugin host"
    story.

28. **`handleScanPlugins` is `undoable: false` but
    `startPluginScan` mutates `pluginScanStore`.**
    `handlers/pluginHost/handleScanPlugins.ts:5-11`: not undoable, no
    side-effect description beyond the label. Fine in isolation, but
    `startPluginScan` writes errors and a paths list to the store with
    no rollback path if the second scan fails partway. A user who
    triggers Scan, gets a partial result with errors, then triggers
    again has no way to revert.

29. **`startPluginScan` does not coalesce concurrent invocations.**
    `useCases/pluginScan/scanning/startPluginScan.ts:7`: writes
    `isScanning: true`, awaits IPC, writes the result. Two parallel
    invocations each write `isScanning: true`, both await, both write
    their own result back; the later one wins, and `errors` from the
    first run are lost. No promise-cache, no `if (state.isScanning)
    return` guard.

30. **`scanCustomPaths` deduplicates by id but `startPluginScan` does
    not.** `scanCustomPaths.ts:13-17` checks `existingIds.has(...)`
    before merging. `startPluginScan.ts:26-32` overwrites
    `scannedPlugins` wholesale with `result.plugins`. So the two
    "scan" entry points have inconsistent merge semantics — one keeps
    old results, the other discards. Documented nowhere.

31. **`pluginScanStore` redeclares `ScannedPlugin`.**
    `stores/pluginScanStore.ts:8-20` defines `ScannedPlugin` with the
    same shape as `repositories/pluginBridge/types.ts:5-17`. They are
    structurally identical today but two independent declarations.
    `useCases/pluginScan/queries.ts` re-exports the **store's**
    version, while the repositories use their own. A schema change in
    one will silently desync the other.

32. **AGENTS.md "Use-case types stay private" violation.**
    `useCases/index.ts:17,32,51` exports four types
    (`FaustModule`, `FaustParamDescriptor`, `ScannedPlugin`,
    `WAMDescriptor`, `WAMInstance`) for cross-module consumption.
    Per AGENTS.md: "Do not `export type` from `useCases/` for other
    modules". The root barrel re-exports the whole `./useCases` so
    these types leak everywhere.

33. **AGENTS.md "Same module — relative imports" violation: builtin
    Faust DSPs spread through the cross-module surface.**
    `useCases/index.ts:4-16`: re-exports runtime values from
    `compilerEngine`, `builtinDSP`, etc. The `index.ts` exports look
    correct (only re-exports from within `useCases/`). However,
    `useCases/wamPluginHost/builtinDescriptors.ts` and
    `useCases/proModulationEffects.ts` cause module init side effects
    (`registerWAMPlugin(...)`/`registerFaustDSP(...)` at top level)
    when imported. The barrel exports `registerBuiltinFaustDSP` and
    `registerBuiltinPlugins` as functions that **also** trigger the
    side effects. There are two contradictory mental models for
    "how do builtin descriptors get registered": top-of-file side
    effect, or explicit `register*()` call.

34. **`pluginQueries.ts` is two lines and re-exports from a sibling
    folder.** `useCases/pluginQueries.ts`:
    `export { MIDI_EFFECT_FACTORIES } from './midiEffectPlugins/registry';`.
    The use case file does nothing else — it is a barrel inside a
    barrel. Either inline this in `useCases/index.ts` or move the
    factories up.

35. **Push integration is store-only — no real hardware I/O.**
    `useCases/pushIntegration/connectPush.ts:1-9` sets
    `connected: true, model` on the store with no MIDI or USB port
    enumeration. `disconnectPush.ts` similarly toggles a flag. The
    other use cases (`setPadColor`, `setPadMode`, `setEncoderValue`,
    `handlePadPress`, `handlePadRelease`, `setScale`, `mapEncoder`,
    `updateDisplay`) all mutate the store but never send to a
    hardware port. There is no `repositories/pushHardware.ts`, no
    `navigator.requestMIDIAccess`, no SysEx for Push 2 colour codes,
    no display-bitmap blitting. The whole `pushIntegration/` folder
    is ten store-mutation use cases with no I/O — i.e. dead code from
    a hardware-controller perspective.

36. **Push pad mutation is O(64) per pad press.**
    `handlePadPress.ts:14-17` rebuilds the entire 64-pad array via
    `.map(...)` for a single-pad update. The store file's own header
    comment acknowledges this "should be refactored to indexed access
    or a Map<number, PushPad>". At Push 2's polyphonic-aftertouch
    rate (~25 Hz × 64 pads = ~1600 mutations/sec when all pads are
    pressed), this is 1600 × 64 = ~100K object allocations/sec, all
    inside React's render path because the store fires subscribers
    on every `set`.

37. **`setEncoderValue` clamps to 0–127 but the encoder type's
    `value: number` admits any range.** `setEncoderValue.ts:11`:
    `Math.max(0, Math.min(127, value))`. The store's
    `PushEncoder.value: number` does not constrain; subsequent direct
    `pushStore.set(...)` writes from elsewhere can place out-of-range
    values, and downstream consumers (display, encoder LEDs) have no
    type guarantee.

38. **`pluginLoaderRegistry.ts` uses `for…of` on a `Map`'s entries
    with destructuring.** `pluginLoaderRegistry.ts:27-32`:
    `for (const [prefix, loader] of loaders)`. Per AGENTS.md
    naming-constraints, "no single-letter variable names" — but this
    line uses `prefix` and `loader` (fine), so OK. The function does
    not return the longest-matching prefix; it returns the first by
    insertion order. If a future format registers `'faust.poly.'` and
    `'faust.'`, the result depends on registration order — pure
    accident.

39. **MIDI effect factories are registered nowhere.**
    `useCases/midiEffectPlugins/registry.ts:9-17`: exports
    `MIDI_EFFECT_FACTORIES` as a const array. `pluginQueries.ts`
    re-exports it. There is no `registerMidiEffectPlugin(...)` and
    no MIDI-effect format integration with the WAM host, the Tauri
    plugin bridge, or the chamber surface. Each factory returns a
    plain `{ id, name, process }` object with a synchronous JS
    `process(notes: MidiNote[]): MidiNote[]`. Nothing in the audio
    engine is going to call this — the engine deals with MIDI
    events, not arrays of notes. These factories are unused glue
    waiting for an integration that does not exist.

40. **`createScaleFilter` uses a non-null assertion on `SCALES.major!`.**
    `useCases/midiEffectPlugins/createScaleFilter.ts:4`:
    `const scaleNotes = SCALES[scaleName] ?? SCALES.major!;`. The
    `!` on `SCALES.major` is a non-null assertion to satisfy the
    `Record<string, number[]>` index access type. AGENTS.md "TypeScript
    — soundness" forbids assertion escapes; in this case `SCALES.major`
    is provably defined (line 28 of `MidiEffectTypes.ts`), but the
    assertion is still an escape — narrow via a `const` extraction or
    rework the model to a typed key union.

41. **`createChordGenerator` allocates a fresh note object for each
    interval, every call.** `createChordGenerator.ts:9-15`: nested
    `for…of` over `notes` and `intervals`, pushing
    `{ ...note, pitch: note.pitch + interval }` into a new array.
    Fine for offline batch use; if this `process` is called per-MIDI
    block in real-time (which the factory architecture implies),
    each input note allocates `intervals.length` new objects. For a
    seven-note chord across an eight-note input that's 56
    allocations per block.

42. **`ProofChamberPanel.selectSpace` issues N AppActions in
    sequence.** `presentations/views/ProofChamberPanel.tsx:200-231`:
    iterates `Object.entries(nextParams)` and dispatches a
    `setDeviceParameter` AppAction per parameter (≥18 actions per
    space change). Each goes through `executeAppAction` and probably
    hits the command bus + Rust IPC. There is no batched
    `setDeviceParameters` action. Worse: the loop fires before the
    UI's `updateChamberEngine` settles, and the actions are dispatched
    out-of-order with respect to the UI store update.
    - `selectSpace.ts:201`: `(preset as Record<string, unknown>).algorithm
      as ProofChamberAlgorithm | undefined` is a double-cast (AGENTS.md
      violation).

43. **`ProofChamberPanel.setParam` casts boolean to number ad-hoc.**
    `ProofChamberPanel.tsx:188-192`: `numericValue = value ? 1 : 0`
    for booleans. This means the AppAction payload's `value: number`
    type is the lowest-common-denominator. There is no discriminated
    union for "boolean param" vs "enum param" vs "continuous param".
    The Rust side has to know to interpret `1.0` as "true" for
    `freeze`/`shimmer`/`saturation`. Any future param that admits
    fractional values 0–1 will collide on this convention.

44. **`ProofChamberPanel.DecayEqOverlay onChange` dispatches a
    payload field named `mult`, not `value`.**
    `ProofChamberPanel.tsx:387-391`:
    ```
    payload: { deviceId, paramId: `decay_eq_${band}`, mult },
    ```
    The `setDeviceParameter` AppAction payload elsewhere in the file
    uses `value: number`. Either the action has a discriminated
    payload that includes `mult` (in which case the type system would
    show this), or this is a typo that ships an unknown property and
    drops the actual value. Either way, this branch has zero coverage
    in the spec file (`ProofChamberPanel.spec.tsx` only renders).

45. **`ReverbSpectrogram` is fake.**
    `ProofChamberPanel.tsx:738-827`: a 90-line client-side animation
    that synthesises a "spectrogram" from random transient injections
    decayed by the user's `decay`/`damping` knob values. It is
    rendered with a `tailViewLed` of `'Live tail'` (line 376) — i.e.
    the UI labels it as live audio analysis when it is not. Same
    pattern as the `referenceMixComparison` synthetic compare in
    AudioAnalysis.

46. **`SpectrogramView.tsx` is also fake.** `presentations/views/SpectrogramView.tsx:34-48`:
    when `isMocking === true`, generates a mock energy blob from
    `Math.sin(time + freqScale * 10) * Math.cos(time * 0.5)`. The
    label switches between `'Preview'` (mocking) and `'Live'` (not
    mocking) — but in the not-mocking case, **nothing happens**: the
    canvas just shifts its content left and clears the rightmost
    column with no draw. This is a permanent black frame masquerading
    as a live spectrogram with the label `'Live'`. No callers pass
    real audio data into this component.

47. **No automation lane for plugin parameters.** Beyond the "set
    value" command, there is no provision for a user to record a
    parameter automation envelope and have it played back. The
    AGENTS.md spec implies plugin parameters should integrate with the
    DAW's automation system, but the contract surface
    (`useCases/index.ts`) has nothing for "subscribe to parameter
    changes", "record parameter automation", "apply automation
    envelope". The Faust modules expose `paramDescriptors` with
    `min`/`max`/`step`/`scaling` — useful for an automation editor —
    but the wiring is absent.

48. **No round-trip for native plugin parameter values.** The
    `setPluginParameter` and `getPluginParameters` Tauri repos exist,
    but the JS layer does not maintain a parameter cache that
    invalidates on plugin reload. Reloading a project that referenced
    a plugin parameter by id is going to issue `getPluginParameters`
    over IPC for every plugin per opened project — no batching, no
    cache.

49. **`tauriInvoke('audio_ipc', …)` is on the JS audio path.**
    `repositories/pluginBridge/processAudioIPC.ts:17`: per-block IPC
    round trip from the worklet thread. The audio worklet runs in a
    separate thread that cannot directly call `tauriInvoke` (which
    posts a message to the main thread, which posts to Rust via Tauri
    v2 IPC) — meaning this code is on the **render** thread, not the
    audio thread. So either (a) audio worklets use a different
    bridge and this is dead code, or (b) the main thread is doing
    per-block plugin processing — both of which violate the
    "audio thread cannot block" rule. The file's comment says
    "raw Float32Array crossing from the AudioWorklet to Rust and
    back" — implying (b). At a 128-frame block size and 44.1 kHz,
    that's a hard real-time deadline of 2.9 ms per block. Tauri IPC
    round-trip latencies are not bounded; this will glitch.

50. **`__tests__/helpers.spec.ts` only tests two of 15 factory
    presets.** `repositories/proofChamberPresets/__tests__/helpers.spec.ts:9-19`:
    asserts uniqueness of ids and that all categories are in a
    whitelist. Does not assert that any preset's params are valid
    against `DEFAULT_PARAMS`. A typo in `mix: 1.5` (out of 0–1 range)
    or an `algorithm: 'fnd-8'` typo would not be caught.

51. **`importPresetJson.spec.ts` "valid case" doesn't validate types.**
    `__tests__/importPresetJson.spec.ts:16-18`: the only "rejection"
    test passes `{ mix: 'bad' }`. The "decay missing" path is not
    exercised; the "garbage in unknown field" path is not exercised;
    the "future schema with `_version: 2`" path is not exercised.

52. **`getPluginHostHandlers.spec.ts` exercises the wiring but not the
    contract.** Mocked the same way as AudioAnalysis — see findings
    #2/#25 in that audit. (Confirmed by reading the spec
    snapshot — the test asserts `scanPlugins: handleScanPlugins` is
    present, not that it does anything.)

53. **`compilerEngine.ts` never validates DSP source before
    `generator.compile`.** No syntax sniff, no length cap, no
    sandboxing. A `registerFaustDSP` call with attacker-controlled
    DSP source (via a malicious preset) would compile and run
    arbitrary code in the audio worklet. Today the only
    `registerFaustDSP` callers are `builtinDSP.ts` and
    `proModulationEffects.ts` (both static), but the function is
    re-exported through `useCases/index.ts` and through the root
    barrel — any module can call it.

54. **`processAudioIPC.ts` returns `audioData` (the input) on
    `!isTauri()` but `new Float32Array(responseArray.buffer)` on
    success.** The two branches return objects of different
    provenance: the no-op branch returns the **same Float32Array**
    the caller passed in (a reference), while the success branch
    allocates a fresh one. Callers that mutate the returned array
    will, in browser mode, mutate the input — violating
    least-surprise for an "process audio" function.

55. **No tests for `processAudioIPC`'s error path.**
    `useCases/pluginLifecycle/__tests__/processAudioIPC.spec.ts`
    exists but only verifies the use-case wrapper forwards. The
    repository itself (the place where the
    `audioData.buffer`/`Uint8Array`/`Float32Array` reinterpretation
    happens) has no tests covering "Tauri returns a Uint8Array of
    odd length" or "Tauri throws".

56. **No accessibility / aria-live for plugin scan or load
    progress.** `pluginScanStore.isScanning` is a boolean — UIs
    presumably render a spinner. There is no `progress: number`
    field, no `currentPlugin: string` for "Scanning Plugin X of Y",
    and no `notifyUser`-based aria-live event when scan completes.
    The `ProofChamberPanel` similarly has no role="status" or
    aria-live region for "Preset loaded" announcements.

57. **`SignalFlowDiagram`, `DecayEqOverlay`, `IrBrowser` are
    presentation components — not audited deeply here.** Their
    spec files exist (`__tests__/*.spec.tsx`); a behaviour audit is
    deferred to the presentations sweep. From the `ProofChamberPanel`
    view: `DecayEqOverlay onChange` ships a `mult` payload field
    while everything else uses `value` (see #44).

58. **Module barrel re-exports `presentations/views/ProofChamberPanel`
    plus internal types via `useCases/`.** Other modules can import
    `ProofChamberPanel` directly. AGENTS.md allows this (views are a
    public surface), but the panel internally imports
    `chamberStore`, `updateChamberEngine`, `registerChamberInstance`
    from relative paths — meaning the view module is coupled to the
    store. Any cross-module consumer rendering `ProofChamberPanel`
    inherits the chamber store dependency. Acceptable, but worth
    noting.

59. **No "plugin format isolation" boundary.** AGENTS.md says
    "Plugin" is one module. Inside it, `pluginBridge/` (native),
    `wamPluginHost/` (WAM), `faustEngine/` (Faust),
    `proofChamber/` (1st-party), `pushIntegration/` (controller),
    `midiEffectPlugins/` (MIDI), `nodeView/` (graph routing) all
    coexist. There is no internal contract that says "if `faustEngine`
    breaks, `pluginBridge` keeps working". They share
    `pluginLoaderRegistry`, the `WAM` `Map<string, …>` registry, and
    are co-mounted at boot. A throw in `compilerEngine.ts`'s init or
    `builtinDSP.ts`'s top-level `registerFaustDSP` calls will abort
    the entire `Plugin` module's import chain (and therefore any
    consumer's typed barrel access).

60. **No HMR safety for module-level singletons.**
    `wamPluginHost/hostOperations/helpers.ts:6,8` (`registry`,
    `instances`), `faustEngine/compilerEngine.ts:41,44,55,59`
    (`modules`, `compilationPromises`, `contextCreateLock`,
    `compilerState`), `services/pluginLoaderRegistry.ts:18`
    (`loaders`) — all module-level mutable state that HMR will leak
    on every reload. No documentation of HMR behaviour, no
    `import.meta.hot` cleanup. Same anti-pattern as AudioAnalysis
    audit findings #9/#26.

61. **Function signature violations (positional args).** AGENTS.md
    "Functions with more than one parameter take a single object
    param". Violators across the module:
    - `repositories/pluginBridge/loadPlugin.ts:5`
      `(pluginId, instanceId)`
    - `repositories/pluginBridge/setPluginParameter.ts:3`
      `(instanceId, paramId, value)`
    - `repositories/pluginBridge/setPluginState.ts:3`
      `(instanceId, state)`
    - `repositories/pluginBridge/processAudioIPC.ts:8`
      `(instanceId, audioData)`
    - `useCases/pluginLifecycle/loadPlugin.ts:4`
      `(pluginId, instanceId)`
    - `useCases/pluginLifecycle/processAudioIPC.ts:7`
      `(instanceId, audioData)`
    - `useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts:9`
      `(pluginId, context, groupId)` — three positional
    - `useCases/proofChamber/registerChamberInstance.ts:7` — single
      param, OK.
    - `useCases/proofChamber/setChamberUILevel.ts:6`
      `(id, level)`
    - `useCases/proofChamber/updateChamberEngine.ts:8`
      `(id, updater)`
    - `useCases/midiEffectPlugins/createScaleFilter.ts:3`
      `(root = 0, scaleName = 'major')`
    - `useCases/midiEffectPlugins/effectFactories/createCCMap.ts`
      (per registry call: `createCCMap(1, 11)`)
    - `useCases/pushIntegration/setEncoderValue.ts:3`
      `(encoderIndex, value)`
    - `useCases/pushIntegration/handlePadPress.ts:9`
      `(padIndex, velocity)`
    - `useCases/pushIntegration/setPadColor.ts:3`
      `(padIndex, color)`
    - `services/pluginLoaderRegistry.ts:21`
      `registerPluginLoader(idPrefix, loader)`
    - `repositories/proofChamberPresets/saveUserPreset.ts:5`
      `(name, params)`

62. **`WAMInstance.audioNode: AudioNode` is too narrow for actual
    plugins.** `models/WamPluginHostTypes.ts:17`: typed as
    `AudioNode`. Real plugin instances need ports, parameter
    accessors, MIDI input, GUI hooks. The WAM SDK 2.0 protocol
    defines a `WamNode` extension. By typing as the base
    `AudioNode`, the host gives up all WAM-specific information.
    `loadWAMPlugin` returns a vanilla `GainNode` for vanilla
    plugins — clearly there is no real WAM 2.0 protocol
    implementation here. This is a "WAM in name only".

63. **`WAMDescriptor.sdkVersion: '2.0'` is hardcoded.**
    `useCases/wamPluginHost/builtinDescriptors.ts:11,21,…`: every
    descriptor sets `sdkVersion: '2.0'`. There is no actual SDK
    version negotiation. If a third-party WAM 2.1 plugin is loaded,
    nothing checks the version mismatch.

64. **`SignalFlowDiagram`, `DecayEqOverlay`, `IrBrowser` are imported
    by the panel as components and have local state.** Not deep-
    audited here, but flagged: these are sub-views in `components/`,
    where AGENTS.md keeps `components/` private to the module — OK.

65. **`pushIntegration/__tests__/*.spec.ts` test the no-op
    store-mutation path only.** Without hardware I/O, the tests
    can't verify the more interesting "send SysEx to Push 2 to set
    pad colour". They simply assert that `setPadColor(3, color)`
    leaves the store with the colour at index 3. The store-only
    architecture means the whole controller is uncovered for its
    actual purpose.

66. **No test for the `pluginLoaderRegistry`'s overwrite/last-write-wins
    behaviour.** No test asserts that two `registerPluginLoader('faust.',
    …)` calls leave only the second loader; no test asserts that
    `findPluginLoader` returns null when no prefix matches.

67. **No `models/__tests__/` for `MidiEffectTypes`,
    `WamPluginHostTypes`, `FaustEngineTypes`.** Only
    `ProofChamberPatch.spec.ts` exists in `models/__tests__/`. Type
    declarations don't need tests, but the const tables (`SCALES`,
    `CHORD_INTERVALS`, `ALGORITHM_MAP`, `SPACE_PRESETS`, `PARAM_MAP`)
    are assertion-targets that aren't covered.

68. **`PARAM_MAP: Record<string, string>` not constrained to
    `keyof ProofChamberEngineState`.**
    `models/ProofChamberState.ts:89`: typed too loosely.
    `ProofChamberPanel.setParam(key: keyof ProofChamberEngineState,
    …)` does `PARAM_MAP[key]` and gets a `string | undefined`. Any
    typo in `PARAM_MAP` keys is invisible. Tighten to
    `Record<keyof ProofChamberEngineState, string>` to force
    exhaustiveness.

---

## Priorities

1. **`processAudioIPC` is on a real-time path with per-block
   allocation, IPC round-trip, and silent failure** (issues #2, #3,
   #4, #49, #54). This is the most user-visible audio-thread hazard
   in the module.
2. **Preset import has no schema validation, no version, and no
   migration** (issues #8, #9, #10, #11, #50, #51). Every saved
   preset is one model-shape change away from being silently broken.
3. **Vanilla pass-through for built-in WAM descriptors masquerading
   as real plugins** (issue #15). Adding "Compressor" to a track
   gives the user unity gain with the label "Compressor" — visible
   silent breakage.
4. **No load/unload race coalescing across formats** (issues #5,
   #6, #7). Two parallel loads of the same instanceId leak
   resources; cross-format unload has no shared abstraction.
5. **`importPresetJson` `as ProofChamberEngineState` cast bypasses
   the type system** (issues #8, #13). Any malformed preset typed-in
   poisons the engine state.
6. **Push integration is store-only with no hardware I/O** (issue
   #35). The user-facing feature labelled "Push controller" does
   nothing.
7. **Synthetic `ReverbSpectrogram` and `SpectrogramView` labelled
   "Live"** (issues #45, #46). Misleading-by-construction UX.
8. **AGENTS.md violations: `as unknown as` escapes, type re-exports
   from `useCases/`, positional-arg signatures** (issues #8, #22,
   #23, #32, #40, #42, #61).
9. **Five `pluginLifecycle/*.ts` no-op pass-throughs** (issue #1).
   Same anti-pattern flagged in AudioAnalysis #14.
10. **No `AppAction`-based plugin lifecycle command surface** (issue
    #27). All non-scan plugin commands bypass the command bus.

---

## Open issues

### 1. Five `pluginLifecycle/*.ts` use cases are no-op pass-throughs

**Problem:** `loadPlugin.ts`, `unloadPlugin.ts`, `openPluginGui.ts`,
`closePluginGui.ts`, `processAudioIPC.ts` each have one line that
forwards to the same-named repository function with `ReturnType<typeof
…Repo>` as the return type. Zero validation, error mapping, store
mutation, or orchestration. Exists only to satisfy the architectural
shape "useCases wrap repositories". Compounds into five files of
indirection plus a barrel re-export per file.

**Representative files:**

- `src/modules/Plugin/useCases/pluginLifecycle/loadPlugin.ts`
- `src/modules/Plugin/useCases/pluginLifecycle/unloadPlugin.ts`
- `src/modules/Plugin/useCases/pluginLifecycle/openPluginGui.ts`
- `src/modules/Plugin/useCases/pluginLifecycle/closePluginGui.ts`
- `src/modules/Plugin/useCases/pluginLifecycle/processAudioIPC.ts`

**Needed:** Either add a real responsibility per file (instance-cache
validation, error → `notifyUser`, AppAction integration), inline the
repos in `useCases/index.ts`, or fold lifecycle into a single
`pluginLifecycle.ts` file.

### 2. `processAudioIPC` swallows errors and returns the input array

**Problem:** `repositories/pluginBridge/processAudioIPC.ts:24-27`
catches every error from `tauriInvoke('audio_ipc', …)` and returns
the input `Float32Array`. The audio path continues with unprocessed
audio and no UI signal. At audio-block rate, every error logs another
warning (log spam at audio rate).

**Representative files:**

- `src/modules/Plugin/repositories/pluginBridge/processAudioIPC.ts:8-28`

**Needed:** (a) Throttle the error log (once per second, with a
counter). (b) Mark the instance as "errored" in a store so the UI can
disable the device and notify the user. (c) Decide policy: pass-through
vs silence vs disconnect — and document it. (d) Return a typed result
(`{ ok: true, data } | { ok: false, error }`) instead of mixing
"success" and "fallback".

### 3. Per-audio-block allocations in `processAudioIPC`

**Problem:** `new Uint8Array(audioData.buffer)` and
`new Float32Array(responseArray.buffer)` allocate two typed-array
header objects per block (~700 allocations/sec at 44.1 kHz / 128). At
the same time, `audioData.buffer` is reused without a transfer/detach
contract — the IPC layer's behaviour around buffer ownership is
undocumented. Additionally, `new Float32Array(responseArray.buffer)`
will throw `RangeError` if Rust returns a buffer whose byte length is
not a multiple of 4.

**Representative files:**

- `src/modules/Plugin/repositories/pluginBridge/processAudioIPC.ts:15,23`

**Needed:** (a) Pre-allocate input/output buffer pools indexed by
instanceId (one of each per active plugin). (b) Use `transferable`
explicitly so ownership is clear. (c) Validate
`responseArray.byteLength % 4 === 0` before constructing the
Float32Array view. (d) Document whether the audio worklet thread or
the main thread owns this call (see issue #49).

### 4. `processAudioIPC` is on a real-time path that crosses Tauri IPC

**Problem:** Per-block IPC round-trip from JS to Rust cannot meet a
2.9 ms (44.1 kHz / 128) deadline. AGENTS.md states "Audio RT Safety:
The audio thread must NEVER allocate, lock mutexes, or block." The
function name and comment imply this is on the audio path. Either it
is dead code (audio worklets cannot call `tauriInvoke`) or it is on
the main thread acting as a per-block proxy — which still misses the
deadline.

**Representative files:**

- `src/modules/Plugin/repositories/pluginBridge/processAudioIPC.ts:1-28`
- `src/modules/Plugin/useCases/pluginLifecycle/processAudioIPC.ts`

**Needed:** Replace per-block IPC with a SharedArrayBuffer ring buffer
(rtrb-equivalent) shared between the worklet and a Rust audio thread.
Audio data is written/read via atomics; Tauri commands are reserved
for non-RT control messages. If this is unimplementable today, the
function should return null + log "native plugin processing not yet
implemented" instead of pretending to forward audio.

### 5. `importPresetJson` does no schema migration and validates only two fields

**Problem:** `repositories/proofChamberPresets/importPresetJson.ts:3-13`:
parses JSON with an immediate `as ProofChamberEngineState` cast (escape
hatch), then verifies only `mix` and `decay` are numbers. Any malformed
field is spread into `DEFAULT_PARAMS`. No `schemaVersion`. No
migration path. Saved presets will silently break on any model change.

**Representative files:**

- `src/modules/Plugin/repositories/proofChamberPresets/importPresetJson.ts:3-13`
- `src/modules/Plugin/repositories/proofChamberPresets/exportPresetJson.ts:3-5`
- `src/modules/Plugin/models/ProofChamberState.ts:5-27`

**Needed:** (a) Add a `schemaVersion: 1` field to the export envelope
(`{ schemaVersion: 1, params: ProofChamberEngineState }`). (b) Validate
each field with a Zod schema mirroring `ProofChamberEngineState` — type
+ range + enum membership. (c) Implement `migratePreset(version, raw)`
that handles older schemas. (d) Drop the `as ProofChamberEngineState`
cast — narrow `unknown` via the validator. (e) Add tests for: missing
field, wrong-type field, out-of-range value, unknown enum value, future
`schemaVersion: 2`, garbage `_version: 'banana'`.

### 6. Vanilla WAM pass-through plugins ship as silent unity gain

**Problem:** `useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts:59`
returns `context.createGain()` for any descriptor without a custom
loader and without `isHighEnd`. The 13 vanilla descriptors in
`builtinDescriptors.ts` (Compressor, EQ, Reverb, Delay, Chorus, etc.)
all hit this path. The user adds "Compressor" to a track and gets unity
gain.

**Representative files:**

- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts:59`
- `src/modules/Plugin/useCases/wamPluginHost/builtinDescriptors.ts:5-126`

**Needed:** Either (a) implement actual DSP for each descriptor and
register a loader, or (b) remove the descriptors that have no DSP from
`BUILTIN_WAM_DESCRIPTORS` until they are real, or (c) at minimum mark
them with `isStub: true` and surface the stub state in the UI ("Not
yet implemented — passes audio through unchanged").

### 7. No race coalescing for plugin load/unload

**Problem:** Two parallel `loadPlugin(pluginId, instanceId)` calls
issue two IPC commands. The Rust side is the only thing guaranteeing
idempotency. `loadWAMPlugin` does the same — `instances.set(...)` will
overwrite a previously-allocated audio node, leaking it. Cross-format
unload has no shared abstraction; switching a track between native and
WAM plugins has two different code paths.

**Representative files:**

- `src/modules/Plugin/useCases/pluginLifecycle/loadPlugin.ts`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts:62-71`
- `src/modules/Plugin/repositories/pluginBridge/unloadPlugin.ts:3-8`

**Needed:** Promise-coalesce per `(pluginId, instanceId)` in a
module-level `Map<string, Promise<…>>`. Implement a single
`tearDownDevice(deviceId)` use case that dispatches to the right format
based on the device's `pluginFormat` field. Add a test that two
concurrent `loadPlugin(p, i)` calls produce one IPC invocation.

### 8. WAM `helpers.ts` exposes raw `Map`s; no Store, no subscription

**Problem:** `useCases/wamPluginHost/hostOperations/helpers.ts:6-8`
exports `registry: Map<string, WAMDescriptor>` and `instances:
Map<string, WAMInstance>` as plain Maps. All eight ops mutate them
directly. UI components cannot react to plugin load/unload without
polling. `getActiveInstances()` returns a fresh `Map` clone (allocates
O(n) per call).

**Representative files:**

- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/helpers.ts:6-8`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/getActiveInstances.ts:5-7`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/getRegisteredPlugins.ts:5-7`

**Needed:** Wrap `registry` and `instances` in `Store<…>` instances
(matching `pluginScanStore` / `chamberStore`). Provide
`useStore(wamInstancesStore)`-style subscriptions. Drop the per-call
clone in `getActiveInstances`.

### 9. `initWAMEnvironment` stamps a custom property on AudioContext via double-cast

**Problem:** `wamPluginHost/hostOperations/initWAMEnvironment.ts:5`:
`(context as unknown as Record<string, unknown>).__wamGroupId =
groupId`. AGENTS.md "TypeScript — soundness" forbids `as unknown as`.
Stamping a custom property on a host-provided `AudioContext` risks
collision with future browser API additions.

**Representative files:**

- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/initWAMEnvironment.ts:5`

**Needed:** Replace with a module-level `WeakMap<AudioContext,
string>`. The map is GC-safe and avoids the cast. Update any reader of
`__wamGroupId` to consult the WeakMap.

### 10. `unloadWAMPlugin` triple-cast destroy detection

**Problem:** `unloadWAMPlugin.ts:9-15` uses three sequential casts
(`unknown`, `{ destroy: unknown }`, `{ destroy: () => void }`) to call
a `.destroy()` method that may or may not exist. Two AGENTS.md
violations (assertion escapes).

**Representative files:**

- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/unloadWAMPlugin.ts:9-15`

**Needed:** Type `WAMInstance.audioNode` as `AudioNode & { destroy?():
void }` (or define a `WamAudioNode` extending `AudioNode`). Then call
`instance.audioNode.destroy?.()` with no casts.

### 11. `compileAllFaustModules` parallelises 17+ compilations against a single LibFaust

**Problem:** `compilerEngine.ts:200-203`:
`Promise.all([...modules.keys()].map(compileFaustDSP))`. The
`compilationPromises` cache deduplicates same-id calls but cannot
serialise across different ids. `LibFaust` is a singleton instance and
its `compile` method is not documented as reentrant. 17 parallel
compilations against the same WASM heap risk corruption or crash.

**Representative files:**

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:198-203`

**Needed:** Serialise compilations behind a single promise chain.
`for (const id of modules.keys()) await compileFaustDSP(id);`. If
parallelism is a goal (it cuts boot time), document the upstream's
reentrancy guarantee first.

### 12. `attemptCreateNode` retries on string-matched library errors

**Problem:** `compilerEngine.ts:255,261` checks
`msg.includes('already registered')` and `msg.includes('is not defined
in AudioWorkletGlobalScope')`. Upstream library version bumps that
rephrase errors silently disable the retry.

**Representative files:**

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:243-281`

**Needed:** Define a `FaustNodeCreateError` discriminated union (e.g.
`{ kind: 'workletAlreadyRegistered' } | { kind: 'workletNotInGlobalScope'
} | { kind: 'unknown'; cause: unknown }`) and dispatch on `kind`. If
the upstream library does not emit typed errors, file an upstream
issue and pin the version.

### 13. `compileFaustDSP` returns `false` for both "module not registered" and "compilation failed"

**Problem:** Same return value for two unrelated failure modes.
Callers (especially the `pluginLoaderRegistry`-wired Faust loader)
collapse both to `null`, then `loadWAMPlugin` reports a generic
`'Plugin failed to load'` notification.

**Representative files:**

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:146-195,305-313`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts:23-37`

**Needed:** Return a `Result<true, FaustError>` and surface the cause
to the user ("Faust plugin '%s' failed: module not registered" vs
"Faust plugin '%s' failed: compilation error"). Use `neverthrow`
(per project tech decisions) or the existing `createFaustError`.

### 14. No schema versioning on preset JSON

**Problem:** `exportPresetJson` writes the engine state directly with
no `schemaVersion`. Every model change breaks every saved preset. See
also issue #5.

**Representative files:**

- `src/modules/Plugin/repositories/proofChamberPresets/exportPresetJson.ts:3-5`
- `src/modules/Plugin/repositories/proofChamberPresets/importPresetJson.ts`

**Needed:** Wrap in
`{ schemaVersion: 1, kind: 'proofChamber', params: ProofChamberEngineState }`.
Read it back through the validator (issue #5).

### 15. `saveUserPreset` ID is `Date.now()` — collision-prone

**Problem:** `repositories/proofChamberPresets/saveUserPreset.ts:9`:
two presets created in the same millisecond share an id and become
indistinguishable.

**Representative files:**

- `src/modules/Plugin/repositories/proofChamberPresets/saveUserPreset.ts:8-13`

**Needed:** Use `crypto.randomUUID()` (matches the rest of the
codebase — see `nodeView.ts:64`).

### 16. `getUserPresets` silently returns `[]` for corrupted JSON

**Problem:** `helpers.ts:209-211` swallows `JSON.parse` errors. User's
presets disappear without warning.

**Representative files:**

- `src/modules/Plugin/repositories/proofChamberPresets/helpers.ts:203-213`

**Needed:** On parse failure, `notifyUser` ("Saved presets could not be
loaded — file may be corrupt") and offer a "reset" action. Log the
underlying error.

### 17. Type-assertion escapes throughout `helpers.ts` factory presets

**Problem:** `helpers.ts:29-194`: 15 presets each cast string literals
to `SpaceType` / `ProofChamberAlgorithm`. Bypasses union exhaustiveness
checking. A missing/typo'd preset value is invisible to the compiler.

**Representative files:**

- `src/modules/Plugin/repositories/proofChamberPresets/helpers.ts:20-194`

**Needed:** Drop the `as SpaceType` / `as ProofChamberAlgorithm`
casts — the literal `'hall'` is already assignable to `SpaceType` if
typed correctly. Use `satisfies ProofChamberPreset` on each entry to
catch shape errors. Tighten `SPACE_PRESETS` typing if needed.

### 18. `AppAction` surface only covers `scanPlugins`

**Problem:** `getPluginHostHandlers` registers one handler.
`loadPlugin`, `unloadPlugin`, `openPluginGui`, `closePluginGui`,
`processAudioIPC` are not action-driven; consumers must call the use
cases directly. Bypasses the command bus, undo/redo, and recording.

**Representative files:**

- `src/modules/Plugin/useCases/getPluginHostHandlers.ts:10-14`
- `src/modules/Plugin/handlers/pluginHost/handleScanPlugins.ts`

**Needed:** Add `loadPlugin`, `unloadPlugin`, `openPluginGui`,
`closePluginGui`, `setPluginParameter` AppActions and their handlers.
Decide which are undoable. Wire `ProofChamberPanel.setParam` through
the new typed handler instead of the current
`{ type: 'setDeviceParameter', payload: { deviceId, paramId, value } }`
ad-hoc shape.

### 19. `ProofChamberPanel.selectSpace` dispatches 18+ actions per click

**Problem:** `presentations/views/ProofChamberPanel.tsx:200-231`: a
single space change loops over `Object.entries(nextParams)` and fires
~18 separate `setDeviceParameter` actions. No batching.

**Representative files:**

- `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx:199-231`

**Needed:** Add a `setDeviceParameters` (plural) AppAction with a
`{ deviceId, params: Record<string, number> }` payload that dispatches
all changes atomically. Update `selectSpace` to use it.

### 20. `setDeviceParameter` payload encodes booleans as 0/1 with no discrimination

**Problem:** `ProofChamberPanel.setParam` casts boolean → 0/1 before
dispatch. Rust must know which params are booleans. No discriminated
union.

**Representative files:**

- `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx:181-196`

**Needed:** Discriminated payload:
`{ deviceId, paramId, value: { kind: 'number'; value: number } | { kind: 'bool'; value: boolean } | { kind: 'enum'; value: string } }`.
The Rust side already needs to know — encode it.

### 21. `DecayEqOverlay` callback dispatches `mult` instead of `value`

**Problem:** `presentations/views/ProofChamberPanel.tsx:387-391`:
payload `{ deviceId, paramId, mult }` is missing `value`. Either the
action contract has a discriminated `setDecayEqMultiplier` variant, or
this is a typo that ships an unknown property.

**Representative files:**

- `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx:384-393`

**Needed:** Inspect the `setDeviceParameter` action contract; rename
to `value` if it is the canonical field, or add a typed
`setDeviceMultiplier` action.

### 22. `ReverbSpectrogram` is fake but labelled "Live"

**Problem:** `presentations/views/ProofChamberPanel.tsx:738-827`:
canvas-only synthesis driven by knob values. `tailViewLed` shows
"Live tail" while no real audio data is reaching the canvas.

**Representative files:**

- `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx:233-238,738-827`

**Needed:** Either feed real spectrogram data from an
`AnalyserNode` attached to the chamber's output, or rename to
"Decay preview" and remove the "Live" label.

### 23. `SpectrogramView` shows nothing in the not-mocking path but is labelled "Live"

**Problem:** `presentations/views/SpectrogramView.tsx:34-48`: when
`isMocking === false`, the canvas just shifts left and clears the
right-most column with no draw. Label switches to "Live". Black
frame masquerades as a live spectrogram.

**Representative files:**

- `src/modules/Plugin/presentations/views/SpectrogramView.tsx:34-66`

**Needed:** Either accept a `Float32Array` prop and render real FFT
bins, or remove the not-mocking branch entirely and treat
`SpectrogramView` as a placeholder until real data is wired.

### 24. Push integration is store-only — no MIDI / SysEx / hardware I/O

**Problem:** All `pushIntegration/*.ts` use cases mutate
`pushStore` and never reach the hardware. `connectPush` is a flag
toggle. There is no `repositories/pushHardware.ts`, no
`navigator.requestMIDIAccess`, no Push 2 SysEx.

**Representative files:**

- `src/modules/Plugin/useCases/pushIntegration/connectPush.ts:1-10`
- `src/modules/Plugin/useCases/pushIntegration/disconnectPush.ts`
- `src/modules/Plugin/useCases/pushIntegration/setPadColor.ts`
- `src/modules/Plugin/useCases/pushIntegration/setEncoderValue.ts`
- (others)

**Needed:** Add `repositories/pushHardware.ts` with WebMIDI
enumeration, SysEx output for Push 2 colour codes, and bitmap blitting
for the display. Either implement, or rename the folder to
`pushSimulation/` to be honest about what it is.

### 25. Push pad mutation is O(64) per single-pad event

**Problem:** Every pad event rebuilds the entire 64-element array via
`.map(...)`. The store file's own header comment acknowledges this.
For polyphonic-aftertouch at 25 Hz × 64 pads, ~100K allocations/sec.

**Representative files:**

- `src/modules/Plugin/stores/push.ts:80-86`
- `src/modules/Plugin/useCases/pushIntegration/handlePadPress.ts:14-17`
- `src/modules/Plugin/useCases/pushIntegration/handlePadRelease.ts:8-11`
- `src/modules/Plugin/useCases/pushIntegration/setPadColor.ts:8-11`

**Needed:** Replace `pads: PushPad[]` with `pads: Record<number,
PushPad>` (or `Map<number, PushPad>`) for O(1) updates. Update the UI
selector to iterate `Object.values(pads)`.

### 26. `wamPluginHost` and `pluginLoaderRegistry` use raw module-level Maps; HMR-unsafe

**Problem:** `helpers.ts`, `compilerEngine.ts`,
`pluginLoaderRegistry.ts` all hold mutable state in module-level
`Map`/`WeakMap`/`object` singletons. HMR re-runs the module init,
duplicating registrations and leaking the previous state.

**Representative files:**

- `src/modules/Plugin/services/pluginLoaderRegistry.ts:18`
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:41,44,55,59`
- `src/modules/Plugin/useCases/wamPluginHost/hostOperations/helpers.ts:6,8`

**Needed:** Either store these registries inside `Store<…>` instances
(`pluginScanStore`-style) so HMR cleans up via the store contract, or
add `import.meta.hot.accept(() => { /* clear maps */ })` blocks. Same
issue flagged in AudioAnalysis audit #25.

### 27. `pluginLoaderRegistry` overwrite-without-warning + first-match dispatch

**Problem:** `services/pluginLoaderRegistry.ts:18-32`: `set` silently
overwrites; `findPluginLoader` returns the first matching prefix in
insertion order. Two prefixes (`'faust.'`, `'faust.poly.'`) are
ambiguous.

**Representative files:**

- `src/modules/Plugin/services/pluginLoaderRegistry.ts:18-33`

**Needed:** (a) Throw if a prefix is registered twice (or `logger.warn`).
(b) `findPluginLoader` must return the **longest** matching prefix.
(c) Add `unregisterPluginLoader(idPrefix)`. (d) Test all three.

### 28. MIDI effect factories are dead code

**Problem:** Seven `createX()` factories return
`{ id, name, process: (notes) => notes }` objects. Nothing in the
audio engine consumes them. The registry array is exported via
`useCases/index.ts` and used nowhere else.

**Representative files:**

- `src/modules/Plugin/useCases/midiEffectPlugins/registry.ts`
- `src/modules/Plugin/useCases/midiEffectPlugins/createChordGenerator.ts`
- `src/modules/Plugin/useCases/midiEffectPlugins/createScaleFilter.ts`
- `src/modules/Plugin/useCases/midiEffectPlugins/effectFactories/*.ts`

**Needed:** Either wire them into the MIDI track effect chain (with a
real-time-safe `process` that operates on event streams, not arrays),
or delete the unused factories. Document the integration in
`docs/`.

### 29. `createScaleFilter` non-null assertion on `SCALES.major!`

**Problem:** AGENTS.md TypeScript-soundness violation. `SCALES.major`
is provably defined but the `!` is still an escape.

**Representative files:**

- `src/modules/Plugin/useCases/midiEffectPlugins/createScaleFilter.ts:4`

**Needed:** Tighten `SCALES` to a `Record<KnownScaleName, number[]>`
where `KnownScaleName` is a literal union, then index without `!`.

### 30. `processAudioIPC` browser-mode returns input by reference; success returns fresh allocation

**Problem:** `repositories/pluginBridge/processAudioIPC.ts:9-11` returns
`audioData` (input reference) when `!isTauri()`. The success branch
allocates a new Float32Array. Callers that mutate the returned array
will, in browser mode, mutate the input.

**Representative files:**

- `src/modules/Plugin/repositories/pluginBridge/processAudioIPC.ts:9-11,23`

**Needed:** Either always return a fresh array (clone in browser
mode), or document the "returned array may alias the input" contract.
Better: always own the output buffer pool and document.

### 31. `pluginScanStore` redeclares `ScannedPlugin`

**Problem:** Two independent declarations of the same DTO. A schema
change in one silently desyncs the other.

**Representative files:**

- `src/modules/Plugin/stores/pluginScanStore.ts:8-20`
- `src/modules/Plugin/repositories/pluginBridge/types.ts:5-17`

**Needed:** The store should hold a domain type
(`PluginScanRecord` or similar) that does **not** depend on the IPC
DTO. The repo's `ScannedPlugin` type stays private to the
repository per AGENTS.md "Model isolation". Remove the cross-
boundary duplication.

### 32. `startPluginScan` does not coalesce concurrent runs

**Problem:** Two parallel `startPluginScan` invocations both write
`isScanning: true`, both await IPC, both write the result. The later
one wins; the earlier `errors` are lost.

**Representative files:**

- `src/modules/Plugin/useCases/pluginScan/scanning/startPluginScan.ts:7-41`

**Needed:** Promise-coalesce: `if (state.isScanning) return ongoing;`.
Add a test that two concurrent `startPluginScan` calls produce one
IPC invocation.

### 33. `startPluginScan` and `scanCustomPaths` have inconsistent merge semantics

**Problem:** `startPluginScan` overwrites `scannedPlugins` wholesale;
`scanCustomPaths` merges by id. Documented nowhere.

**Representative files:**

- `src/modules/Plugin/useCases/pluginScan/scanning/startPluginScan.ts:26-32`
- `src/modules/Plugin/useCases/pluginScan/scanning/scanCustomPaths.ts:13-20`

**Needed:** Pick one convention and apply it consistently. Document
the choice in JSDoc.

### 34. Use-case types leak through `useCases/index.ts`

**Problem:** `useCases/index.ts:17,32,51` exports four types via
`export type { … }`. AGENTS.md "Use-case types stay private". Through
the root barrel, these types are visible to every other module.

**Representative files:**

- `src/modules/Plugin/useCases/index.ts:17,32,51`
- `src/modules/Plugin/index.ts`

**Needed:** Strip the type re-exports. Audit cross-module callers
(`grep -r "from '#/modules/Plugin'"` for `import type`) and replace
with the consumer's own local types per AGENTS.md "Model isolation".

### 35. Function signatures take positional args (AGENTS.md violation)

**Problem:** Multiple files take 2–3 positional parameters where
AGENTS.md mandates a single object param.

**Representative files:** see Finding #61 for the full list — 17
functions across `repositories/`, `useCases/`, `services/`.

**Needed:** Refactor each to a single object param named
`<FunctionName>Input` per AGENTS.md. Mostly mechanical; care with the
public contract (load/unload/openGui surfaces are exposed
cross-module).

### 36. `pushStore.encoders.value` is unconstrained `number`

**Problem:** `setEncoderValue` clamps but the store type does not.
Direct `.set(...)` calls bypass the clamp.

**Representative files:**

- `src/modules/Plugin/stores/push.ts:33-37`
- `src/modules/Plugin/useCases/pushIntegration/setEncoderValue.ts:11`

**Needed:** Type as a branded `MidiByte` (0–127) at the model level, or
clamp on every store mutation, not only on the use case.

### 37. `PARAM_MAP: Record<string, string>` not constrained

**Problem:** `models/ProofChamberState.ts:89`: weak typing.
`PARAM_MAP[key as string]` returns `string | undefined`. A typo in
`PARAM_MAP` keys is invisible.

**Representative files:**

- `src/modules/Plugin/models/ProofChamberState.ts:89-110`

**Needed:** Tighten to
`Record<keyof ProofChamberEngineState, string>`. Compiler then
forces exhaustive map of every engine field.

### 38. `compilerEngine` registers a global Faust loader at module init via side effect

**Problem:** `compilerEngine.ts:305-313` calls
`registerPluginLoader('faust.', …)` at module-load time. This
ties Faust availability to import order. If a consumer imports
`compilerEngine` lazily (after the WAM host has already tried to
load a `faust.*` plugin), the load fails with "no loader".

**Representative files:**

- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:305-313`

**Needed:** Move the registration into an explicit
`registerFaustPluginLoader()` function that is called from the
module bootstrap (alongside `registerBuiltinFaustDSP`,
`registerBuiltinPlugins`). Document the expected boot order.

### 39. `WAMDescriptor.sdkVersion` is hardcoded `'2.0'` with no negotiation

**Problem:** Every descriptor in `builtinDescriptors.ts` and the
Faust-derived descriptors in `compilerEngine.ts:131-135` set
`sdkVersion: '2.0'`. There is no version negotiation logic. Loading a
"WAM 2.1" plugin would fail or coerce silently.

**Representative files:**

- `src/modules/Plugin/useCases/wamPluginHost/builtinDescriptors.ts:11,21,…`
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:131-135`

**Needed:** Either implement actual SDK-version handshake (the WAM 2.0
spec defines one) or document that this field is decorative until WAM
becomes real (issue #6).

### 40. Tests use `as any` and partial fixtures (sample)

**Problem:** Spec files cast partial fixtures and use `as any` to
satisfy types, breaking AGENTS.md "Tests assert the actual contract".

**Representative files:**

- `src/modules/Plugin/useCases/pluginLifecycle/__tests__/processAudioIPC.spec.ts`
  (no error-path coverage; spec just verifies forwarding)
- `src/modules/Plugin/repositories/proofChamberPresets/__tests__/importPresetJson.spec.ts:8,17,21`
  (only happy path with two-field JSON)
- `src/modules/Plugin/repositories/proofChamberPresets/__tests__/helpers.spec.ts:9-19`
  (asserts uniqueness only, no per-preset value validation)

**Needed:** Build typed fixtures (full `ProofChamberEngineState`,
typed `ScanResult`, typed `PluginInstance`). Add error-path tests
matching each `try/catch` branch. Replace `as any` with
`vi.mocked(fn)` and the real generic.

---

## Open questions

- [ ] Where exactly does `processAudioIPC` run — main thread or audio
      worklet? The comment says "AudioWorklet to Rust" but `tauriInvoke`
      is not callable from a worklet. Resolve before deciding the
      audio-thread allocation/IPC fix.
- [ ] Are the 13 vanilla WAM descriptors (Compressor, EQ, etc.) meant
      to be real plugins eventually, or are they UI-only stubs awaiting
      Faust/Tauri DSP wiring? Affects whether issue #6 is a bug or a
      "do not promote yet" item.
- [ ] Is the `pushIntegration/` folder intentionally store-only
      (a simulator), or is the hardware bridge planned but missing? If
      the latter, the spec needs a `repositories/pushHardware.ts`
      target.
- [ ] Are `MIDI_EFFECT_FACTORIES` consumed by any UI (presumably a
      MIDI track's "add effect" menu)? If so, where? If not, what is
      the integration plan?
- [ ] What is the canonical `setDeviceParameter` payload shape? The
      panel uses `{ deviceId, paramId, value }` and (in the Decay-EQ
      branch) `{ deviceId, paramId, mult }`. Is this a single action
      with two payloads, two actions, or a typo?

---

## Risks

- **Audio-thread glitches.** Issue #4 (per-block IPC + per-block
  alloc) is a real-time deadline violation. Users will hear
  glitches/dropouts whenever Tauri IPC stalls (every GC, every Rust
  handler that holds a Tokio task).
- **Silent feature stubs.** Issues #6, #15 (vanilla WAM
  pass-throughs), #22, #23 (fake spectrograms), #24 (Push), #28
  (MIDI effects). The `Plugin` module ships a **labelled** feature
  surface that does not match its **implemented** surface. Users
  drag "Compressor" onto a track, see a panel, and hear no
  compression — with no error.
- **Preset corruption.** Issues #5, #14, #15, #16. Any non-trivial
  schema evolution silently breaks every saved preset; corrupted
  localStorage silently loses every saved preset; two presets in the
  same millisecond share an id.
- **Resource leaks on lifecycle errors.** Issue #7. Two parallel
  loads leak audio nodes; failed unloads leave instance ids
  un-reusable; cross-format unloads have no shared abstraction.
- **AGENTS.md violations accumulating.** Issues #9, #10, #14, #17,
  #29, #34, #35. Type-assertion escapes (8+ instances), positional
  args (17 functions), use-case type leakage (4 types). Left
  unaddressed they normalise the workarounds and make a future
  full-typing pass painful.
- **DSP / accuracy credibility.** Same theme as AudioAnalysis: the
  module hosts a `ReverbSpectrogram` and a `SpectrogramView` that
  **simulate** their outputs while UI labels them "Live". Users
  notice; trust erodes.

---

## Suggested approaches

- **Land issue #5 (preset schema validation) first.** Add Zod schema +
  `schemaVersion: 1` to `exportPresetJson`; rewrite `importPresetJson`
  to validate, migrate, and clamp. Drop the
  `as ProofChamberEngineState` cast. Tests come for free.
- **Replace `processAudioIPC`'s per-block IPC** (issues #2, #3, #4,
  #30) with a shared-buffer ring on a Rust audio thread. If that is
  beyond scope today, gate the use case behind a "not yet
  implemented" notification — the silent pass-through is worse than
  an explicit failure.
- **Promise-coalesce all lifecycle paths** (issue #7). One pattern, two
  files (Tauri load + WAM load). Add a single `tearDownDevice`.
- **Decide WAM strategy** (issue #6). Either implement the 13 vanilla
  descriptors (each a Faust DSP probably) or drop them from the
  builtin list. Surface "Coming soon — passes audio through" if the
  middle path is acceptable.
- **Fix the fake spectrograms** (issues #22, #23). Wire an
  `AnalyserNode` from the chamber output; rename or delete the
  not-mocking branch of `SpectrogramView`.
- **AGENTS.md compliance pass** (issues #9, #10, #29, #34, #35) as a
  follow-up sweep — small mechanical refactors that should land as a
  single commit per issue.
- **Decide the Push strategy** (issue #24). Either implement WebMIDI +
  SysEx for Push 2/3, or rename the folder to `pushSimulation/` and
  add a `Coming soon` chip on the UI.
- **Decide the MIDI-effects integration** (issue #28). Either wire
  through the audio engine's MIDI path or delete the seven factories.
- **Tighten `pluginLoaderRegistry`** (issue #27). Longest-prefix match,
  overwrite warning, unregister fn.
- **Replace WAM/Faust/loader-registry raw `Map`s with `Store<…>`** (issues
  #8, #26).

---

## Recommendation

Start with **issue #5 (preset schema + migration)**. The work is
mechanical, has a clear "good" target (Zod-validated, versioned), and
the test surface is small. Land as a standalone commit; follow with
**issue #6 (vanilla WAM pass-through)** because the user-visible
"Compressor as unity gain" bug is the most embarrassing item in this
audit.

After those two land, the next session can split between the
"correctness pass" (issues #2, #3, #4, #7, #30) and the "AGENTS.md
compliance + dead code" pass (issues #1, #9, #10, #24, #28, #29, #34,
#35). They are independent.

---

## Resolved

_No issues resolved yet._
