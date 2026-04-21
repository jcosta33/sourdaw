# Sample Player — SFZ Instrument Device

## Goal

The user drops an `.sfz` file (or a `.zip` bundle containing one) onto a MIDI track. A new device appears in the track's device chain: `sfz-player`, pre-loaded with the SFZ's regions and samples. Playing MIDI on the track produces polyphonic, velocity- and key-mapped sample playback exactly as the SFZ declares, through the existing audio graph. Patches load in well under a second for typical factory-size SFZs (50–200 samples), sustained notes loop where the SFZ says to, and voice stealing is graceful under heavy polyphony.

## Current state

The audit references `src/modules/AudioEngine/useCases/samplePlayer/` but that directory does not exist today. Nothing in the codebase implements SFZ playback. What exists as foundations:

- `src/modules/AudioEngine/engine/TrackNode.ts` — `addDevice(deviceId, deviceType)` dispatches to `DEVICE_FACTORIES` by type string. A new `'sfz-player'` entry slots in here naturally.
- `src/modules/AudioEngine/models/AudioEngineState.ts` — `BuiltinDeviceNode` already has variants for MIDI-driven instruments (`levainControls`, `toasterControls`, `fermenterControls`, `grandBouleControls`). Pattern is: MessagePort → AudioWorkletNode → MIDI note on/off, param set.
- `src/modules/AudioEngine/services/` — workletless processor sources (e.g. `toasterProcessor.ts`) live here; an `sfzPlayerProcessor.ts` fits.
- `src/modules/Levain/` — an existing sample-based instrument (single-shot, not SFZ). Its structure (patch loader + worklet + device registration) is the cleanest template.
- `src/modules/SampleLibrary/` — sample asset management, tagging, import. We reuse its decode + cache helpers.

What is missing:
- SFZ parser.
- Sample loader keyed by SFZ region.
- Voice allocator (SFZ requires up to ~128 simultaneous voices).
- AudioWorklet processor that owns the sample pool and renders voices.
- UI: device panel showing loaded instrument, region map, polyphony indicator.
- AppActions + handlers: `addSfzDevice`, `loadSfzPatch`, `setSfzParam`.
- Persistence: `Device.type: 'sfz-player'` + a way to reference the SFZ patch from `ProjectData`.
- Drop-target wiring for `.sfz` files in the track header / browser.

## Design

### SFZ subset (v1)

Full SFZ v2 is huge. v1 supports the practical subset used by 95% of free libraries:

**Supported opcodes** — `sample`, `lokey`, `hikey`, `pitch_keycenter`, `lovel`, `hivel`, `volume`, `pan`, `tune`, `transpose`, `amp_veltrack`, `loop_mode` (`no_loop`, `loop_continuous`, `one_shot`), `loop_start`, `loop_end`, `ampeg_attack`, `ampeg_decay`, `ampeg_sustain`, `ampeg_release`, `fil_type` (lpf_2p / hpf_2p), `cutoff`, `resonance`, `trigger` (attack / release / first / legato), `group`, `off_by`, `polyphony`.

**Deferred to v2** — modulation sources (`*_on*cc`), crossfade opcodes, effects, SFZ includes (`#include`), complex filters, multi-stage envelopes.

### Parser

A new dependency: `sfz-parser` (pure TS, ~8 KB). Evaluated in [References]:
- Port `@sfz-tools/core` (MIT) — best fit. Parses to a plain AST of headers (`<region>`, `<group>`, `<global>`) and opcode records. We wrap it to produce our own normalised `SfzInstrument` model.
- Alternative: port the parser from Sfizz (C++) — too heavy for v1.

Decision: **use `@sfz-tools/core`** as a dependency, wrapped by our own model. No custom parser for v1. If the dependency proves insufficient, port its parser into `src/modules/SamplePlayer/repositories/sfzParser/`.

### Sample loading

1. `.sfz` contents read as text. `@sfz-tools/core` yields header/opcode records.
2. Each `<region>` resolves `sample=` relative to the SFZ's directory. For a `.zip` bundle, the bundle is a virtual FS.
3. Sample files (WAV, FLAC, OGG) decoded via the existing `AudioEngine/repositories/audioDecoding/` pipeline into `AudioBuffer`s.
4. A content-addressed cache (`audioBufferCache` with a `sample-<sha>` key) dedupes samples that appear in multiple regions (`pitch_keycenter` + velocity layers often point at the same file).
5. When a region references a sample still decoding, the region marks `loading: true`. The device emits a progress event; playback on that region is silent (not errored) until ready.

