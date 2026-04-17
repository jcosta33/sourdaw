# The Bakery — Modular Visual Patching Environment

## Context

The Bakery is Sourdaw's built-in node-based modular synthesis and patching environment. Its defining architectural promise — and the reason it belongs inside the DAW rather than beside it — is that a user patch compiles to the **same flat `Vec<ProcessTask>` schedule** used by Sourdaw's built-in devices (Fermenter, Levain, Toaster, Bacteria). There is no interpreter, no message-passing runtime, no "patch VM" layer. A user patch and a factory device are indistinguishable to the audio thread.

This differentiates The Bakery from:

- **Max / MSP / Gen** — text-object dispatch, separate runtime
- **Reaktor** — interpreted primary-level with a separate compiled "core" tier
- **Pure Data** — interpreted message passing
- **VCV Rack** — plugin-boundaries per module, no global graph optimization
- **Bitwig Grid** — closest peer, but locked inside Bitwig Studio

**Current codebase state:** The Bakery is completely unbuilt. DSP primitives exist in `daw-dsp` (Fermenter, Levain, Bacteria, Toaster, Gluten, Knead, Proof, Grinder, `grand_boule`, Crumbs), and the audio engine already uses a flat `ProcessTask` schedule in `crates/daw-engine/`. No node-based engine, no Poly / FX / Note containers, and no visual patcher exist in either the Rust backend or the TypeScript frontend. This spec defines v1 of the feature from zero.

**Research reference:** [`.agents/research/factory/bakery.md`](../../research/factory/bakery.md) — §1 "The Bakery". Research notes on Bitwig Grid / Reaktor / Max / VCV Rack competitive baseline are consolidated there. This spec does not restate research; it derives requirements from it.

**Research alignment (informative):** The consolidated research file lists browser/WASM patch execution, a full Crumb-grade sampler product, and a factory samples / sfizz pipeline as long-term mission goals. v1 ships the native desktop runtime with sampler *nodes* only; WASM runtime, a standalone Crumb instrument, and the free-resources delivery story remain tracked follow-ups (see Non-goals and the "Relationship to Crumb and factory samples" section) — not dropped requirements.

---

## Goal

Ship v1 of The Bakery — a node-based visual patcher whose patches compile to native `Vec<ProcessTask>` schedules that run on the shared audio engine with the same RT-safety guarantees and per-voice performance as Sourdaw's built-in devices — usable as instrument, audio effect, and note processor, and shareable as a versioned JSON patch format.

---

## User-visible behavior

A new device category **Bakery** appears in the device browser alongside Fermenter and Levain. Users can:

- Drop a **Poly Bakery** onto an instrument track; double-click to open the patcher.
- Drop an **FX Bakery** onto any track's effect chain; double-click to open the patcher.
- Drop a **Note Bakery** into the pre-instrument note chain; it receives and emits MIDI events.
- Drag modules from a browser onto the canvas, draw cables between typed ports, and hear the result immediately. A cable change causes no audible click or dropout.
- Edit knobs in an inspector pane and see those knobs automatable in the track's automation lanes.
- Save a patch to disk as a self-contained JSON file and load a patch authored by someone else without installing extra binaries.
- Inspect any built-in device by reading its patch, when a built-in device has a Bakery-equivalent representation (v1 targets instruments built atop `daw-dsp` primitives).

The patcher canvas supports pan, zoom, multi-select, copy/paste, undo/redo, and a minimap.

---

## Scope

### In scope (v1)

1. **Roles:** Bakery instances work as instrument (Poly), audio effect (FX), and MIDI/note processor (Note).
2. **Learning environment:** Every built-in module has a descriptive name, visible port labels, and an inspector help panel.
3. **Community sharing format:** Self-contained, versioned JSON patch format with embedded metadata.
4. **Native compiled runtime:** Patches compile to `Vec<ProcessTask>` and share the audio engine's scheduler.
5. **Visual patcher UI:** Canvas with nodes, cables, inspector, module browser, minimap.
6. **First-ship module catalog** (see R4): minimum viable set of oscillators, filters, envelopes, math, routing, MIDI I/O, sample playback, and DAW I/O.
7. **Poly / FX / Note containers** with per-container voice semantics.
8. **Hot-reload** during editing: audio continues without pops when topology changes.
9. **Sub-patches:** Users can encapsulate a subgraph as a reusable module (nesting ≥ 1 level deep).
10. **Undo / redo** of patch edits.
11. **Automation integration:** Bakery parameter knobs appear in the host automation system like any other device parameter.

### Non-goals (explicitly out of scope for v1)

