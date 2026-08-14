---
type: spec
id: SPEC-bakery
title: The Bakery — modular visual patching environment
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# The Bakery — modular visual patching environment

## Intent

A node-based modular environment where a user wires modules on a canvas into
Poly (instrument), FX, or Note devices that compile to a flat, real-time-safe
native schedule and run with the same engine and primitives as the rest of the
DAW — Reaktor/Max expressiveness without an interpreter on the audio thread.

## Non-goals

- An interpreted/scripted audio runtime — every patch compiles to native tasks.
- A separate engine or scheduler; the Bakery reuses the DAW's flat
  `Vec<ProcessTask>` schedule.
- Mid-development module catalog freeze — the catalog grows post-v1.
- Multi-container nesting trees beyond a single device container in v1.
- A browser/WASM runtime for patches — the native desktop runtime is the v1
  target; a WASM path may follow but is not required. (Restored from
  specs/missing/bakery.md non-goal 8.)
- GPU DSP — WebGPU is reserved for canvas rendering and scopes only; audio
  processing is CPU/SIMD. (Restored from specs/missing/bakery.md non-goal 7.)
- In-patch text-scripted DSP nodes — no Faust/Gen/JavaScript script node in v1;
  extensibility is via sub-patches of built-in modules. (Restored from
  specs/missing/bakery.md non-goal 5.)
- Plugin hosting inside a Bakery patch — no CLAP/VST3/AU modules; a Bakery patch
  may live inside the DAW's plugin host, but not the reverse. (Restored from
  specs/missing/bakery.md non-goal 3.)
- Multi-out to parallel audio busses within a single instance — v1 exposes one
  stereo output (Poly/FX) or one MIDI output (Note); parallel routing is done at
  the DAW track level. (Restored from specs/missing/bakery.md non-goal 10.)
- Cross-patch modulation routing — modulation is scoped within a single Bakery
  instance. (Restored from specs/missing/bakery.md non-goal 9.)
- Arbitrary GUI customization — widgets are a fixed set (knob, slider, toggle,
  XY pad, dropdown, meter, scope); no user-scripted UI. (Restored from
  specs/missing/bakery.md non-goal 4.)

## Requirements

### AC-001 — A patch is a serializable graph of typed nodes and connections

A patch must persist as nodes, typed ports, and connections that round-trip
through save/load with no loss of topology or parameter values.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::serde_roundtrip`

### AC-002 — A device declares one of three roles

A Bakery device must declare exactly one role — Poly, FX, or Note — that fixes
its I/O contract with the host track.

Verify with: `pnpm cargo:test -- -p daw-bakery device::role_contract`

### AC-003 — Ports carry a signal type and reject mismatched connections

The port type system — `Audio`, `Gate`, `Trigger`, `Value`, `Phase`, and `Note`,
plus optional inspector-only UI/Meta ports — must reject a connection between
incompatible port types at edit time. Audio/Gate/Value/Phase share a continuous
family and Trigger/Note share an event family; in-family conversions coerce
automatically while cross-family connections require an explicit user-placed
converter node.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::port_type_check`

### AC-004 — A patch compiles to a flat ordered schedule

Compilation must topologically sort the graph into a flat `Vec<ProcessTask>`
with feedback edges broken by a one-block delay, ready for cache-local iteration.

Verify with: `pnpm cargo:test -- -p daw-bakery compile::topo_schedule`

### AC-005 — The compiled schedule is real-time-safe

Processing a compiled schedule on the audio thread must not allocate, lock, or
block.

Verify with: `pnpm cargo:test -- -p daw-bakery compile::rt_safe_assert_no_alloc`

### AC-006 — Editing a patch hot-swaps the schedule without a glitch

Recompiling after an edit must publish the new schedule via `ArcSwap` so the
audio thread switches at a buffer boundary with no dropout.

Verify with: `pnpm cargo:test -- -p daw-bakery compile::arc_swap_hot_reload`

### AC-007 — Poly devices allocate voices from a fixed pool

A Poly device must allocate from a pre-sized voice pool (no per-note
allocation) and steal the oldest voice when the pool is exhausted.

Verify with: `pnpm cargo:test -- -p daw-bakery voice::pool_steal`

### AC-008 — Sub-patches encapsulate a reusable sub-graph

