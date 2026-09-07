# AudioEngine module — Agent Guidelines

WebAudio graph runtime: hosts every release-admitted built-in device as a WASM engine node, plus the buffer cache, recording feeds, offline rendering, and latency compensation.

## Domain Ownership

Owns the WebAudio runtime graph (`AudioContext`, track/bus strips, send/sidechain routing), built-in WASM device hosting, sample buffer cache (`stores/audioBufferCache.ts`), audio input recording/monitoring, offline rendering orchestration, and latency compensation. Does not own timeline/clip arrangements (Arrangement), audio export encoding (AudioRendering), warp marker editing (ElasticAudio), or third-party plugin sandbox lifecycle (PluginHost).

## Public Contract Surface

- **`useCases`**: Audio context & engine lifecycle (`initializeAudioEngine`, `getAudioContext`, `audioEngine`, `getAudioTime`, `getEngineState`, `getEngineDiagnostics`, `getEngineHealth`, `isEngineAudioAvailable`, `refreshEngineRtDiagnostics`, `resetAudioGraph`, `resumeEngine`, `waitForDevices`), audio buffer cache (`audioBufferCache`, `cacheAudioBuffer`, `getCachedAudioBuffer`, `decodeAudioFile`, `decodeAudioFileBuffer`), recording feeds (`startAudioRecording`, `stopAudioRecording`, `startInputMonitoring`, `stopInputMonitoring`), device controls (`buildDeviceChain`, `updateDeviceParam`, `updateDevicePatch`, `scheduleDeviceParam`, `scheduleDeviceKeyOn`, `scheduleDeviceKeyOff`), track/bus audio controls (`setTrackGain`, `setTrackPan`, `scheduleTrackGain`, `scheduleTrackPan`, `ensureTrackStrip`, `removeTrackStrip`, `ensureBusStrip`, `removeBusStrip`, `setSend`, `wireSidechainRoute`), offline rendering (`renderOffline`, `exportStems`, `renderTrackSubgraphOffline`), latency compensation (`getTrackLatency`, `getCompensationDelay`, `getSidechainKeyDelay`, `getLatencyReport`, `reportLatency`), graph compilation & delta (`compileAudioGraphTopology`, `applyRuntimeGraphDelta`, `compileRuntimeGraphDelta`), and handler map `getFinalFeatureHandlers`.
- **`events`**: `AudioDeviceLoadedPayload`, `AudioDeviceRemovedPayload`.
- **`stores`**: `audioBufferCache`, `audioGraphStore` (`defaultAudioGraphState`), `audioRecordingStore`, `adjustmentApplicationStore`.
- **`presentations/views`**: `AudioDevicePicker`, `MidiDevicePicker`, `PluginBrowser`, `PluginScanSettings`.
- **Handler maps**: `getFinalFeatureHandlers`.

## Key Subsystems

- **`engine/`**: Runtime graph nodes (`TrackNode`, `BusNode`, `AdjustmentBusNode`, `AdjustmentLayerRuntime`, built-in WASM device nodes: `BacteriaNode`, `CrumbsNode`, `CrustNode`, `FermenterNode`, `GlutenNode`, `GrandBouleNode`, `GrinderNode`, `KneadNode`, `LevainNode`, `ProofChamberNode`, `ProofNode`, `ScoringNode`, `ToasterNode`), `audioDeviceRuntimeSink.ts`, `wasmDeviceRegistry.ts`, `telemetryAllocator.ts`, `dropoutCounter.ts`. (Device id "Dutch Oven" is the ProofChamber reverb — there is no separate Dutch Oven module).
- **`wasm/`**: Generated JS glue for compiled Rust WASM crates (`crates/{daw-dsp,proof-chamber,scoring,daw-wasm-decoder}`).
- **`worklets/`**: AudioWorklet processors and node wrappers.
- **`workers/`**: Background workers (e.g. Grand Boule Worker behind SharedArrayBuffer ring).
- **`repositories/`**: Audio device selection, recording input streams.
- **`models/`**: `AudioEngineState.ts`, `AudioGraphBackend.ts`, `EngineRtDiagnostics.ts`, `BuiltinDeviceRuntime.ts`.