1. **Real-time collaborative editing inside a patch** — single-user editing only.
2. **Commercial marketplace** — no paid module store, no signed marketplace identity.
3. **Plugin hosting inside a Bakery patch** — no CLAP/VST3/AU modules. A Bakery patch may live inside the DAW's plugin host, but the reverse is not supported.
4. **Arbitrary GUI customization** — widgets are fixed: knob, slider, toggle, XY pad, dropdown, meter, scope. No user-scripted UI.
5. **Text-scripted DSP modules** — no in-patch Faust/Gen/JavaScript script node in v1. Extensibility is via sub-patches of built-in modules.
6. **Spectral / granular modules beyond what `daw-dsp` already exposes** — listed in Requirement R4, not additive.
7. **GPU DSP** — WebGPU is reserved for canvas rendering and scopes; audio processing is CPU/SIMD.
8. **Browser/WASM runtime for patches** — the native desktop runtime is the v1 target. A WASM path may follow but is not required.
9. **Cross-patch modulation routing** — modulation is scoped within a single Bakery instance.
10. **Multi-out to parallel audio busses within a single Bakery instance** — v1 exposes a single stereo output (instrument/FX) or single MIDI output (Note). Parallel routing is done at the DAW track level.
11. **Crumb-grade sampler product** — v1 ships Bakery `SamplePlayback` / `GrainEngine` nodes wrapping `daw-dsp` sampler primitives only. A dedicated Crumb instrument (SFZ import, 2D velocity/round-robin mapping grid, full Instrument/Layer/Group/Zone hierarchy, tiered resampling, disk streaming, pYIN/BPM analysis) is out of scope and tracked by a future standalone Crumb spec — see research `factory/bakery.md` §2.
12. **URL / link-based patch sharing** — v1 sharing is self-contained JSON files (R11). Shareable URLs / cloud patch hosting are deferred.
13. **CPU heat map / per-node performance overlay** — research suggested a GPU-layer performance overlay; deferred to a later performance-tools milestone.

---

## Requirements

### R1: Patch data model

- **R1.1** — A patch is a directed acyclic graph (DAG) of typed nodes connected by typed cables; feedback is expressed via an explicit one-block delay node, never as a back-edge in the DAG.
- **R1.2** — Every node has a stable `NodeId` (UUID v4) that persists across saves and edits; cables reference `(sourceNodeId, sourcePortId)` and `(targetNodeId, targetPortId)`. Port IDs are stable per module definition.
- **R1.3** — Every patch declares its container type (`poly | fx | note`, see R2), a schema `version` integer, and embedded metadata (author name, created-at ISO-8601 timestamp, title, description, tags).
- **R1.4** — Node parameters are stored as `Map<ParamId, ParamValue>`; missing parameters fall back to the module definition's default. Removing a parameter from a module definition in a later version must not break older patches — unknown params are preserved but ignored.
- **R1.5** — The in-memory patch model is a plain TypeScript data class (not a React state tree), owned by a Vanilla `Store<BakeryPatchState>` per AGENTS.md §State Management.
- **R1.6 — AC:** A round-trip unit test (model → JSON → model) produces a byte-identical JSON serialization for any valid patch and preserves all unknown parameters from a forward-version patch.

### R2: Containers — Poly / FX / Note

- **R2.1** — **Poly Bakery** exposes a *Voice domain* (per-voice subgraph: oscillators, envelopes, per-voice filters) and a *Global domain* (shared post-voice DSP: reverb, EQ, limiter). The compiler replicates the Voice domain graph per active voice and runs the Global domain once.
- **R2.2** — Poly patches declare a polyphony cap (default 16, user-adjustable 1–64). The host voice manager allocates, retriggers, and steals voices; the patch chooses steal policy from a fixed enum (`oldest | quietest | lowestVelocity`).
- **R2.3** — **FX Bakery** has a single global graph and no voice domain. It exposes stereo audio in and stereo audio out and may process arbitrary DAW audio.
- **R2.4** — **Note Bakery** has a single graph that receives note events on a MIDI-in node and emits note events on a MIDI-out node. It has no audio path.
- **R2.5** — The container type is fixed at patch creation and cannot be changed without creating a new patch — changing container semantics would silently invalidate all cables.
- **R2.6 — AC:** Attempting to place an audio-rate node in a Note Bakery raises a compile-time error with a human-readable message naming the offending node ID.

### R3: Signal / port type system

- **R3.1** — Port types: `Audio` (block-rate stereo or mono buffer), `Gate` (block-rate sample values `0` or `1`), `Trigger` (event with sample offset, instantaneous), `Value` (block-rate control signal, typical range ±1), `Phase` (block-rate normalized `[0, 1)` ramp), `Note` (event stream with sample offset). Optional **UI / Meta** ports (inspector-only, non-audio, research §6.1) may exist for probes and metadata; they do **not** participate in RT `ProcessTask` graphs unless explicitly bridged.
- **R3.2** — Audio, Gate, Value, and Phase share an internal continuous-signal family; Trigger and Note share an internal event family. Compiler coercion rules convert between types in the same family automatically (e.g. Value → Audio multiplies by 1.0; Gate → Trigger emits on rising edge). Cross-family coercion requires an explicit user-placed converter node.
- **R3.3** — Multiple connections into a single input port default to: **sum** (continuous family) or **merge queue** (event family, sorted by sample offset). The inspector allows switching a summing node to multiplication for a specific port.
- **R3.4** — Every port has a user-facing color in the UI: audio=orange, gate=green, trigger=green outline, value=blue, phase=purple, note=teal.
- **R3.5 — AC:** A unit test verifies coercion rules and multi-connection policies for every pairing in the type system; invalid cross-family connections are rejected at the model layer before compile.

### R4: First-ship module catalog

Each module below must exist at v1 release. Each module exposes ports and parameters as defined in its module spec (filed under `crates/daw-dsp/src/<family>/` plus a Bakery wrapper). A module is "shipped" when: (a) its DSP implementation passes its unit tests, (b) its Bakery wrapper registers with the module registry, and (c) it appears in the module browser with a description.