### Voice allocator

An SFZ device has:
- A `voices: Voice[]` pool sized to `polyphony` opcode (fallback 64).
- A free-list stack for O(1) allocation.
- A steal policy: when full, steal the oldest released voice; if none released, steal the oldest voice with the lowest current amplitude.

Each voice holds:
```ts
type Voice = {
    regionIndex: number;      // index into SfzInstrument.regions
    midiNote: number;
    velocity: number;
    startSample: number;
    playhead: number;         // integer samples into sample buffer
    amp: number;              // current amp (from envelope)
    envState: 'attack' | 'decay' | 'sustain' | 'release' | 'free';
    envStage: number;         // sample-counter within current stage
    loopState: 'pre-loop' | 'looping' | 'released';
    filterState: BiquadState; // if region has filter
    group: number | null;
    offBy: number | null;     // group this voice silences when triggered (SFZ off_by)
};
```

All voice state lives in a `SharedArrayBuffer` (matches existing worklet convention — see `toasterProcessor.ts`) so the worklet thread reads/writes directly without postMessage for per-sample state. MIDI events (note-on/off, param changes) arrive via `port.postMessage` and are applied between render quanta.

### Audio-thread rules

- No allocation in `process()`. All voices, filter states, temp buffers pre-allocated.
- No array mutation on the render path — only index writes into preallocated typed arrays.
- MIDI queue drained once per render quantum (128 samples); any events with timestamps in this window applied in-order.
- Linear-interpolated sample read (2-tap) is the v1 default. 4-tap or sinc is a later optimisation; not needed for v1.

### Device chain integration

```
  MIDI in (existing Track MIDI routing)
        │
        ▼
  sfz-player (AudioWorkletNode, 2 stereo channels out)
        │
        ▼
  track device chain (existing) ─► track fader ─► bus ─► master
```

The node is registered in `DEVICE_FACTORIES` as a generator: `inputNode.numberOfInputs === 0` so it adds to the signal path rather than interrupting it (see `TrackNode.rebuildChain` — generator branch).

MIDI: extend `BuiltinDeviceNode` with an `sfzPlayerControls` block mirroring `toasterControls`:
```ts
sfzPlayerControls?: {
    ready: boolean;
    noteOn: (midiNote: number, velocity: number, sampleFrame?: number) => void;
    noteOff: (midiNote: number, sampleFrame?: number) => void;
    allNotesOff: () => void;
    setParam: (name: string, value: number) => void;
    loadPatch: (patch: SfzInstrument) => Promise<void>;
    setBypass: (bypassed: boolean) => void;
    destroy: () => void;
};
```

## API surface

```ts
// src/modules/SamplePlayer/models/SfzInstrument.ts
export type SfzRegion = {
    sampleId: string;            // audioBufferCache key
    loKey: number; hiKey: number;
    pitchKeyCenter: number;
    loVel: number; hiVel: number;
    volumeDb: number;
    pan: number;
    tuneCents: number;
    transposeSemis: number;
    ampVeltrack: number;         // 0..100
    loopMode: 'no_loop' | 'loop_continuous' | 'one_shot';
    loopStartSample?: number;
    loopEndSample?: number;
    ampegAttackMs: number;
    ampegDecayMs: number;
    ampegSustain: number;        // 0..1
    ampegReleaseMs: number;
    filType: 'off' | 'lpf_2p' | 'hpf_2p';
    cutoffHz: number;
    resonance: number;
    trigger: 'attack' | 'release' | 'first' | 'legato';
    group: number | null;
    offBy: number | null;
    polyphony: number | null;    // per-region
};

export type SfzInstrument = {
    name: string;
    /** SHA-256 of the .sfz text — content-addressed patch key */
    patchHash: string;
    regions: SfzRegion[];
    defaultPolyphony: number;
    /** sample bank: keys are sampleIds used by regions */
    sampleIds: string[];
};

// src/modules/SamplePlayer/repositories/parseSfz.ts
export function parseSfz(sfzText: string, baseUrl: string): Result<SfzInstrument, SfzError>;

// src/modules/SamplePlayer/useCases/loadSfzPatch.ts
/** Decodes the SFZ text + all referenced sample files, writes to audioBufferCache,
 *  returns the normalised SfzInstrument. Emits progress events. */
export async function loadSfzPatch(input: { sfzText: string; baseUrl: string; onProgress?: (p: number) => void }): Promise<Result<SfzInstrument, SfzError>>;

// src/modules/SamplePlayer/useCases/loadSfzFromBundle.ts
/** .zip bundle containing .sfz + samples */
export async function loadSfzFromBundle(bundle: File | ArrayBuffer): Promise<Result<SfzInstrument, SfzError>>;

// src/modules/SamplePlayer/useCases/attachSfzToTrack.ts
export async function attachSfzToTrack(trackId: string, patch: SfzInstrument): Promise<Result<{ deviceId: string }, SfzError>>;

// src/modules/SamplePlayer/useCases/setSfzParam.ts
/** Global per-instrument params: masterVolume, masterTune, filterCutoffOffset */
export function setSfzParam(deviceId: string, name: string, value: number): void;

// AppActions
type SfzActions =
    | { type: 'loadSfzPatch'; payload: { trackId: string; sfzText: string; baseUrl: string } }
    | { type: 'loadSfzFromBundle'; payload: { trackId: string; bundleB64: string } }
    | { type: 'unloadSfzPatch'; payload: { deviceId: string } };

// Errors
export type SfzError =
    | { code: 'PARSE_ERROR'; line: number; message: string }
    | { code: 'SAMPLE_NOT_FOUND'; sampleRef: string }
    | { code: 'SAMPLE_DECODE_FAILED'; sampleRef: string; cause: unknown }
    | { code: 'UNSUPPORTED_OPCODE'; opcode: string; warn: true }
    | { code: 'TRACK_NOT_FOUND'; trackId: string };
```