A group of nodes must be collapsible into a sub-patch with its own ports that
compiles inline into the parent schedule.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::subpatch_inline`

### AC-009 — The canvas supports patch edits with undo/redo

The visual patcher must let a user add, connect, move, and delete modules with
full undo/redo of each operation.

Verify with: `manual` — wire an oscillator → filter → output, undo each step, confirm the graph reverts

### AC-010 — A built-in module catalog is available on the canvas

The canvas must offer a searchable catalog of built-in modules (oscillators,
filters, envelopes, math, I/O) that can be instantiated onto the patch.

Verify with: `pnpm test:run -- BakeryModuleCatalog`

### AC-011 — Bakery devices integrate as plugin instances on tracks

A saved patch must load as a device on an instrument or FX slot and respond to
the host track's MIDI/audio exactly like a native plugin.

Verify with: `pnpm test:run -- BakeryDeviceIntegration`

### AC-012 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-013 — Patches serialize to a self-contained versioned JSON document

A patch must serialize to a single self-contained JSON document with top-level
`schemaVersion`, `kind`, `metadata`, `graph`, and `parameters`; `author`, `title`,
`createdAt`, and `appVersion` are mandatory metadata and export must block when any
is missing.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::sharing_json_format`

### AC-014 — The first-ship module catalog ships its named module set

The v1 release must ship the concrete first-ship catalog — including
`GrainEngine`, `SampleAndHold`, `PhaseRamp`, `StateVariableFilter`, `LadderFilter`,
`Biquad`, `ADSR`, `AHDSR`, `EnvelopeFollower`, the math/utility set
(`Add`/`Multiply`/`Clamp`/`Lerp`/`Abs`/`Rectify`/`Constant`/`Scale`/`Quantize`),
routing (`Mixer`/`Selector`/`VoiceMix`/`VoiceSplit`/`VoiceGate`/`VoiceIndex`/`VoiceCount`/`Unison`),
note FX (`Transpose`/`Arpeggiator`/`NoteQuantizer`/`VelocityCurve`), DAW I/O
(`AudioIn`/`AudioOut`/`TempoIn`/`TransportPositionIn`/`AutomationIn`), and effect
wrappers (`Reverb`/`Delay`/`Distortion`/`Chorus`/`Compressor`) — each registered
in the module registry.

Verify with: `pnpm cargo:test -- -p daw-bakery registry::first_ship_catalog_complete`

### AC-015 — Bakery parameters integrate with host automation

A Bakery parameter knob must appear in the host automation system exactly like a
built-in device parameter: it exposes itself to the automation system, records and
plays back automation lanes, reports added latency and estimated block cost to the
DAW's latency-compensation system, and is reachable via an `AutomationIn` node by a
stable named parameter.

Verify with: `pnpm test:run -- BakeryAutomationIntegration`

### AC-016 — The compiler runs the full nine-stage pipeline

Compilation must run all nine ordered stages — Parse, Resolve, Type-check, Expand
(voice-domain clone + sub-patch inline), Topologically-sort (ties broken by
`NodeId` lexicographic order), Allocate-buffers (live-range-reusing linear-scan),
Constant-fold (`Constant*Constant → Constant`), Dead-code-eliminate (drop nodes
with no path to an `AudioOut`/`NoteOut` sink), and Emit.

Verify with: `pnpm cargo:test -- -p daw-bakery compile::nine_stage_pipeline`

### AC-017 — The reference patch meets quantified RT performance gates

The reference 16-voice subtractive synth (3 oscillators, 1 filter, 1 envelope,
1 reverb) must process at ≥ 20× realtime at 48 kHz on the declared baseline machine — within 15 %
of the equivalent factory Fermenter preset.

Verify with: `pnpm cargo:bench -- -p daw-bakery --bench reference_patch_20x_realtime`

### AC-018 — Poly devices split voice and global domains

A Poly device must split into a Voice domain (per-voice subgraph — oscillators,
envelopes, per-voice filters — replicated per active voice by the compiler) and a
Global domain (shared post-voice DSP run once); the polyphony cap defaults to 16
and is user-adjustable across 1–64; the steal policy is chosen from the fixed enum
`oldest | quietest | lowestVelocity`.

Verify with: `pnpm cargo:test -- -p daw-bakery voice::domain_split_and_polyphony_cap`

### AC-019 — v1 ships sampler nodes, not a Crumb instrument

v1 must ship only `SamplePlayback` / `GrainEngine` nodes wrapping `daw-dsp`
sampler primitives; a dedicated Crumb instrument (SFZ import, 2D velocity/round-robin
mapping grid, full Instrument/Layer/Group/Zone hierarchy, tiered resampling, disk
streaming, pYIN/BPM analysis) is deliberately deferred to a future standalone Crumb
spec and must not be partially built into the Bakery.

Verify with: `manual` — confirm the module catalog exposes SamplePlayback/GrainEngine only and contains no SFZ-import or 2D-mapping-grid Crumb surface

### AC-020 — Sample-based modules reference samples by content hash