- **R4.1 Generators:** `Oscillator` (sine/saw/square/triangle, anti-aliased), `NoiseGen` (white/pink), `SampleAndHold`, `PhaseRamp`.
- **R4.2 Filters:** `StateVariableFilter` (LP/HP/BP/Notch, 12 dB/oct), `LadderFilter` (4-pole LP), `Biquad` (user coefficients).
- **R4.3 Envelopes / LFO:** `ADSR`, `AHDSR`, `LFO` (same waveforms as Oscillator + S&H), `EnvelopeFollower`.
- **R4.4 Samplers (wrapping `daw-dsp/levain` and `daw-dsp/crumbs`):** `SamplePlayback` (one-shot, loop, warp), `GrainEngine` (Hann/Gauss windowed, density+spray params).
- **R4.5 Math / Utility:** `Add`, `Multiply`, `Clamp`, `Lerp`, `Abs`, `Rectify`, `Constant`, `Scale` (input range → output range), `Quantize` (to pitch grid).
- **R4.6 Routing:** `Mixer` (4-in, 1-out, per-channel gain), `Selector` (N-input, integer index → one output), `VoiceMix`, `VoiceSplit`, `VoiceGate`, `VoiceIndex`, `VoiceCount`, `Unison` (research §7.3 voice-infrastructure set).
- **R4.7 Note FX:** `NoteIn`, `NoteOut`, `Transpose`, `Arpeggiator`, `NoteQuantizer` (to scale), `VelocityCurve`.
- **R4.8 DAW I/O:** `AudioIn`, `AudioOut`, `TempoIn`, `TransportPositionIn`, `AutomationIn` (named param exposed to DAW automation).
- **R4.9 Effects (wrapping existing `daw-dsp` devices):** `Reverb` (Proof), `Delay` (Knead), `Distortion` (Toaster), `Chorus` (from Bacteria primitives), `Compressor` (Gluten).
- **R4.10** — The module registry is authoritative: attempting to load a patch referencing an unknown module type fails gracefully with an error surfaced to the UI naming the missing module(s). The patch is not partially loaded.
- **R4.11 — AC:** The registry list is verified at build time against the set of Bakery wrappers; a mismatch fails CI.

### R5: Compilation pipeline — patch → `Vec<ProcessTask>`

- **R5.1** — Compilation is deterministic: the same patch JSON on the same engine version produces byte-identical `ProcessTask` slices. No random tie-breaking in topological ordering.
- **R5.2** — Pipeline stages (in order):
  1. **Parse** — JSON → in-memory patch (schema-validated with Zod on TS side, `serde` on Rust side).
  2. **Resolve** — bind node types against module registry; fail with a list of unknown nodes if any.
  3. **Type-check** — walk cables, verify port type compatibility, insert implicit coercions.
  4. **Expand** — for Poly Bakery, clone the voice domain once per configured polyphony and wire up the voice-manager bridge nodes; expand sub-patches inline.
  5. **Topologically sort** — produce linear node order; break ties by `NodeId` lexicographic order for determinism.
  6. **Allocate buffers** — linear-scan buffer allocator (register-allocation style) reuses buffers whose live range has ended; output a buffer assignment map.
  7. **Constant-fold** — nodes whose inputs are all `Constant` values are computed once at compile and replaced with a constant.
  8. **Dead-code-eliminate** — nodes with no path to an `AudioOut` / `NoteOut` are dropped.
  9. **Emit** — produce `Vec<ProcessTask>` with buffer indices resolved to indices into a pre-allocated `Vec<Vec<f32>>` scratch pool owned by the instance.
- **R5.3** — Compilation runs on a non-realtime thread. The compiled schedule is handed to the audio thread via an `rtrb` lock-free ring or equivalent atomic pointer swap; the audio thread never allocates, locks, or parses JSON.
- **R5.4** — Compile errors are enumerable TypeScript types (`BakeryCompileError`) with a `nodeId` field so the UI can highlight the offending node.
- **R5.5 — AC:** A unit test compiles a 20-node test patch, asserts the resulting `ProcessTask` count matches expected, and asserts that two subsequent compiles produce identical output.
- **R5.6 — AC:** An integration test loads a trivial patch (Oscillator → AudioOut), compiles it, runs one block through the engine, and asserts that the output buffer contains the expected sine wave within floating-point tolerance.

### R6: RT-safe runtime parity with built-ins

- **R6.1** — On the audio thread, a compiled Bakery patch executes with the same discipline as any built-in device: no heap allocation, no mutex locks, no file I/O, no logging via `println!`/`log`.
- **R6.2** — All per-instance scratch buffers, voice pools, and module state are allocated at compile time and owned by the instance's `BakeryEngineState` struct.
- **R6.3** — Parameter changes from the UI or automation system arrive via lock-free queues (`rtrb::Producer`/`Consumer`) as `(paramId, value, sampleOffset)` triples; the audio thread applies them at the scheduled sample offset with per-block smoothing.
- **R6.4** — Module implementations must not use `std::sync::Mutex`, `RwLock`, `Box::new` during `process`, `Vec::push`/`resize`, or any path that can panic. A clippy lint or doctest should enforce this surface-level.
- **R6.5 — AC:** A CPU benchmark asserts that a reference patch (16-voice subtractive synth with 3 oscillators, 1 filter, 1 envelope, 1 reverb) processes at ≥ 20× realtime at 48 kHz on the CI baseline hardware — matching the factory Fermenter preset of equivalent complexity within 15 %.
- **R6.6 — AC:** A 60-second soak test running a reference patch records zero heap allocations on the audio thread as measured by a custom allocator hook in debug builds.