## UI / UX

- **Drop target** — a MIDI track's header accepts `.sfz` and `.zip` drops. On drop: load → attach → notify.
- **Device panel** — new panel component at `src/modules/SamplePlayer/presentations/views/SfzPlayerPanel.tsx`, registered in the existing plugin panel registry.
  - Top: instrument name, patch hash (short), "Change patch" button.
  - Middle: region map visualisation — x = MIDI note, y = velocity, coloured rectangles per region. Hovering shows region details.
  - Bottom: global knobs (Master Volume, Master Tune, Filter Cutoff Offset, Voices Playing).
  - Status: loading progress bar while samples decode.
- **Browser entry** — Sample Library sidebar gets a "SFZ" category. Drag-to-track creates an `sfz-player` device pre-loaded.
- **Command Palette** — `SFZ: Load Patch…` (opens file picker), `SFZ: Unload Current Patch`.

## Data model / persistence

`Device` gains a new `type: 'sfz-player'` value (already a string, no enum widening needed — only `DEVICE_FACTORIES` entry).

Add to `Device`:
```ts
type Device = {
    // ... existing ...
    sfzPatchHash?: string; // present when type === 'sfz-player'
};
```

The patch text is stored **once, content-addressed**, in a new CAS map `ProjectData.samplePlayer.patches: Record<patchHash, { sfzText: string; name: string; sampleRefs: Array<{ sampleId: string; source: 'asset' | 'bundle' }> }>`. Samples themselves stay in the existing `audioBufferCache` / `AssetTransfer` CAS — SFZ just references `sampleId`s.

On project load:
1. Walk all devices with `type === 'sfz-player'`.
2. For each `sfzPatchHash`, look up `ProjectData.samplePlayer.patches[hash]`.
3. Call `loadSfzPatch` (which will hit the CAS for both patch text and sample buffers).
4. `attachSfzToTrack` the already-existing device (idempotent load into the worklet).

Migration: optional field, no migration pain.

## Integration points