A sample-based module must reference its sample by `sha256` content hash; a hash
that resolves to a bundled sample loads directly, and a missing hash must surface a
human-readable missing-sample warning and open the patch in a silent "preview" mode
rather than failing to load.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::sample_ref_content_hash`

### AC-021 — The canvas honors the full patcher UI contract

The visual patcher must support a 100 %–400 % zoom range with an always-visible
minimap, a connection-drag type-compatibility indicator (green = compatible,
yellow = auto-coerced, red = incompatible), a module browser grouped by family
(Generators, Filters, Envelopes, Math, Routing, Note, I/O, Effects), an inspector
driven verbatim by per-module registry metadata, and undo/redo history ≥ 100 actions
covering add/remove node, add/remove cable, parameter change, encapsulate, and
rename port.

Verify with: `pnpm test:run -- BakeryPatcherUiContract`

### AC-022 — A patch never embeds executable code

A patch must never embed executable code (no JavaScript strings, no WASM bytes).

Verify with: `pnpm cargo:test -- -p daw-bakery patch::sharing_json_format`

### AC-023 — A loader opens any patch at or below its schema version

A version-`N` loader must open any patch with `schemaVersion ≤ N`.

Verify with: `pnpm cargo:test -- -p daw-bakery patch::sharing_json_format`

### AC-024 — The module registry is verified at build time

The module registry must be verified at build time against the set of Bakery
wrappers, and a mismatch must fail the guarded local check.

Verify with: `pnpm cargo:test -- -p daw-bakery registry::first_ship_catalog_complete`

### AC-025 — Compilation is deterministic

Compilation must be deterministic: the same patch on the same engine version
produces byte-identical `ProcessTask` output.

Verify with: `pnpm cargo:test -- -p daw-bakery compile::nine_stage_pipeline`

### AC-026 — The reference patch records zero audio-thread allocations under soak

A 60-second soak of the reference patch must record zero heap allocations on the
audio thread.

Verify with: `pnpm cargo:bench -- -p daw-bakery --bench reference_patch_20x_realtime`

### AC-027 — The patch JSON format has a checked-in schema enforced locally

A JSON Schema document for the patch format must be checked into
`docs/architecture/`, and a guarded local validator must run that schema against every
committed sample patch — a sample patch that fails the schema fails validation. (AC-013
fixes the document's top-level shape; this AC owns the committed schema artifact
plus its local enforcement.)

Verify with: `pnpm test:run -- BakeryPatchSchemaCi`

### AC-028 — Bakery patches save and load as device presets

A Bakery instance must support preset save/load like any other device, where a
preset is the patch JSON plus its parameter values, and the device's preset menu
must list saved Bakery patches alongside the factory presets.

Verify with: `pnpm test:run -- BakeryPresetIntegration`

### AC-029 — A Bakery instance is lifecycle-indistinguishable from a built-in

Muting, soloing, and automating a Bakery instance on a track must behave
indistinguishably from a Fermenter on that track, as verified by a dual-device
harness that runs both under the same track harness and asserts equivalent
lifecycle events. (AC-017 covers performance parity only; this AC owns lifecycle
equivalence.)

Verify with: `pnpm cargo:test -- -p daw-bakery device::lifecycle_equivalence_with_fermenter`

### AC-030 — Hot-reload stays click-free under sustained cabling edits

Connecting and disconnecting a cable 100 times at 10 Hz while audio runs through
the engine must not produce an output RMS discontinuity above 0.01 — any larger
discontinuity is a failure. (AC-006 covers the ArcSwap swap mechanism; this AC
owns the quantified audio-stability gate.)

Verify with: `pnpm cargo:test -- -p daw-bakery compile::hot_reload_rms_discontinuity_gate`

### AC-031 — Every port type has a fixed user-facing color

Every port must render with a fixed user-facing color in the patcher: audio =
orange, gate = green, trigger = green outline, value = blue, phase = purple, note
= teal. (Distinct from AC-021's connection-drag compatibility colors of
green/yellow/red.)

Verify with: `pnpm test:run -- BakeryPortColors`

### AC-032 — Released voices cost nothing to schedule

A voice whose every envelope has released must early-exit on the first such block
so its scheduled tasks cost nothing until a note-on reactivates the voice.

Verify with: `pnpm cargo:test -- -p daw-bakery voice::released_voice_zero_cost_early_exit`

### AC-033 — An audio-rate node in a Note Bakery fails to compile

Placing an audio-rate node in a Note Bakery must raise a compile-time error whose
human-readable message names the offending node ID. (AC-002 fixes the Note role
I/O contract; this AC owns the audio-rate-node rejection.)

Verify with: `pnpm cargo:test -- -p daw-bakery compile::note_bakery_rejects_audio_rate_node`

### AC-034 — A patch referencing an unknown module fails to load, atomically

Loading a patch that references an unknown module type must fail gracefully with
an error naming the missing module(s), and the patch must not be partially loaded.
(Distinct from AC-024's build-time registry check; this AC owns load-time graceful
failure.)

Verify with: `pnpm cargo:test -- -p daw-bakery patch::unknown_module_load_fails_atomically`

### AC-035 — The patcher holds 60 fps while dragging on a large patch

Dragging a node on a 200-node patch must hold 60 fps on the declared baseline machine.

Verify with: `pnpm test:run -- BakeryCanvasDragPerf`

### AC-036 — RT-discipline violations are caught by a static check

Module implementations must not use `std::sync::Mutex`, `RwLock`, `Box::new`
during `process`, `Vec::push`/`resize`, or any path that can panic, and a clippy
lint or doctest must enforce this surface-level. (AC-005 covers the runtime
no-alloc assertion; this AC owns the static enforcement.)

Verify with: `pnpm cargo:clippy -- -p daw-bakery -- -D warnings`

### AC-037 — The daw-bakery crate dependency direction is enforced

The `daw-bakery` crate must depend only on `daw-dsp` and `daw-core` and must
never depend on `daw-engine` or `daw-io`; the audio engine may depend on
`daw-bakery`, never the reverse.

Verify with: `pnpm cargo:test -- -p daw-bakery arch::dependency_direction`

### AC-038 — The frontend boundary follows the module conventions

The frontend Bakery module must expose a root `index.ts` re-exporting only from
`useCases/`, `events/`, `stores/`, and `presentations/views/`, with the in-memory
patch model held as a plain TS data class owned by a Vanilla
`Store<BakeryPatchState>` (no React state tree, no React Query).

Verify with: `pnpm deps:validate`

### AC-039 — The frontend obeys the React 19 / Tauri / TS-soundness constraints

The Bakery frontend must use no `useMemo`, `useCallback`, `React.memo`, or
`forwardRef`; pass `ref` as a prop; render conditionally with ternaries or early
returns, never `&&`; route all filesystem and sample-import I/O through Tauri
commands in `src-tauri`; parse patch JSON with Zod at the boundary and use no
`any` except at an I/O boundary with immediate narrowing; and register modules in
a compile-time static table (no runtime module import).

Verify with: `pnpm lint <changed-files>`

## Open questions

- [ ] (blocking) How is a feedback loop resolved — automatic one-block delay
  insertion, or an explicit user-placed delay node? This changes the compiler's
  cycle handling and AC-004.
- [ ] (blocking) [CRITICAL] Hot-reload safety when a port's type changes mid-edit:
  if a rewire makes a previously valid graph invalid, what does the engine render
  during the invalid window — continue the last valid schedule (preferred, requires
  retaining the last-valid compiled schedule), crossfade to silence, or hard-mute
  the instance? Resolve before writing the compiler's swap path. (Restored from
  specs/missing/bakery.md — dropped in migration.)
- [ ] (blocking) [CRITICAL] Deallocation strategy for removed nodes on the audio
  thread: when a node leaves the compiled schedule, where is its state freed —
  `basedrop`-style deferred-drop ring on a GC thread, UI-thread-owned state with the
  audio thread holding only pointers, or a per-instance arena freed only on instance
  destruction? Affects AC-005 and hot-reload. (Restored from specs/missing/bakery.md.)
- [ ] (blocking) [CRITICAL] Patch signing / trust boundary for community sharing:
  embedded executable code is forbidden, but a sample reference can still point at
  resource-exhausting content. Do we require signed metadata, a content-length cap,
  or both — and if signed, what is the trust anchor (Sourdaw CA, author self-signed
  key, or none in v1)? Affects AC-013 and community-sharing UX. (Restored from
  specs/missing/bakery.md.)
- [ ] (non-blocking) (restored detail) Should non-urgent canvas work (minimap
  redraws, browser filtering, large-patch layout recomputation) be deferred via
  React 19 `useTransition` / `startTransition` so interactive gestures (node
  drag, cable routing) stay on the urgent path? The 60 fps gate (AC-035) states
  the behavior; this records the mechanism the source originally prescribed,
  pending an Architect decision on whether to bind it.
- [ ] (non-blocking) Should automation target patch parameters by stable node
  ID or by exposed macro only?
- [ ] (non-blocking) Is the module catalog versioned per-patch so old patches
  keep loading when a module's port set changes?

## Affected areas

- `crates/daw-bakery/` (patch model, compiler, voice allocation, RT runtime)
- `src/modules/Bakery/` (canvas UI, module catalog, sub-patch editor)
- `crates/daw-engine/` (`ProcessTask` schedule, `ArcSwap` swap path)

## Dropped from sources

- Multi-container nesting trees — v1 ships a single device container; nested
  containers are a follow-up.
- VCV Rack hardware-emulation fidelity and analog drift modeling — out of scope.
- A shared online patch marketplace — local patch files only in v1.