### R7: Hot-reload / stable audio under topology change

- **R7.1** — When the user changes topology (adds/removes a node, reconnects a cable), the editor produces a new compiled schedule and atomically swaps it in on the next audio block boundary.
- **R7.2** — Parameter values from nodes that exist in both the old and new schedule are carried over by `NodeId`; new nodes start at their module defaults; removed nodes' state is deallocated on the non-realtime thread after the swap.
- **R7.3** — The swap produces no audible click for ≤ 64 cable or parameter changes per second under normal editing load; the audio-thread crossfade (if any) is ≤ 10 ms.
- **R7.4** — Changing a port's type mid-edit (e.g. user reassigns a cable so its source type no longer matches its target) does not compile: the editor surfaces the type error on the affected cable, and the audio engine continues running the previous valid schedule.
- **R7.5 — AC:** An integration test connects/disconnects a cable 100 times at 10 Hz while running audio through the engine and measures the output RMS — discontinuities above 0.01 are a failure.

### R8: Voice allocation (Poly container)

- **R8.1** — A host-provided voice manager receives note-on / note-off / pitch / velocity from the Note chain and assigns them to voice slots `0..polyphony-1`.
- **R8.2** — Each voice has an `isActive` flag; inactive voices still execute their schedule at zero cost via an early-exit on the first block where every envelope has released — the scheduler skips the voice's tasks until a note-on reactivates it.
- **R8.3** — Voice stealing policies (see R2.2) choose the steal target when all voices are active and a new note arrives. The chosen voice's ADSR is force-released with a fast ramp (5 ms).
- **R8.4 — AC:** A unit test exercises each steal policy on a 4-voice patch and asserts the expected voice index is stolen under a fixed note sequence.

### R9: Sub-patches

- **R9.1** — Users can select a set of nodes in the canvas and invoke "Encapsulate". The selected subgraph is replaced by a single sub-patch node whose ports are the boundary-crossing cables of the selection.
- **R9.2** — Sub-patch boundary ports have user-renameable labels; the encapsulated patch is stored inline in the parent patch JSON (no external sub-patch library in v1).
- **R9.3** — Sub-patches nest at least one level deep; deeper nesting is supported but not required to be performant beyond 3 levels.
- **R9.4** — At compile time, sub-patches are **inlined** (R5.2 step 4). There is no sub-patch runtime indirection.
- **R9.5 — AC:** A unit test verifies that a patch with two nesting levels produces the same `ProcessTask` sequence as the manually-flattened equivalent patch.

### R10: Visual patcher UI

- **R10.1** — Canvas supports pan (space-drag or middle-mouse), zoom (cmd/ctrl-scroll), 100 %–400 % zoom range, and a minimap that stays visible at all zoom levels.
- **R10.2** — Nodes are draggable; connection dragging previews the target port and shows a type-compatibility indicator (green = compatible, yellow = auto-coerced, red = incompatible).
- **R10.3** — The module browser is a searchable sidebar grouped by module family (Generators, Filters, Envelopes, Math, Routing, Note, I/O, Effects).
- **R10.4** — The inspector pane shows parameters for the currently selected node: labels, units, ranges, and a knob/slider widget per parameter. Parameters are fixed at the widget types listed in the non-goals (no user-scripted widgets).
- **R10.5** — Undo/redo covers: add/remove node, add/remove cable, parameter change, encapsulate/de-encapsulate, rename port. History depth ≥ 100 actions.
- **R10.6** — The canvas uses a hybrid rendering model (per research §4.2): React for the module chrome and inspector, a GPU/canvas layer (WebGPU preferred, Canvas 2D fallback) for cables, scopes, and the minimap.
- **R10.7** — Rendering meets 60 fps while dragging a node on a 200-node patch on the CI baseline machine.
- **R10.8** — UI follows the architecture rules in AGENTS.md: lives under `src/modules/Bakery/presentations/`; cross-module imports go through `#/modules/Bakery` only; no barrels inside the module; vanilla `Store<T>` for shared state, `useStore` for consumption.
- **R10.9 — AC:** A visual-regression test (Playwright screenshot) captures a reference patch at 100 % zoom and passes against a committed baseline.
- **R10.10** — Non-urgent canvas work (minimap redraws, browser filtering, large-patch layout recomputation) uses React 19 `useTransition` / `startTransition` so interactive gestures (node drag, cable routing) stay on the urgent path (research §4.2).
- **R10.11** — Module parameter metadata (stable `ParamId`, display name, units, min/max, default, bipolar flag, response curve) is defined once per module in the registry and consumed verbatim by the inspector; the inspector does not invent labels or ranges. Missing metadata fails the build-time registry check in R4.11.

### R11: Patch sharing format

