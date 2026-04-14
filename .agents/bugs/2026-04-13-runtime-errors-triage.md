# Bug Report — Runtime Error Triage

**Date**: 2026-04-13  
**Environment**: Dev (localhost:5173)  
**Reporter**: triage via session log

---

## Bug 1 — DSO Validation Rejects Valid Track IDs

### Symptom
```
Edit rejected — Track "track-79ed6496" does not exist
Edit rejected — Track "track-acae5630" does not exist
Edit rejected — Track "track-e447409f" does not exist
Edit rejected — Track "track-37ebad18" does not exist
Edit rejected — Track "track-ec10fc5f" does not exist
```

### Source
`src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:457`

```ts
const trackIds = new Set(state?.tracks.map((t) => t.id) ?? []);
```

`validateDsos` reads `trackStore.value` at call time and builds a Set of currently-known track IDs. Any DSO referencing a track ID that is not yet reflected in that snapshot is rejected.

### Probable Cause
**Stale store snapshot at validation time.** The AI generates a batch of DSOs that include both a `create_track` operation and subsequent operations targeting the newly-created track. Because `validateDsos` reads the store *before* the create operations execute, the track IDs do not yet exist in the snapshot — so all downstream operations are incorrectly rejected.

Alternatively, this can occur if DSOs are applied across an async boundary where the arrangement store state diverges from the AI's context (e.g. the user deleted tracks between AI response generation and DSO application).

### Files
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:454–590` — `validateDsos`
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:457` — store snapshot

### Severity
High — silently drops valid AI edits; user sees no effect from AI instructions.

---

## Bug 2 — `$u is not defined` in AudioWorklet Processor Bundles

### Symptom
```
Uncaught ReferenceError: $u is not defined
    at d2f93892-d72d-4918-bac7-cfeb658dd048:9:10
    at a9a4664e-7464-46d8-ba9d-d5492bd6b6fd:9:10
    ... (9+ instances)
```

### Source
The UUID-named files are Vite-bundled AudioWorklet processor chunks. Each processor is imported via:
```ts
import bacteriaProcessorUrl from '../services/bacteriaProcessor.ts?worker&url';
```
and loaded with `ctx.audioWorklet.addModule(url)`.

### Probable Cause
**Bundler variable mangling in worklet scope.** The processors (bacteriaProcessor, grinderProcessor, grandBouleProcessor, etc.) import WASM bindings:
```ts
import '../wasm/workletPolyfill.js';
import { initSync, BacteriaInstance } from '../wasm/daw_dsp.js';
```
When Vite bundles these as `?worker&url` chunks, a shared module dependency is inlined and its minified export name (`$u`) is referenced but the binding is not available in the AudioWorklet global scope. This is a classic issue with Vite worker bundling when a shared chunk uses a module-level variable that isn't properly re-exported into the worker bundle.

Could also be triggered by the `?worker&url` flag generating worker-format bundles (with `self` as global) while the WASM glue code assumes `globalThis` or `window` for certain bindings.

### Files
- `src/modules/AudioEngine/services/bacteriaProcessor.ts`
- `src/modules/AudioEngine/services/grinderProcessor.ts`
- `src/modules/AudioEngine/services/grandBouleProcessor.ts` (and other `*Processor.ts` files)
- `src/modules/AudioEngine/engine/BacteriaNode.ts:8`
- `src/modules/AudioEngine/engine/GrinderNode.ts:5`
- `src/modules/AudioEngine/engine/GrandBouleNode.ts:15`
- `vite.config.ts` — worker bundle config

### Severity
Critical — all WASM-backed native processors (Bacteria, Grinder, Grand Boule, etc.) fail to load.

---

## Bug 3 — Faust AudioWorkletNode: Processor Name Not Registered in AudioWorkletGlobalScope

### Symptom
```
[Faust] Node creation failed for "Zita-Rev1 Reverb": Failed to construct 'AudioWorkletNode':
AudioWorkletNode cannot be created: The node name 'c5b293f4...' is not defined in AudioWorkletGlobalScope.
```
Affects: Zita-Rev1 Reverb, 1176 Compressor, FM Synth, Acid Bass 303, Supersaw Unison, Additive Synth, Hammond B3, Tape Delay, Pro Parametric EQ, Minimoog Lead, Rhodes.

### Source
`src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:213`

```ts
const node = await mod.generator.createNode(context);
```

The `generator.createNode(context)` call internally calls `context.audioWorklet.addModule()` with a blob URL containing the compiled Faust DSP, and registers a processor under a SHA-256 hash of the DSP code. The error reports that hash name.

### Probable Cause
Two likely causes (possibly both active):

1. **`addModule` succeeds but the processor is not yet registered when `new AudioWorkletNode(context, name)` is called.** The Web Audio spec makes no guarantee that `addModule` resolves only after `registerProcessor` has executed inside the worklet scope. If there's a race between multiple concurrent `createNode` calls, the serialization logic (`registrationPromises`) may be insufficient — particularly if the existing registration guard is bypassed when the worklet module has been added to the context before but the processor registration failed silently.

2. **Faust WASM compiler unavailable / returning null.** If `compileFaustDSP` returns `false` (compiler error or null result), `mod.compiled` is never set, but a stale `mod.generator` may still be present from a previous partial compile, leading `createFaustNode` to attempt node creation with an unregistered processor.

### Files
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:134–213`
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts`
- `src/modules/AudioEngine/repositories/deviceStrategy/FaustDeviceStrategy.ts`

### Severity
High — all Faust-based instruments and effects (synths, compressors, EQ, reverb, delay) fail to instantiate.

---

## Bug 4 — SharedArrayBuffer Unavailable (COOP/COEP Headers Not Sent)