- New module `src/modules/SamplePlayer/` with `models/`, `repositories/`, `useCases/`, `presentations/views/`, `services/sfzPlayerProcessor.ts`.
- `src/modules/AudioEngine/repositories/deviceNodeFactory.ts` — add factory entry `'sfz-player': createSfzPlayer`. `createSfzPlayer` returns a placeholder `BuiltinDeviceNode` and a load promise (same pattern as WASM devices).
- `src/modules/AudioEngine/engine/TrackNode.ts` — no change to the generic path; it already handles async device factories.
- `src/modules/Arrangement/models/pluginDescriptors/` — add `sfzPlayerDescriptor.ts` for the device browser.
- `src/modules/Command/models/AppAction.ts` — 3 new action variants.
- `src/modules/Command/useCases/` — add handlers for the 3 actions.
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts` — add SFZ patch rehydration block.
- `package.json` — add `@sfz-tools/core` (runtime dep), `jszip` (for bundle).
- `src/modules/SampleLibrary/` — register file-extension handlers for `.sfz`.

## Risks / open questions

- **SFZ dialect coverage** — many free instruments use opcodes outside the v1 subset. Unknown opcodes should warn (with `UNSUPPORTED_OPCODE` `warn: true`) and continue, not fail. Still, the instrument may sound wrong. Mitigation: log each unknown opcode once per patch with count; a shelf of "known bad" SFZs can be added to the test corpus over time.
- **Sample decode cost** — loading a 200-sample factory library is 200 WAV decodes = several seconds. Parallelise via `Promise.all` with a concurrency cap (e.g. 8) and off-thread decode in the existing decoding worker. Progress indicator is essential.
- **Memory** — a full SFZ bank can exceed 500 MB in RAM. For v1, decode-to-memory is fine; a future disk-streaming mode (read from IDB at render time) can be added without API change.
- **Bundle security** — `.zip` bundles could contain path-traversal symlinks. Sanitise entry names (no `..`, no absolute paths) before handing to the sample decoder.
- **WASM polyphony** — a worklet in JS handles ~64 stereo voices at 44.1 kHz with linear interp at ~15% CPU on a 2020 laptop. 128 voices stresses GC-free constraints. Decision: start pure TS; port to a Rust worklet later if CPU is a problem. `daw-dsp` has an existing pattern.
- **SharedArrayBuffer fallback** — the worklet should degrade to postMessage-based MIDI queueing when SAB is unavailable (same pattern as `TrackNode`'s meter fallback).
- **Loop crossfades** — SFZ has `loop_crossfade` opcode; v1 deferred. Crisp loop transitions without crossfade can click. Recommendation: default to a 128-sample automatic crossfade at loop boundary regardless of opcode, until full crossfade support lands.
- **Open question**: drag-in a `.sf2` (SoundFont)? Out of scope for v1 — SF2 and SFZ are distinct formats.

## Milestones

### M1 — Parser + data model (one session)
- Dependency `@sfz-tools/core`.
- `parseSfz()` wrapping the dep → `SfzInstrument`.
- Unit tests for 5 representative SFZs (simple single-region, multi-velocity, keyswitched group, loop-continuous, release trigger).

### M2 — Loader + cache integration (one session)
- `loadSfzPatch` with parallel sample decode.
- Content-addressed `patchHash` + `sampleId`.
- Progress events.
- `loadSfzFromBundle` (`.zip`).

### M3 — Worklet processor + voice allocator (one session)
- `sfzPlayerProcessor.ts` AudioWorklet.
- SAB-backed voice pool.
- MIDI event queue.
- Amp envelope, linear-interp sample read, loop modes.
- No filter yet.

### M4 — Device chain integration + UI (one session)
- `createSfzPlayer` factory.
- `attachSfzToTrack` use-case.
- `SfzPlayerPanel` with region map and global knobs.
- AppActions + handlers.
- Drop-target wiring on MIDI tracks.

### M5 — Filter, off_by, persistence (one session)
- 2-pole LP/HP filter per voice.
- `group` + `off_by` voice-silencing logic.
- `ProjectData.samplePlayer.patches` schema + hydration.
- Save/load round-trip test.

## Tests

- **Parser** — fixture suite of 10 SFZs; each asserts a specific region count + key/velocity ranges.
- **Parser unknown opcodes** — warn (not fail) on a patch containing `lfoN_freq=`, and produce a `warn: true` error for each unknown opcode, surface exactly once per patch.
- **Loader** — fixture of a patch referencing a sample in a sub-directory; assert the sample resolves correctly.
- **Voice allocator** — unit test: polyphony 4, trigger 5 notes, assert the oldest voice is stolen; trigger 5 notes with sustain pedal held, assert steal prefers the quietest.
- **Worklet (integration via `OfflineAudioContext`)** — a single-region patch with one sample, note-on middle C at velocity 100, render 1 s, assert the output matches the sample's amplitude envelope.
- **Loop** — a `loop_continuous` patch, render 2× the sample length, assert continuous output with no zero gap at loop boundary.
- **MIDI channel** — multiple note-on events at different sample frames within a render quantum produce voices whose start offsets match.
- **Persistence** — attach an SFZ, save project, reload in a fresh store, assert the device reappears and `sfzPatchHash` resolves back to the same patch.
- **Edge: missing sample** — a patch with one region whose sample file is absent; loader returns `SAMPLE_NOT_FOUND`; device is not attached; user sees a notification.
- **Perf** — load a 200-sample patch in a CI env and assert wall-clock < 3 s (generous for CI).
- **E2E (Playwright)** — drop a fixture `.sfz` on a MIDI track, arm and play a MIDI clip, assert audio output is non-zero.