- **R11.1** — Patches serialize to a single self-contained JSON document with top-level fields: `schemaVersion` (int), `kind` ("poly" | "fx" | "note"), `metadata` (author, title, description, tags, createdAt, appVersion), `graph` (nodes, cables, subPatches), `parameters`.
- **R11.2** — JSON is the only v1 format. Binary and compressed formats are deferred.
- **R11.3** — Sample-based modules reference samples by content hash (`sha256`). If the sample is bundled with Sourdaw, it resolves by hash. If it is not, loading the patch surfaces a missing-sample warning with a human-readable list and the patch still opens in a "preview" mode with silent sample nodes.
- **R11.4** — Patches have a `schemaVersion` field. A loader for version `N` must open any patch with `schemaVersion ≤ N` (backward compatible). Forward-incompatible changes bump the major version and provide a migration in the loader.
- **R11.5** — Embedded metadata fields `author`, `title`, `createdAt`, and `appVersion` are mandatory on save; missing metadata blocks export.
- **R11.6** — A patch must not embed arbitrary executable code (no JavaScript strings, no WASM bytes). Sharing a patch is never sharing a binary.
- **R11.7 — AC:** A JSON Schema document for the patch format is checked into `docs/architecture/` and a validator runs in CI against every committed sample patch.
- **R11.8** — Illustrative top-level shape (normative details live in the JSON Schema):

```json
{
  "schemaVersion": 1,
  "kind": "poly",
  "metadata": {
    "title": "Basic Subtractive",
    "author": "…",
    "createdAt": "2026-04-17T00:00:00Z",
    "appVersion": "0.x.y",
    "description": "…",
    "tags": ["synth", "subtractive"]
  },
  "graph": {
    "nodes": [
      { "id": "n1", "type": "Oscillator", "params": { "waveform": "saw" } },
      { "id": "n2", "type": "LadderFilter", "params": { "cutoff": 0.4 } },
      { "id": "n3", "type": "AudioOut", "params": {} }
    ],
    "cables": [
      { "from": ["n1", "out"], "to": ["n2", "in"] },
      { "from": ["n2", "out"], "to": ["n3", "in"] }
    ],
    "subPatches": []
  },
  "polyphony": { "voices": 16, "steal": "oldest" },
  "sampleRefs": []
}
```

### R12: Compilation as first-class plugin instance

- **R12.1** — A Bakery instance implements the same internal plugin-host interface as a built-in device: it appears in the track chain, receives audio/note buffers, exposes parameters to the automation system, and supports preset save/load like any other device.
- **R12.2** — A Bakery instance has the same lifecycle hooks as built-ins: `prepare(sampleRate, blockSize)`, `process(ctx)`, `reset()`, all called on the audio thread; plus non-realtime `loadPatch(json)` and `compile()` on the UI/host thread.
- **R12.3** — Presets for a Bakery instance are the patch JSON plus parameter values. Preset listings show Bakery patches alongside factory presets in the device preset menu.
- **R12.4** — CPU/latency reporting: the instance reports its compiled schedule's estimated block cost and any added latency to the DAW's latency compensation system, identical to built-ins.
- **R12.5 — AC:** Placing a Bakery instance on a track and muting/soloing/automating it behaves indistinguishably from placing a Fermenter on that track, as verified by an integration test that runs both devices under the same track harness and asserts equivalent lifecycle events.

### Relationship to Crumb and factory samples (non-normative pointer)

Factory sample delivery (sfizz WASM status, ~1.5–2.5 GB memory ceiling, Salamander / Sofia / Virtuosity / Naked Drums / Karoryfer / VCSL licensing tiers, bundled vs first-run vs on-demand download, symphonia → WASM virtual filesystem, FLAC IPC streaming) and the full Crumb instrument (SFZ import, 2D mapping grid, warp/Signalsmith, tiered resampling, pYIN analysis, disk streaming) are specified outside this document — see research `factory/bakery.md` §2 (Crumb) and §4 (Free resources). The Bakery patch format's sample refs (R11.3) remain authoritative for Bakery patches regardless of how factory libraries are delivered.

### R13: Architecture alignment (AGENTS.md)

- **R13.1** — Frontend lives at `src/modules/Bakery/` with the standard subdirectory layout: `models/`, `useCases/`, `stores/`, `repositories/`, `handlers/`, `services/`, `events/`, `presentations/views|components|hooks`, and a root `index.ts` that re-exports only from `useCases/`, `events/`, `stores/`, and `presentations/views/`.
- **R13.2** — Backend lives in a new crate `daw-bakery` sitting beside `daw-dsp` and `daw-engine`. Dependency direction: `daw-bakery` depends on `daw-dsp` (primitives) and `daw-core` (types); the audio engine may depend on `daw-bakery`; `daw-bakery` never depends on `daw-engine` or `daw-io`.
- **R13.3** — All I/O (patch file read/write, sample resolution) goes through `repositories/` on the frontend and `daw-io` on the backend. The engine never touches the filesystem directly.
- **R13.4** — One function per file for use cases and repositories; no namespace imports; `type` over `interface`; `as const` over `enum` — per AGENTS.md coding conventions.
- **R13.5** — Vanilla `Store<BakeryPatchState>` instances hold per-instance patch state; React components consume via `useStore`. React Query is not involved — patch state is client-owned.
- **R13.6 — AC:** `pnpm deps:validate` passes with zero violations after the module lands.

---

## Constraints