### Symptom
```
[WebAudioEngine] Grand Boule failed: Error: SharedArrayBuffer is not available.
The server must send Cross-Origin-Opener-Policy: same-origin and
Cross-Origin-Embedder-Policy: require-corp headers.

[WebAudioEngine] Bacteria failed: ReferenceError: SharedArrayBuffer is not defined
[WebAudioEngine] Grinder failed: ReferenceError: SharedArrayBuffer is not defined
```

### Source
`vite.config.ts:17–20` and `vite.config.ts:76–79` — COOP/COEP headers ARE configured for the Vite dev server:
```ts
'Cross-Origin-Opener-Policy': 'same-origin',
'Cross-Origin-Embedder-Policy': 'require-corp',
```

### Probable Cause
The headers are configured in `vite.config.ts` but are not being sent in the actual HTTP responses in this session. Possible reasons:

1. **A different server or proxy is serving the app** (e.g. a preview build, a Docker container, Nginx without these headers, or a CDN stripping custom headers).
2. **The Vite dev server headers config applies only to the main server block** — if there is a separate `preview` server or HMR WebSocket server that doesn't carry these headers, the `SharedArrayBuffer` check can still fail when the page is cross-origin isolated check fails.
3. **Vite's `server.headers` applies but is conditional on a server config block** — if another config block is active (e.g. `preview` vs `server`), the headers may not be injected.

Note: This bug partially overlaps with Bug 2 — Grand Boule, Bacteria, and Grinder fail for both the `$u` worklet error AND the `SharedArrayBuffer` error. Both need to be resolved.

### Files
- `vite.config.ts:17–20` and `76–79`
- `src/modules/AudioEngine/engine/GrandBouleNode.ts`
- `src/modules/AudioEngine/services/grandBouleProcessor.ts` (SAB ring buffer layout)
- `src/modules/AudioEngine/services/bacteriaProcessor.ts`
- `src/modules/AudioEngine/services/grinderProcessor.ts`

### Severity
High — Grand Boule, Bacteria, and Grinder are entirely non-functional in this environment.

---

## Bug 5 — Automation Scheduling: Delay Time Value Out of Nominal Range

### Symptom
```
automationScheduling.ts:69
Delay.delayTime.linearRampToValueAtTime value 400.596 outside nominal range [0, 5];
value will be clamped.
```

### Source
`src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts:69`

```ts
param.linearRampToValueAtTime(value, sampleTime);
```

The `delayTime` AudioParam has a `maxValue` of `5` seconds (Web Audio spec default). Automation data stores delay time in some other unit (likely milliseconds or beats) and the value is written to the AudioParam without unit conversion or clamping.

### Probable Cause
**Unit mismatch: delay time automation is stored in milliseconds but the AudioParam expects seconds.** A value of `400.596` is reasonable as milliseconds (≈400ms) but is 80× out of range for a seconds-domain AudioParam. The `interpolateValue` function at line 68 returns a raw stored value without translating units, so the caller must handle unit conversion — but `scheduleAutomationOnParam` does not.

### Files
- `src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts:55–72`
- Caller chain: wherever `scheduleAutomationOnParam` is called for a `delayTime` param

### Severity
Medium — delay automation is silently clamped (value will be max 5s instead of intended value). Audio output is wrong but no crash occurs.

---

## Bug 6 — MP3 Export Fails: `@breezystack/lamejs` Dynamic Import Fails

### Symptom
```
GET http://localhost:5173/node_modules/.vite/deps/@breezystack_lamejs.js?v=841bdb49
    net::ERR_CONNECTION_REFUSED
TypeError: Failed to fetch dynamically imported module: ...@breezystack_lamejs.js
[DEV][ERROR] Error: Export failed
```

### Source
`src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts:63`

```ts
const { Mp3Encoder } = await import('@breezystack/lamejs');
```

`ExportDialog.tsx:261` → `audioBufferToMp3` → `mp3Encoder.ts:63`

### Probable Cause
**The Vite dev server was not running at the time of the export.** The dynamic import resolves to a pre-bundled Vite dep URL (`/node_modules/.vite/deps/...`) which is served by the Vite dev server. `ERR_CONNECTION_REFUSED` means the server at port 5173 was not reachable. This is a dev-only failure.

In production (build output), this would be a static bundled chunk and would not use the Vite dep URL. However, the dynamic import pattern means lamejs is excluded from the main bundle and fetched on demand — if the production CDN/server is also unreachable or the chunk is missing, the same failure will occur.

Secondary possibility: `@breezystack/lamejs` has a CommonJS-only entry point that Vite cannot pre-bundle correctly, causing the dependency cache to be invalid after a `vite.config.ts` change.

### Files
- `src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts:58–67`
- `src/modules/Project/presentations/views/ExportDialog.tsx:261, 363, 416`
- `package.json` — `"@breezystack/lamejs": "^1.2.7"`

### Severity
Medium (dev) / High (prod) — MP3 export is completely broken when the dev server is unreachable. The dynamic import should either be moved to a static import or have a more informative error shown to the user.

---

## Summary Table

| # | Title | Severity | Source File |
|---|-------|----------|-------------|
| 1 | DSO track ID validation uses stale store snapshot | High | `compileDso.ts:457` |
| 2 | `$u is not defined` in WASM worklet bundles | Critical | `*Processor.ts` / vite config |
| 3 | Faust AudioWorkletNode processor not registered | High | `compilerEngine.ts:213` |
| 4 | SharedArrayBuffer unavailable — missing COOP/COEP | High | `vite.config.ts:17–20` |
| 5 | Delay automation value not converted from ms→s | Medium | `automationScheduling.ts:69` |
| 6 | MP3 export: lamejs dynamic import fails | Medium/High | `mp3Encoder.ts:63` |