## Invariants & Traps

- **Audio thread safety**: AudioWorklet and audio rendering threads must never allocate heap memory, block, or take locks.
- **WASM device pipeline**: Device DSP lives in Rust crates and compiles to WASM: `pnpm wasm:all` runs `wasm-pack --target web` for `crates/{daw-dsp,proof-chamber,scoring,daw-wasm-decoder}` into `public/wasm/`. The `scripts/gen-*-worklet.ts` post-processors rewrite the wasm-pack JS glue into `src/modules/AudioEngine/wasm/`, prepending AudioWorklet-scope polyfills and replacing `new URL(..., import.meta.url)` with a static path so Vite does not bundle the `.wasm`. Re-run the `wasm:*` script after changing a crate; never hand-edit files under `AudioEngine/wasm/`.
- **Grand Boule runtime**: Grand Boule runs its live WASM engine in a Worker behind a SharedArrayBuffer ring. Offline render runs the same engine inline in an AudioWorklet, where no live deadline exists.
- **Release census**: The release census covers the complete `public/wasm` tree and every manifest-declared AudioEngine mirror. Package ids and artifact paths come from `scripts/wasm-artifacts.ts`; unknown sidecars, manifest paths, text references, or binary exports fail release validation.
- **Single realm singleton**: The main thread revalidates, fetches and asynchronously compiles each WASM URL once. A short-lived module lease is released on abort or host-construction failure; successful host construction commits one URL per bundle to the `AudioContext`, because wasm-bindgen glue is a realm singleton. Loading another version after that requires a fresh context and is rejected instead of silently retaining the old binary.
- **AudioWorklet instantiation**: AudioWorklet processors receive the structured-cloned `WebAssembly.Module` through `processorOptions`; Grand Boule's Worker receives the same compiled module. A separate port init message starts caught instantiation and the ready/error handshake. Processors call `initSync` and compile nothing on their real-time-adjacent threads. Shared module caching and handshake logic live in `src/infra/audioWorklet/workletInitShared.ts`.
- **Crumbs streaming**: Crumbs disk streaming is native-only (`crates/daw-dsp`). Browser playback and offline rendering run the same Crumbs engine in WASM, with decoded PCM preloaded into its in-memory sample pool.
- **Worklet boundaries**: Worklets import nothing from app modules, helpers, or desktop IPC. Depcruise `worklets-no-*` rules match `src/modules/<M>/worklets/**` only; raw processors in `public/audio/worklets/` must be manually isolated. `worker.format: 'iife'` in `vite.config.ts` allows worklet blob URLs to load bundles.
- **Single AudioContext**: Exactly one live `AudioContext` app-wide.
- **Faust synchronization**: Faust is wired in AudioEngine and PluginHost; changes in one require matching updates in the other.
- **External plugins are engine-hosted**: the native engine processes a hosted plugin inline on its own audio callback, inside the chain that holds it. The Web Audio graph carries a unity pass-through where such a device sits, so it adds no latency of its own and no audio crosses the process boundary per block.
- **Live topology attach state**: An `external-plugin` device has a native body exactly when the engine reports its instance attached, so the live topology producer takes that attach state as an input (read from PluginHost's parameter store) rather than deriving it from the device. `apply_graph_commands` captures its plugin lookup before mapping and attaches dormant instances behind the fence, so the batch that attaches an instance is always mapped before the engine holds it: binding it takes one further batch. A session start therefore sends its topology a second time when the first batch reports attachments — once, never in a loop, and only while the engine is parked, because a `replaceTopology` batch tears every strip down inside one fence and must never reach a rolling engine.
- **Unload releases narrow, never create**: `recordNativeChainReleases` is the sink `src/app/bootstrap.ts` registers for PluginHost's own unload releases; it only ever narrows a strip this session's own topology batch already built, because an unload cannot create one.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/AudioEngine`
- **Module boundaries**: `pnpm deps:validate`
- **WASM rebuild**: `pnpm wasm:all` or package-specific script