1. **React 19 rules** — no `useMemo`, `useCallback`, `React.memo`, `forwardRef`; `ref` is a prop; conditional rendering uses ternaries or early returns, never `&&` (AGENTS.md).
2. **Audio thread discipline** — no alloc, no locks, no blocking; all buffers pre-allocated at compile (R6).
3. **Tauri v2 boundary** — filesystem and sample import go through Tauri commands in `src-tauri`, per the `tauri-platform` skill. v1 covers patch read/write and sample resolution; directory-watch and factory-library installer flows are deferred follow-ups (research §4.2).
4. **Module registry is compile-time** — modules are registered in a static Rust table; adding a module requires a code change, not a runtime import.
5. **TypeScript soundness** — no `any` except at I/O boundaries with immediate narrowing; patch JSON parsing uses Zod at the boundary (AGENTS.md §TypeScript — soundness).
6. **RT-safe Rust** — `daw-bakery` follows the audio-thread rules in AGENTS.md § 🦀 Backend Rust Tauri Architecture (lock-free rings, atomics, no allocation on `process`).

---

## Design decisions

### Decision: compile-to-native, not interpret

**Chosen:** Every patch compiles to a `Vec<ProcessTask>` identical in shape to factory-device schedules, and runs on the shared audio engine.

**Considered and rejected:**

- **Interpreted patch runtime** — a per-instance graph walker. Rejected because it introduces a second RT-safety discipline (the interpreter itself), defeats cache locality of the flat schedule, and makes user patches permanently second-class citizens vs built-ins.
- **Separate patch VM crate** — e.g. an LLVM-IR-style bytecode for patches. Rejected as significant scope for no audible benefit: our existing `ProcessTask` scheduler is already the optimal representation.

### Decision: single-container commitment at patch creation

**Chosen:** The `kind` (Poly/FX/Note) is chosen when the patch is created and is immutable thereafter.

**Considered and rejected:**

- **Dynamic container switching** — reinterpreting a Note patch as an FX patch at runtime. Rejected because cable semantics depend on container (voice cables only exist in Poly), and switching would silently invalidate the entire graph.

### Decision: graph representation is a struct-of-arrays on Rust, object graph on TS

**Chosen:** The TypeScript model is an object graph (nodes, cables as references). The Rust compiled form is a struct-of-arrays inside `Vec<ProcessTask>` with resolved buffer indices. Serialization is JSON with stable IDs.

**Considered and rejected:**

- **Shared in-memory representation across TS and Rust** — rejected because the ergonomic shape for editing is different from the ergonomic shape for execution; optimizing one hurts the other.

### Decision: React + GPU canvas hybrid for patcher UI

**Chosen:** React components for module chrome, sidebar, inspector; GPU-accelerated canvas (WebGPU preferred) for cables, minimap, and scopes. Aligns with AGENTS.md (React 19 is the frontend) and with the research's rendering recommendations.

**Considered and rejected:**

- **Pure React / SVG** — rejected for large patches (>100 nodes) where SVG redraws dominate frame time.
- **Pure canvas / no React** — rejected because the non-canvas surfaces (browser, inspector) are idiomatically React, and we want to reuse the project's existing UI primitives.

### Decision: static validation runs before compile, not during

**Chosen:** Type-checking, cycle detection, and container-role validation run on the model layer synchronously as the user edits. Compilation only runs when the model is known valid.

**Considered and rejected:**

- **Validate during compile** — rejected because it defers feedback to the user (the UI already needs type info to colour the dragging cable, so the model layer owns it).
- **Validate only on save** — rejected for obvious reasons.

### Decision: sub-patches inline at compile, no runtime indirection

**Chosen:** Sub-patches are fully expanded in R5.2 step 4; the compiled schedule has no concept of "inside a sub-patch".

**Considered and rejected:**

- **Sub-patch as a task-boundary** — rejected because it forces a buffer boundary and prevents cross-sub-patch buffer reuse.

---

## Acceptance criteria (release gate)

- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `daw-bakery` crate compiles on stable Rust.
- [ ] A new Bakery module appears under `src/modules/Bakery/` with standard subdirectories.
- [ ] User can create a Poly, FX, or Note Bakery instance on a track.
- [ ] User can drop every module from the R4 first-ship catalog onto the canvas and connect it.
- [ ] The compiler produces a `Vec<ProcessTask>` for any valid patch and returns typed errors for invalid ones.
- [ ] The reference 16-voice subtractive synth patch runs at ≥ 20× realtime (R6.5).
- [ ] Zero audio-thread allocations observed during a 60 s soak of the reference patch (R6.6).
- [ ] Cable add/remove produces no audible click over 100 rapid changes (R7.5).
- [ ] Patches round-trip model → JSON → model byte-identically and preserve unknown forward-version params (R1.6).
- [ ] JSON Schema for the patch format is checked into `docs/architecture/` and enforced in CI.
- [ ] Visual-regression screenshot of a reference patch passes against baseline.
- [ ] A user-authored patch opens on a second machine running the same app version and produces identical audio (bit-equal rendered output over 1 s) when all referenced samples are present.
- [ ] Preset menu on a Bakery instance lists patches alongside factory presets.
- [ ] Automation lanes for Bakery parameter knobs record and play back like those of built-in devices.
- [ ] `AGENTS.md` rules: no `useMemo`/`useCallback`/`forwardRef`; no `&&` rendering; `type` over `interface`; one function per file in `useCases/` and `repositories/`; no cross-module internal imports.

---

## Test plan

### Unit tests (model layer — `src/modules/Bakery/__tests__/`)

- Patch JSON round-trip (R1.6).
- Cable type coercion matrix (R3.5).
- Multi-connection summing vs event-merge behaviour (R3.3).
- Voice stealing policies (R8.4).
- Module registry — unknown module surfaces an error (R4.10).

### Unit tests (compiler — `crates/daw-bakery/tests/`)

- Trivial patch (Oscillator → AudioOut) produces expected `ProcessTask` count.
- Compiling the same patch twice produces identical output (R5.5).
- Sub-patch expansion equals flattened patch (R9.5).
- Type-mismatch cable produces a `BakeryCompileError` with correct `nodeId` (R5.4).
- Dead-code elimination removes an Oscillator whose output reaches no sink.
- Constant folding replaces `Constant(0.5) * Constant(2.0)` with `Constant(1.0)`.

### Integration tests (engine — `crates/daw-engine/tests/`)

- Compiled trivial patch runs through the engine; output buffer matches a reference sine wave within 1e-6 tolerance (R5.6).
- Hot-reload: connect/disconnect at 10 Hz for 100 iterations; RMS discontinuities stay below 0.01 (R7.5).
- Bakery instance lifecycle matches built-in device under a shared harness (R12.5).

### Performance tests

- Reference 16-voice subtractive patch at 48 kHz hits ≥ 20× realtime on CI baseline (R6.5).
- Reference patch on the same hardware falls within 15 % of the equivalent factory Fermenter preset.
- Audio-thread allocation counter reads 0 over a 60 s soak in debug builds (R6.6).

### Visual / UI tests

- Canvas renders a reference 200-node patch at 60 fps while dragging a node (R10.7).
- Screenshot regression of a reference patch at 100 % zoom (R10.9).
- Undo/redo covers add-node, remove-node, add-cable, remove-cable, parameter change, encapsulate (R10.5).

### Manual QA

- Save a patch on machine A, load on machine B (same app version), verify bit-identical rendered output for a 1-second region.
- Author a 2-nesting-level sub-patch and confirm the patcher renders and executes correctly.
- Drop a Bakery FX onto a track with automation recorded on a knob; play back and verify the parameter tracks the automation lane.

---

## Open questions

- [ ] **[CRITICAL]** *Hot-reload safety when a port's type changes mid-edit.* If the user rewires a cable such that a previously valid graph becomes invalid, what does the audio engine render during the invalid window? Options: (a) continue the last valid schedule (preferred) — requires the editor to retain the last-valid compiled schedule alongside the live model; (b) crossfade to silence; (c) hard mute the instance. Resolve before writing the compiler's swap path.
- [ ] **[CRITICAL]** *Deallocation strategy for removed nodes on the audio thread.* When a node is removed from the compiled schedule, where is its state freed? Options: (a) `basedrop`-style deferred drop ring, moved to a GC thread; (b) the UI thread owns all node state and the audio thread holds only pointers, with drops happening on schedule swap on the UI side; (c) per-instance arena freed only when the instance itself is destroyed. Decision affects R6.2 and R7.2.
- [ ] **[CRITICAL]** *Patch signing / trust boundary for community sharing.* R11.6 forbids embedded executable code, but sample references (R11.3) still mean a malicious patch can point at resource-exhausting content. Do we require signed metadata, a content-length cap, or both? If signed, what is the trust anchor — Sourdaw CA, author's self-signed key, or none in v1? Decision affects R11 and the community-sharing UX shipping criteria.
- [ ] **[MINOR]** Polyphony cap default — 16 (current draft) vs 8. Will default once we have perf numbers on CI baseline.
- [ ] **[MINOR]** Sub-patch reuse across patches (v1 inlines per-instance; a library of sub-patches is deferred). Confirm deferral does not block first community release.
- [ ] **[MINOR]** WebGPU vs Canvas 2D preference for the canvas renderer — decide after a spike on Safari/Linux compatibility.
- [ ] **[MINOR]** Parameter smoothing time constant — fixed per module or user-configurable? Default to 5 ms per R6.3; revisit if users ask.
- [ ] **[MINOR]** Should `AutomationIn` modules auto-name based on nearest connected knob, or always require a user label? Default: require label.

---

## Tradeoffs and risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Compile time visible during editing | User perceives lag on large patches | Compilation runs on a non-RT thread (R5.3); incremental recompile planned but not required for v1 |
| User patches underperform equivalent factory devices | Breaks the core product promise | Parity test in R6.5; hold release until the gap is ≤ 15 % |
| Hot-reload click on topology change | Audible artefacts | Pre-allocate scratch buffers and do atomic pointer swap; crossfade only if measurement shows need |
| Schema version churn breaks user patches | Loss of user work | Loader is backward-compatible for `schemaVersion ≤ N` (R11.4); forward-version params preserved (R1.4) |
| Module registry drift between TS and Rust | Patches reference modules that only one side knows | Build-time check (R4.11) fails CI on mismatch |
| Community-shared patch points at missing sample | Confusing silent playback | Missing-sample warning surfaced on load (R11.3); patch opens in preview mode with silent sample nodes |
| React canvas performance degrades with patch size | UI frame drops | Hybrid rendering (R10.6); perf test on 200-node patch (R10.7) |

---

## Implementation notes

### Suggested sequencing

1. Land `daw-bakery` crate skeleton and module registry with 2–3 modules wired through `daw-engine`.
2. Land the TS model layer (`src/modules/Bakery/models/`, `stores/`) and a round-trip JSON serializer with the schema committed to `docs/architecture/`.
3. Land the compiler (R5) with unit and integration tests before any UI work.
4. Land a minimal headless patcher (no canvas — create patches programmatically in tests) and verify R6 parity.
5. Land the visual patcher UI (R10) last.
6. Grow the module catalog (R4) incrementally; each module lands with its Bakery wrapper and a unit test.

### Key patterns to reuse

- `ProcessTask` scheduler in `crates/daw-engine/src/audio_thread.rs` — Bakery's compiled output is a slice that drops into this scheduler unchanged.
- `rtrb` lock-free ring already used in `daw-engine` for parameter IPC — reuse for patch swap and parameter queues.
- `daw-dsp` primitive modules — do not reimplement; wrap and expose via the module registry.
- `Store<T>` with `useStore` — per AGENTS.md §State Management; do not introduce Redux/Zustand/Jotai.
- `createHandler` helper in `#/helpers/createHandler` — for `AppAction` handlers in the Bakery module.

### What is deliberately **not** reused

- The React Query layer — patch state is client-owned, not server-synced.
- `useContext` — cross-component sharing is via `Store<T>`, not React context.
- The legacy `useCases/*Handlers.ts` pattern — new code uses the `handlers/` folder per AGENTS.md.

### Suggested module directory layout

```text
src/modules/Bakery/
  models/
    BakeryPatch.ts             # graph, nodes, cables, metadata types
    ModuleDefinition.ts        # ports, parameters, module registry entry type
    PortType.ts                # Audio | Gate | Trigger | Value | Phase | Note
  stores/
    bakeryInstanceStore.ts     # per-instance patch state (Store<T>)
    moduleRegistryStore.ts     # static, populated at module init
  useCases/
    createPatch.ts
    addNode.ts
    removeNode.ts
    connectCable.ts
    disconnectCable.ts
    encapsulate.ts
    compilePatch.ts            # orchestrates: resolve → typecheck → compile
    loadPatch.ts
    savePatch.ts
  handlers/
    bakeryActionHandlers.ts    # AppAction → createHandler mappings
  services/
    typeCoercion.ts            # pure coercion rule table
    topologicalSort.ts         # pure DAG sort
    bufferAllocator.ts         # pure linear-scan allocator
  repositories/
    patchFileRepository.ts     # Tauri bridge for read/write
    bakeryEngineBridge.ts      # ipc to daw-bakery (compile, swap schedule)
  events/
    BakeryEvents.ts            # typed event payloads exported via index.ts
  presentations/
    views/
      BakeryPatcherView.tsx
    components/
      Canvas.tsx               # GPU layer + React node chrome
      ModuleBrowser.tsx
      Inspector.tsx
      Minimap.tsx
    hooks/
      useBakeryInstance.ts
  index.ts                     # re-exports only useCases/, events/, stores/, views/
```

```text
crates/daw-bakery/
  src/
    lib.rs
    model.rs                   # deserialized patch types (serde)
    registry.rs                # static module registry
    compile/
      mod.rs                   # pipeline entry
      resolve.rs
      typecheck.rs
      expand.rs
      topological.rs
      allocate.rs
      fold.rs
      dce.rs
      emit.rs
    runtime/
      instance.rs              # BakeryEngineState, pre-allocated scratch
      voice_manager.rs         # poly allocation + stealing
      parameter_queue.rs       # rtrb-backed IPC for parameter updates
```

### Compiler pipeline — data flow

```text
Patch JSON
   │
   ▼
┌──────────┐  unknown module?  ┌─────────────────┐
│ Parse    │ ────────────────▶ │ BakeryCompile-  │
└──────────┘                   │ Error           │
   │                           └─────────────────┘
   ▼
┌──────────┐   type mismatch?       same sink
│ Resolve  │ ────────────────────────▶ same sink
└──────────┘
   │
   ▼
┌──────────┐  insert coercions
│ TypeCheck│
└──────────┘
   │
   ▼
┌──────────┐  clone per voice; inline sub-patches
│ Expand   │
└──────────┘
   │
   ▼
┌──────────┐  stable tiebreak by NodeId
│ TopoSort │
└──────────┘
   │
   ▼
┌──────────┐  linear-scan live ranges
│ Allocate │
└──────────┘
   │
   ▼
┌──────────┐  Constant * Constant → Constant
│ Fold     │
└──────────┘
   │
   ▼
┌──────────┐  drop nodes without path to sink
│ DCE      │
└──────────┘
   │
   ▼
┌──────────┐
│ Emit     │ ─────▶ Vec<ProcessTask>
└──────────┘            │
                        ▼
           atomic swap via rtrb into audio thread
```

### Architectural notes for reviewers

- The `daw-bakery` crate is the **only** place allowed to know about `ProcessTask` layout on behalf of a patch. It must not leak internals (`NodeId`, cable references) to `daw-engine`; once compilation finishes, the audio thread sees a flat task slice indistinguishable from a built-in device's schedule.
- The frontend `compilePatch` use case orchestrates model validation and shells out to the Rust compiler via a Tauri command. The UI never assembles `ProcessTask` itself.
- Event payloads exported via `events/index.ts` are the only shape in which other modules (Arrangement, Mixer, Automation) may learn about Bakery state changes, per AGENTS.md's contract-boundary rules.
