# Device racks — Instrument, MIDI FX, Audio FX, Drum

## Context

Sourdaw needs a traditional, Ableton-style **device rack** primitive: a nestable container that groups devices (instruments, MIDI effects, audio effects) into parallel chains, exposes a small fixed set of **macro knobs**, and integrates into a unified **modulation matrix** shared across the project. Racks are the composer's primary tool for designing complex sounds (layered instruments, split keyboards, parallel effect chains, drum kits) without leaving the arrangement surface.

This spec is grounded in the external research at `.agents/research/features/device-racks.md` (Ableton, Bitwig, FL Studio, Reason comparison; Rust engine architecture; CLAP vs VST3 modulation semantics; flat-schedule compilation patterns). The research establishes the **dual-representation principle** (nested tree in UI, flat topologically-sorted schedule on the audio thread) and the **u-he control-rate modulation** model that this spec operationalizes.

### Relationship to other specs

- **Not the same product as** `future-spec.md §G "Model-and-engine rack"`. That spec describes an AI/generative **engine rack** that swaps neural-model inference backends per track. This spec describes the **traditional DAW device rack** that hosts instruments/MIDI FX/audio FX and their modulation graph. The two systems coexist: an AI engine rack may hold a Sourdaw device rack as one of its downstream renderers, but the device rack is unaware of AI engines.
- **Complements** `.agents/research/consolidated/plugins-hosting.md` (eventual `plugins-hosting` spec). Plugin hosting internals — CLAP/VST3 scanning, sandboxing, parameter enumeration, plugin editor windows — live there. This spec only consumes the hosted plugin's parameter surface when wiring modulation/macros.
- **Feeds** the unified modulation matrix that other subsystems (automation lanes, MIDI learn, external control surfaces) read from.

---

## Goal

After implementation, a user can create a rack of one of four kinds (Instrument, MIDI FX, Audio FX, Drum), add parallel chains with serial devices (including nested racks), map up to **8 macro knobs** per rack to any parameter on any contained device, wire a sparse modulation matrix (macros, LFOs, envelope followers, sidechain audio, external MIDI CC → any parameter), and play the rack in real time with no allocation, no locks, and no xruns on the audio thread — including during live topology edits.

---

## User-visible behavior

1. **Create rack** — The user drops an empty rack of kind `Instrument | MidiFx | AudioFx | Drum` onto a track's device strip. The rack appears as a single device slot that can be expanded to reveal its chains.
2. **Add chain** — Inside an expanded rack, the user clicks "+ Chain" and a new empty chain appears alongside existing ones. Chains are rendered as horizontal lanes; devices in a chain are rendered left-to-right (serial).
3. **Add device to chain** — The user drops a device (native instrument, native effect, hosted plugin, or another rack) onto a chain. Nested racks display a collapsed badge and expand on click.
4. **Chain selectors** — Each chain exposes a **key range** (two MIDI-note values 0–127) and **velocity range** (two values 0–127). When a MIDI event enters the rack, only chains whose ranges contain that event receive it. Audio input is broadcast to all chains unconditionally.
5. **Drum rack** — A Drum rack presents a 4×4 pad grid. Each pad binds to exactly one chain. The pad's fixed MIDI note is assigned automatically (C1…D#2 across 16 pads, extendable). Each pad has a **choke group** (0 = none, 1–16); when a pad fires, it silences any other pad in the same non-zero group.
6. **Macros (8 per rack)** — The rack header shows 8 macro knobs labelled M1…M8. A macro value is a normalized `f32 ∈ [0, 1]`. Moving a macro updates all parameters mapped to it according to per-mapping `(min, max, curve)`.
7. **Macro mapping mode** — The user presses **Ctrl/Cmd+M** (or clicks a "Map" button on a macro). The UI enters map mode: all mappable parameters on contained devices are visually highlighted. The user clicks a target parameter to create a mapping; mapping UI appears with `min`, `max`, `curve`. Pressing **Esc** or clicking "Done" exits map mode. Mapped parameters display a colored arc ring showing the mapping range and current driven value.
8. **Modulation matrix** — Any parameter inside the rack can be a target of **any modulation source** in scope: macros of this or any enclosing rack, LFOs, envelope followers, sidechain audio followers, external MIDI CC. Sources and targets are bound via a `(source, target, depth, curve)` connection. Connections are listed in an inspector table; they can be reordered, disabled, deleted.
9. **Live edit** — The user can add, remove, or re-order devices and chains during playback. Audio does not drop out and the transport keeps running.
10. **Serialization** — The rack tree (including chain ranges, macro mappings, modulation connections, device-instance state references) round-trips through save/load and through project-version migration.

---

## Scope

### In scope

- Four rack kinds: `Instrument`, `MidiFx`, `AudioFx`, `Drum`.
- Arbitrary nesting of racks inside chains, up to a configurable depth limit (default 8).
- 8 macro knobs per rack with `(min, max, curve)` per mapping and many-parameters-per-macro fan-out.
- Sparse modulation matrix supporting sources: macros, LFOs, envelope followers, sidechain audio followers, external MIDI CC.
- Control-rate evaluation (every 32 samples) with per-sample linear interpolation between ticks.
- Per-slot audio-rate flag for FM-style modulation.
- Compile-to-flat-schedule pipeline using Kahn's algorithm and Split/Mix nodes.
- `ArcSwap`-based atomic schedule replacement on topology change, with `basedrop` deferred reclamation.
- Serialization format with an explicit version tag and forward-migration story; Automerge compatibility for collaborative edits.
- CLAP and VST3 modulation delivery with format-aware event construction.
- A macro mapping interaction that matches Bitwig/Ableton conventions (Map mode + colored ring).
- Test fixtures covering chain routing, macro fan-out, modulation matrix correctness, interpolation, compiler correctness, and live-edit swap.

### Non-goals (explicitly out of scope)

- **CLAP/VST3 plugin hosting internals** — scanning, sandboxing, plugin bridge processes, plugin editor window lifecycle. Those belong in the plugins-hosting spec.
- **Macro-mapping UX for third-party plugins v1** — v1 supports mapping macros/modulation to **native devices only**. Hosted plugin parameters are exposed as targets but the drag-to-map UX on a plugin's own editor window is deferred (users still map via the rack's parameter list).
- **Polyphonic / per-voice modulation** — v1 is monophonic (per-rack) modulation only. Per-voice modulation (Bitwig-style polyphonic modulators, CLAP per-voice `param_mod` with `note_id`) is deferred.
- **Meta-modulation (modulators targeting other modulators' parameters)** — deferred.
- **Crossfading between schedules during topology swap** — the research mentions 5–10 ms crossfade as ideal. v1 uses hard swap; if audible clicks surface during testing, the crossfade is a follow-up.
- **Automatic delay compensation across parallel chains** — v1 assumes zero-latency devices for compensation purposes. Compensation is a separate spec.
- **Modulator types beyond the listed five** — step sequencers, audio-rate envelopes, random/S&H, XY blenders are deferred.
- **A visual node-graph editor** (FL Studio Patcher-style) — out of scope; this spec is the Rack model only.

---

## Requirements

### R1 — Rack tree data model

**What**: Define the canonical in-memory and on-disk representation of a rack, chain, and device.

**Spec**:

- `Rack` has fields: `id: RackId`, `kind: RackKind`, `chains: Chain[]`, `macros: [Macro; 8]`, `matrix: ModulationMatrix`, `schema_version: u16`.
- `RackKind` is one of `Instrument`, `MidiFx`, `AudioFx`, `Drum`.
- `Chain` has fields: `id: ChainId`, `devices: Device[]`, `key_range: (u8, u8)`, `velocity_range: (u8, u8)`, `pad?: DrumPadBinding` (present iff parent rack kind is `Drum`).
- `Device` is a tagged union: `Native { kind: NativeDeviceKind, state_id: StateId }`, `HostedPlugin { format: PluginFormat, plugin_id: PluginInstanceId }`, `NestedRack { rack: Rack }`.
- `Macro` has fields: `id: MacroId`, `label: string`, `value: f32 ∈ [0, 1]`, `mappings: MacroMapping[]`.
- `MacroMapping` has fields: `target: ParameterRef`, `min: f32`, `max: f32`, `curve: MappingCurve`.
- `ParameterRef` uniquely identifies a parameter: `{ device_path: DevicePath, param_id: ParamId }` where `DevicePath` is a sequence of `(ChainId, slot_index)` addressing into the rack tree.
- `schema_version` starts at `1`. A migration function maps version `N` to version `N+1`.
- The on-disk format is **JSON with an explicit `schema_version` field at the root**; binary blobs (e.g. plugin state) are stored as base64 strings referenced by `StateId`.
- Data types are **Automerge-compatible**: all IDs are opaque strings (UUIDs), no mutable back-references in the tree, arrays of children rather than parent-pointing doubly-linked structures.

**AC**:

- Unit test: round-trip a fixture rack through serialize → deserialize → structural equality.
- Unit test: load a `schema_version: 1` fixture through the current migrator and assert the resulting rack matches the expected current-version rack.
- Type-level test (TypeScript side): `Rack` has no cyclic references and all IDs are branded string types.

### R2 — Parallel chains

**What**: Multiple chains in a rack run in parallel. For `AudioFx` / `Instrument` / `Drum` racks, all audio outputs are summed. For `MidiFx` racks, the first chain whose selector matches wins.

**Spec**:

- `AudioFx` rack: input audio is broadcast to every chain that matches (for `AudioFx`, all chains always match on audio). Output is the sum of chain outputs.
- `Instrument` rack: input MIDI is routed to all chains whose key/velocity ranges contain the event. Each chain's output audio is summed into the rack's output.
- `Drum` rack: input MIDI is routed only to the chain whose pad MIDI note matches the event's note. Output is the sum across sounding pads, with choke groups silencing overlapping voices.
- `MidiFx` rack: input MIDI is routed to the **first** chain (lowest index) whose key/velocity ranges contain the event. Output MIDI is the processed MIDI from that chain.
- Compile output: each chain appears as a path in the flat `Vec<ProcessTask>`; a Split node feeds all chains; a Mix node sums them.

**AC**:

- Fixture: `AudioFx` rack with 3 chains each containing a distinct gain device (gains 0.25, 0.5, 1.0). Feed a unit DC signal. Engine output sample equals `0.25 + 0.5 + 1.0 = 1.75` (± tolerance).
- Fixture: `Instrument` rack with 3 chains holding a note-tag synth (each outputs a distinct frequency on any note). Send MIDI note-on, assert all three frequencies present in the output spectrum.
- Compiler test: given the above 3-chain fixture, the produced `Vec<ProcessTask>` contains 1 Split + 3 chain paths + 1 Mix, and all 3 chain path nodes appear in the schedule.

### R3 — Chain selector (key/velocity zones)

**What**: Key range and velocity range on a chain filter which MIDI events reach that chain.

**Spec**:

- Each chain has `key_range: (u8, u8)` and `velocity_range: (u8, u8)`. Default is `(0, 127)` on both.
- A MIDI note-on event with note `n` and velocity `v` is delivered to a chain iff `key_range.0 ≤ n ≤ key_range.1` AND `velocity_range.0 ≤ v ≤ velocity_range.1`.
- Note-off events are always delivered to any chain that previously received the corresponding note-on for that `note_id`, regardless of current range (prevents stuck notes when ranges are edited live).
- Non-note MIDI (CC, pitch bend, aftertouch) is broadcast to all chains in the rack.
- Ranges are inclusive on both ends. If `key_range.0 > key_range.1`, the chain is considered "off" (no MIDI delivery).

**AC**:

- Fixture: `Instrument` rack with 3 chains, ranges `(0, 42)`, `(43, 84)`, `(85, 127)`. Send MIDI note 60. Assert only chain index 1 receives the note-on event.
- Fixture: same rack, send note-on 60 to chain 1, then edit chain 1's range to `(90, 100)` during playback, then send note-off 60. Assert chain 1 receives the note-off (stuck-note prevention).
- Fixture: send CC 7 value 64. Assert all three chains receive the CC.

### R4 — Drum rack

**What**: A Drum rack is a special case of Instrument rack where each chain is pinned to one pad (fixed MIDI note) and pads can belong to choke groups.

**Spec**:

- Drum rack has exactly one chain per pad; adding a device actually adds a chain with a default pad binding.
- `DrumPadBinding` has fields: `pad_index: u8 ∈ 0..16`, `midi_note: u8`, `choke_group: u8 ∈ 0..=16` (0 = no choke).
- Default pad layout: pad 0 = C1 (note 36), ascending chromatically. Users can override `midi_note` per pad.
- A chain's `key_range` on a Drum rack is forced to `(midi_note, midi_note)` and `velocity_range` defaults to `(1, 127)`.
- When a pad fires (note-on received), if `choke_group != 0`, all currently-sounding pads in the same choke group receive an immediate note-off (implementation: internally routed MIDI note-off events inserted at the same sample offset as the triggering note-on + 1).
- Choke does not affect pads with `choke_group == 0`.
- A pad with `choke_group == n` chokes itself as well: a new hit silences the previous hit (monophonic-per-pad within a choke group).

**AC**:

- Fixture: Drum rack, pad 0 (C1, choke 1) holds an instrument with a 2 s release tail. Fire C1 twice with 200 ms gap. Assert first voice is silenced within 1 sample of second trigger.
- Fixture: Drum rack, pad 0 (choke 1) and pad 1 (choke 2) both playing. Firing pad 1 does not silence pad 0.
- Fixture: Drum rack, pad 0 with `choke_group = 0`. Fire C1 twice. Assert both voices continue ringing in parallel.

### R5 — 8 macro knobs per rack

**What**: Each rack exposes exactly 8 macro knobs. Each macro linearly maps to `N ≥ 0` device parameters according to per-mapping `(min, max, curve)`.

**Spec**:

- Macro value `m ∈ [0, 1]`. Target parameter value for a mapping is computed as `target = min + (max - min) * curve(m)` where `curve` is one of `Linear`, `ExpPow2`, `LogInverseExpPow2`, `SCurve`.
- `min` and `max` are in the target parameter's **normalized** `[0, 1]` space. Setting `min > max` yields inverted mapping (no separate inversion flag).
- Multiple macros may target the same parameter; see R7 for conflict resolution.
- Moving a macro updates the **base** value of any natively-owned target parameter (non-destructive for plugin targets; see R12).
- The fan-out from macro → parameter is evaluated on the audio thread at control rate as part of the modulation matrix tick; macros are registered as sources in the sparse matrix (see R7).

**AC**:

- Fixture: Rack with Macro 1 mapped to two target parameters (P_A with `(0.2, 0.8, Linear)` and P_B with `(1.0, 0.0, Linear)` — inverted). Set Macro 1 to 0.5. Assert `P_A = 0.5` and `P_B = 0.5`.
- Fixture: same rack, set Macro 1 to 0.0. Assert `P_A = 0.2`, `P_B = 1.0`.
- Fixture: same rack, set Macro 1 to 1.0. Assert `P_A = 0.8`, `P_B = 0.0`.
- Fixture (curve): Macro 1 mapped to P with `(0, 1, ExpPow2)`. Set Macro 1 to 0.5. Assert `P ≈ 0.25` (within 1e-4).

### R6 — Macro mapping UX

**What**: Map mode is a discrete UI state. The user enters map mode, clicks a macro, clicks a target parameter, and a mapping is created and persisted.

**Spec**:

- Entering map mode: hotkey **Ctrl/Cmd+M** or clicking the rack's "Map" button. The UI visually highlights all mappable parameters (including those on nested racks and hosted native devices).
- Alternative flow: right-click any mappable parameter → "Map to Macro …" submenu listing M1…M8.
- Creating a mapping: while map mode is active and a macro is the current "source," clicking a parameter creates a mapping with defaults `min = current parameter value`, `max = current parameter value + 0.25` (clamped to `[0, 1]`), `curve = Linear`. The exact default is a UI concern and may be refined; the contract is simply that a mapping is created.
- Exiting map mode: **Esc** or clicking "Done."
- Each mapped parameter renders a **colored arc ring** around its knob. Ring color encodes the macro index (M1…M8 have distinct stable colors). The ring arc spans `[min, max]` mapped onto the knob's rotation; a dot indicates the current driven value.
- Mappings are persisted as part of the rack serialization (R1).
- A dedicated **Mapping Inspector** panel lists all `(macro, target, min, max, curve)` rows for the focused rack; rows can be edited inline or deleted.

**AC**:

- E2E test: press Ctrl/Cmd+M, click Macro 1, click a target parameter on a device. Assert a new `MacroMapping` exists in the model and the parameter displays a ring.
- E2E test: enter map mode, press Esc. Assert map mode is no longer active (highlight disappears).
- E2E test: save project, reload, assert the mapping round-trips and the ring still renders.
- Unit test: the Mapping Inspector renders exactly `N` rows for `N` mappings in the model.

### R7 — Sparse modulation matrix

**What**: A sparse adjacency-list matrix holds `(source, target, depth, curve)` connections. Sources include macros, LFOs, envelope followers, sidechain audio followers, external MIDI CC. Targets are any parameter within the rack (including nested racks).

**Spec**:

- Engine-side data structure matches the research blueprint: fixed-capacity array of `ModulationSlot { source_id: u16, dest_id: u16, depth: f32, curve: ModCurve, flags: ModFlags, min_clamp: f32, max_clamp: f32 }` with capacity **256 slots per rack** (configurable compile-time constant). `depth` is **bipolar in `[-1.0, 1.0]`**; polarity at the connection edits sign rather than swapping source/target. Research range is 64–256 slots; v1 picks the upper bound for simplicity.
- The matrix also holds pre-allocated arrays: `source_values[MAX_SOURCES]`, `base_values[MAX_DESTINATIONS]`, `dest_accumulators[MAX_DESTINATIONS]`, `final_values[MAX_DESTINATIONS]`, `current_values[MAX_DESTINATIONS]` (post-interpolation), `per_sample_delta[MAX_DESTINATIONS]`.
- A connection enforces **type compatibility**: source output domain must match target parameter domain. Attempting to wire an incompatible connection is a UI-level error; the engine never sees the invalid connection.
- Per-tick cycle (control rate, every 32 samples — research allows 16–64; v1 fixes 32):
  1. Update source values (LFOs step, envelope followers process the last 32 samples of their source audio, macros read their target UI value, CC sources read the most recent CC value).
  2. Zero destination accumulators.
  3. For each active, enabled slot: `accum[dest] += apply_curve(source[src] * depth, curve)`.
  4. Compute `final[dest] = clamp(base[dest] + accum[dest], min_clamp, max_clamp)`.
  5. Compute `per_sample_delta[dest] = (final[dest] - current[dest]) / 32`.
- **Conflict resolution** when multiple sources target the same parameter: **additive summation** of offsets, final value clamped to `[min_clamp, max_clamp]`. (See Open Questions — the additive default is the Bitwig model; an alternative "latest wins" behaviour per-connection is listed as a CRITICAL open question.)
- All allocation happens off-thread when the matrix is built/edited. On-thread updates mutate pre-allocated slots only.

**AC**:

- Unit test: build a matrix with 5 connections, assert `active_slot_count == 5` and all other slot bytes are zeroed.
- Instrumented test: run the engine with a fixture rack for 10 s at 48 kHz under a no-allocation assertion (e.g. `#[global_allocator]` wrapped to count allocations during the audio callback). Assert zero allocations on the audio thread across all modulation updates.
- Unit test: two connections target the same parameter with depths 0.25 and -0.10. Set base to 0.5, both sources to 1.0. Assert `final = clamp(0.5 + 0.25 + (-0.10), min_clamp, max_clamp) = 0.65`.

### R8 — Control-rate vs audio-rate modulation slots

**What**: Each slot carries a flag determining whether it is evaluated every 32 samples (control rate) or every sample (audio rate). Audio rate is required for FM-style modulation where the modulator is at audible frequency.

**Spec**:

- `ModFlags::AUDIO_RATE` flag opts a slot into the per-sample evaluation loop. Without it, the slot is control-rate.
- Control-rate slots are evaluated once per tick (32 samples) and linearly interpolated per sample between ticks.
- Audio-rate slots are evaluated in a separate inner per-sample loop. They skip interpolation and write directly to `current_values[dest]`.
- A slot must be audio-rate when its source is an LFO whose rate > 500 Hz, or when the source is an oscillator output used as an FM carrier.
- The UI exposes an **"Audio rate"** toggle per connection; the default is control rate for conservativeness.

**AC**:

- Fixture: audio-rate slot with source = 200 Hz sine, target = another oscillator's frequency (FM depth = 50 Hz). Run for 1 s, analyse spectrum; assert sidebands at `carrier ± 200 Hz` are present above noise floor.
- Fixture: control-rate slot with source = 2 Hz LFO, target = a gain parameter with depth 0.5. Run for 5 s; assert peak-trough amplitude modulation at 2 Hz (tremolo) matches expected envelope within tolerance.
- Unit test: setting a slot's `AUDIO_RATE` flag moves it from the control-rate list to the audio-rate list in the internal slot index (next tick).

### R9 — Parameter interpolation (zipper-noise prevention)

**What**: Parameter values exposed to DSP processors are smoothed between control-rate updates so that macro or modulation movements do not produce audible steps.

**Spec**:

- Between control-rate ticks, each control-rate parameter uses `current += per_sample_delta` per audio sample.
- At the end of the tick window (after 32 samples), `current == final` (within float precision). The next tick recomputes `final` and a new delta.
- Rapid macro movement that crosses multiple ticks should produce a piecewise-linear envelope on the target parameter, with segment boundaries at tick edges — not step transitions.
- Audio-rate slots skip the smoothing and write the raw modulated value (per R8).
- Targets inside hosted plugins receive smoothed values via the appropriate event per R12.

**AC**:

- Fixture: a single macro mapped to a gain parameter. Rapidly sweep the macro from 0 to 1 over 100 ms while the rack processes a unit sine at 1 kHz. Analyse the output envelope; assert the first derivative never exceeds the per-sample-delta bound for any 32-sample window (no steps).
- Fixture: same as above, but hit the audio output with a zipper-noise spectral test (presence of artefacts at multiples of the tick frequency). Assert spectral peaks at `Fs / 32` Hz and its harmonics are below a threshold (e.g. -80 dBFS).

### R10 — Compile-to-flat-schedule

**What**: The rack tree compiles into a flat topologically-sorted `Vec<ProcessTask>` via Kahn's algorithm, with Split and Mix nodes inserted at rack boundaries.

**Spec**:

- Each rack expands to: 1 Split node (fan-out to N chains) + N chain paths + 1 Mix node (fan-in).
- Each chain path is a serial sequence of its device process nodes.
- Nested racks recursively expand within their parent chain.
- Topological sort uses Kahn's algorithm. Ties within a topological layer are broken by a stable ordering (chain index, then device slot index) to make compiler output deterministic.
- Buffer allocation uses graph coloring to minimize pool size. Buffer indices are stored in each `ScheduleEntry` (see research § "Concrete Rust data structures").
- Feedback cycles are forbidden in v1. The compiler rejects a rack that would produce a cycle and returns an error to the UI. **Future extension** (out of v1): break cycles explicitly with a `FeedbackDelay` node (research pattern) — a user-declared 1-block delay at the break point. Within-node feedback (e.g. a filter's recursive path) stays sample-rate internal to the processor and does not require a cycle in the host graph.
- Compiler is **pure**: given the same input tree, it always produces the same `Vec<ProcessTask>` (byte-equal up to the opaque node-index space).
- **Parallel execution (optional, out of v1):** Kahn's layers naturally expose "parallel groups" — all in-degree-zero nodes at each wave can run concurrently on a real-time worker pool. v1 executes the flat list single-threaded. If revisited, gate multi-threaded dispatch behind a minimum block-size threshold (~128–256 samples) and use macOS **Audio Workgroups** on Apple platforms.

**AC**:

- Unit test: compile a fixture rack with 3 parallel chains, each with 2 serial devices. Assert the schedule has `1 Split + (3 × 2) device nodes + 1 Mix = 8` entries and is topologically valid (every node's inputs appear earlier in the list).
- Unit test: compile a nested rack (rack A with a chain containing rack B with 2 chains). Assert the schedule contains 2 Split nodes, 2 Mix nodes, plus the device nodes, and is topologically valid.
- Unit test: construct a pathological tree that would require a cycle after expansion. Assert the compiler returns an error enum with variant `ScheduleError::Cycle { … }`.
- Property test: random-gen 100 trees up to depth 4 with up to 4 chains per rack and up to 4 devices per chain; assert schedule is topologically valid for every sample.

### R11 — ArcSwap schedule swap on topology change

**What**: Topology edits (add/remove chain, add/remove device, reorder) cause a new schedule to be compiled off-thread and published to the audio thread atomically via `ArcSwap`.

**Spec**:

- Background thread clones the current tree, applies the pending edit, recompiles to `CompiledSchedule`, wraps in `Arc`, and calls `ArcSwap::store`.
- Audio thread loads `Arc<CompiledSchedule>` once at the top of each process callback via `ArcSwap::load_full`.
- **UI→RT command path (complement to `ArcSwap`):** small, granular commands (`SetParameter`, `SetMacro`, `AddModRoute`, `RemoveModRoute`) flow through an **SPSC ring buffer** (e.g. `rtrb`) and are drained at the top of the process callback. Full schedule replacements remain `ArcSwap`-based; commands avoid recompile latency for one-off parameter moves.
- **Single hot parameters:** where only one scalar needs to cross threads, use **`AtomicF32`**-style atomics (e.g. `atomic_float`) rather than snapshotting the whole matrix. Zero-overhead single-value sharing (research: NIH-plug reference pattern).
- Old schedule's `Arc` refcount drop happens on the audio thread (cheap), but deallocation is deferred via `basedrop` to a non-RT collector thread.
- Plugin instances persist across swaps; only their position in the schedule changes. New plugins are activated and `start_processing()`'d before the swap; removed plugins are deactivated after the swap completes.
- No crossfade in v1 (see Non-goals). Hard swap only.
- Shared state between schedules (e.g. plugin instance parameter buffers) uses `Arc` clones, not deep copies.

**AC**:

- Stress test: live-edit the rack (add chain, remove chain, add device, remove device) 100 times over 30 s while the engine renders a 1 kHz sine. Record output; assert no samples deviate from sine (± tolerance) outside the swap window, and no sample hits `NaN` / `Inf`.
- Stress test: measure xruns via the platform audio callback's late-buffer counter during 30 s of rapid live edits. Assert xrun count == 0.
- Unit test: after a swap, the old `Arc<CompiledSchedule>` is scheduled for deferred drop via `basedrop`, not dropped on the audio thread (verified via a test allocator that fails if `free` is called from the audio thread).

### R12 — CLAP `param_mod` vs VST3 parameter events

**What**: When a hosted plugin is inside a rack, the rack delivers modulation via `clap_event_param_mod` for CLAP and computed absolute values via `IParamValueQueue::addPoint` for VST3.

**Spec**:

- CLAP path: per audio block, for each modulation target inside a CLAP plugin, the rack emits one `CLAP_EVENT_PARAM_MOD` event with `amount = accumulated_modulation_offset` and `time = sample_offset_within_block`. The `param_value` event (base) is sent only when the user moves the plugin's UI knob. Base and modulation remain separable.
- VST3 path: per audio block, for each modulation target inside a VST3 plugin, the rack computes `final_normalized = clamp(base_normalized + modulation_offset, 0.0, 1.0)` and calls `IParamValueQueue::addPoint(sample_offset, final_normalized_value)`. The rack tracks base separately so it can restore when modulation stops.
- For both formats, the rack emits **at least** one event per block per target whose value changed this block. Sub-block accuracy is achieved by emitting multiple events at distinct sample offsets when the modulated value changes within a block (audio-rate slots).
- Polyphonic / per-voice modulation (`note_id != -1`) is out of scope for v1; the rack uses `note_id = -1` (global) on all CLAP `param_mod` events.
- A `PluginFormat` enum (`Clap | Vst3`) drives the dispatch via a `match`.

**AC**:

- Fixture (CLAP): a test CLAP plugin that logs every incoming event. Map a macro to a plugin parameter. Move the macro. Assert exactly `CLAP_EVENT_PARAM_MOD` events arrive (no `CLAP_EVENT_PARAM_VALUE`), each with `note_id == -1`, `channel == -1`, `key == -1`, and `amount` matching the expected `depth × curve(macro_value)`.
- Fixture (CLAP): after modulation returns to 0, the plugin's internal effective value returns to the user-set base (verified via the plugin's output).
- Fixture (VST3): a test VST3 plugin that logs parameter values. Map a macro and move it. Assert every received value equals `clamp(base + depth × curve(macro_value), 0, 1)`.
- Fixture (VST3): move the user UI knob to update `base`, then move the macro to apply modulation, then release the macro; assert the received values match the expected `final` trajectory and return to `base` on release.

### R13 — Serialization and cross-version compatibility

**What**: Rack trees serialize to and deserialize from disk. The on-disk format carries a version tag; newer readers can load older formats via migration.

**Spec**:

- On-disk format: JSON with top-level `{ schema_version: u16, rack: Rack }`.
- Reader looks at `schema_version`. If `version == CURRENT_VERSION`, parse directly. If `version < CURRENT_VERSION`, run registered migration steps `V_n → V_{n+1}` in sequence until reaching `CURRENT_VERSION`. If `version > CURRENT_VERSION`, return an error.
- Each migration step is a pure function from a typed previous-version struct to a typed next-version struct. Migrations are kept alongside the spec in `src/modules/Devices/…/migrations/`.
- Plugin state blobs are opaque base64 strings. The rack knows the `plugin_id` and `format` but not the blob's schema.
- Automerge compatibility: the rack tree shape is a CRDT-friendly shape — arrays of children rather than parent pointers, opaque string IDs rather than numeric indices, no `HashMap` with numeric keys.
- A "rack.json" round-trip test lives in CI.

**AC**:

- Unit test: deserialize a hand-authored `schema_version: 1` fixture. Assert the current-version rack equals the expected golden value.
- Unit test: deserialize a fixture with `schema_version: 999`. Assert an error is returned of variant `RackLoadError::UnsupportedVersion { found: 999, max_supported: CURRENT_VERSION }`.
- Unit test: serialize a rack, deserialize, compare structural equality. Run this on 20 generated fixtures covering every device kind and nesting pattern.
- CRDT test: two replicas apply the same sequence of edits (add chain, add device, edit macro, edit mapping) via Automerge-style merge. Assert convergence (both replicas produce structurally equal rack trees).

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`). The new module is `src/modules/Devices/` (frontend) and a matching crate boundary in `daw-engine` (Rust) for the rack runtime.
- The rack runtime on the Rust side lives entirely in `daw-engine` and `daw-dsp`. No rack code appears in `src-tauri` beyond the thin bridge.
- **No allocation, no locks, no blocking on the audio thread.** All modulation, interpolation, macro updates, matrix evaluation, and schedule lookup use pre-allocated buffers and atomic primitives only. Pre-allocated pools sized at rack creation; regrowth happens off-thread via schedule swap.
- Serialization uses Sourdaw's existing Automerge-compatible patterns (see `state-and-write-paths` skill). Do not invent a new persistence mechanism.
- `pnpm deps:validate` must pass with zero violations after the module is added.
- TypeScript soundness (`AGENTS.md` § TypeScript — soundness): no `any`, no `as` to silence errors, discriminated unions for all tagged types.
- No `useMemo` / `useCallback` / `React.memo` / `forwardRef` — React 19 + compiler.
- No `&&` in JSX for conditional rendering — ternaries or early returns only.
- Styling: Tailwind v4 via `@theme` tokens; no custom CSS outside `main.css`.

---

## Design decisions

### Decision: Tree-and-flatten architecture (not ad-hoc runtime lookup)

**Chosen**: The user model is a nested tree; the engine schedule is a flat topologically-sorted `Vec<ProcessTask>`. Topology changes trigger a full recompile off-thread and an `ArcSwap` publish.

**Considered and rejected**:

- **Recursive DFS on the tree every audio callback.** Pointer-chasing cache misses, unbounded stack depth, no parallelism surface. Research § "Flat compiled schedules outperform recursive graph walking" establishes this as the dominant production pattern (JUCE, Tracktion, SuperCollider, Pure Data).
- **Mutate the current schedule in place on topology change.** Impossible to do lock-free across arbitrary edits; requires audio-thread to block or skip; fails the no-locks invariant.

### Decision: Sparse slot-based modulation matrix (not dense N×M)

**Chosen**: Fixed-capacity array of `ModulationSlot` structs (capacity 256 per rack), iterated only over active slots.

**Considered and rejected**:

- **Dense `[[f32; M]; N]` matrix.** For a rack with 64 sources and 256 targets, that is 16k `f32` slots scanned per tick when typically <10 are non-zero. Cache-hostile and CPU-wasteful.
- **`HashMap<(SrcId, DstId), Slot>`.** Not RT-safe (heap allocation, hash collisions, non-deterministic iteration).

### Decision: Control-rate evaluation with per-sample interpolation

**Chosen**: Matrix ticks every 32 samples; parameter values interpolate linearly between ticks at audio rate.

**Considered and rejected**:

- **Sample-rate matrix evaluation always.** CPU cost scales with `Fs`; unnecessary for most modulation. The u-he approach (research § "A sparse slot-based modulation matrix") is the industry proof point.
- **Block-rate (no interpolation).** Produces zipper noise on rapid macro moves; fails R9.

### Decision: `ArcSwap` + `basedrop` for schedule replacement

**Chosen**: `arc_swap::ArcSwap<CompiledSchedule>` with `basedrop` for deferred reclamation.

**Considered and rejected**:

- **SPSC ring buffer carrying a full `CompiledSchedule` by value.** `CompiledSchedule` is large (node vector, buffer pool); copying it across a ring is wasteful. `Arc` swap costs one atomic.
- **`Mutex<Arc<CompiledSchedule>>`.** Audio thread cannot lock a mutex. Disqualified.
- **`RwLock`.** Writer can block; disqualified.

### Decision: 8 macros (not 16) in v1

**Chosen**: 8 macros per rack in v1.

**Considered and rejected**:

- **16 macros (Ableton Live 12 parity).** Research notes Live 12 expanded to 16. 8 covers the vast majority of real-world rack designs and keeps UI density manageable; expanding to 16 is a follow-up if users hit the ceiling.

### Decision: Additive modulation (Bitwig model), not destructive (Ableton pre-12 model)

**Chosen**: Modulation adds an offset to the base parameter value. The user's direct control of the base value is never disabled by a mapping.

**Considered and rejected**:

- **Destructive / absolute (Ableton pre-12).** The mapped parameter loses direct user control. Research (§ "How Ableton, Bitwig … approach macro mapping") cites this as Ableton's key limitation; Bitwig's additive model is strictly more flexible.

### Decision: Hard swap (no crossfade) in v1

**Chosen**: Topology swaps use a hard `ArcSwap::store`. Any click artefacts are deferred to a crossfade follow-up.

**Considered and rejected**:

- **5–10 ms linear crossfade between old and new schedules.** Research recommends this for "seamless" transitions. Deferred because it doubles the engine's per-block cost during the crossfade window, requires running both schedules in parallel, and complicates the buffer-pool lifecycle. v1 ships without; follow-up spec if audible.

---

## Acceptance criteria

### Top-level release gate

- [ ] All requirement-level AC (R1–R13) pass.
- [ ] Fixture rack with 3 parallel chains renders correctly (R2).
- [ ] Fixture rack with key-range chains routes MIDI correctly (R3).
- [ ] Drum rack fixture with choke groups silences overlapping voices correctly (R4).
- [ ] Moving Macro 1 updates all mapped parameters according to their per-mapping formulas (R5).
- [ ] Map mode entered via hotkey, a mapping is created on click, persists to disk, and renders as a colored ring (R6).
- [ ] Modulation matrix contains exactly the configured connections and performs zero allocations on the audio thread (R7).
- [ ] Audio-rate slot fixture produces audible FM sidebands; control-rate LFO fixture produces tremolo (R8).
- [ ] Rapid macro movement fixture produces no audible zipper artefacts (R9).
- [ ] Compiler produces topologically-valid flat schedules for 100 randomly-generated trees (R10).
- [ ] 30 s live-edit stress test produces 0 xruns and no out-of-range samples (R11).
- [ ] CLAP fixture plugin receives `param_mod` events; VST3 fixture plugin receives clamped absolute values (R12).
- [ ] Schema version round-trip passes for 20 fixture racks; older-version fixtures migrate correctly (R13).
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes.
- [ ] No `any`, `as`, or `@ts-expect-error` without justified suppression (verified by `pnpm lint`).

---

## Implementation notes

- **Module placement**: `src/modules/Devices/` for the frontend model, stores, use cases, and presentation. `daw-engine` for the Rust rack runtime. `daw-dsp` for any new pure-DSP helpers required by built-in modulator sources (LFO, envelope follower).
- **Reuse `Store<T>`** for the rack UI state (`src/modules/Devices/stores/racksStore.ts`). Use cases under `useCases/` mutate it one function per file.
- **Reuse the existing serialization pattern** from `state-and-write-paths` skill. The `schema_version` migration pattern already has precedent in the project; see existing migrations before writing new ones.
- **Kahn's algorithm reference**: the `audio_graph` crate is cited in the research as a production-ready Rust implementation. Vendor the algorithm rather than adding the crate as a dependency unless the user explicitly approves — adding dependencies is subject to `AGENTS.md` safety rules. Additional research references for alternative graph-compilation styles (informational only, not v1 dependencies): `hexodsp` (pre-compiled NodeProg), `fundsp` (combinator-based), `auxide` (explicit `Plan::compile()`).
- **Parameter smoothing reference:** NIH-plug's `Smoother` + parameter patterns are cited in the research as the reference implementation for R9-style smoothing and may be consulted when designing the internal smoother API.
- **Tests**: spec files live in `__tests__/` adjacent to their subject (see `testing-file-layout` skill). Compiler tests, matrix tests, and audio-callback no-alloc tests are Rust `#[cfg(test)]` inside `daw-engine`.
- **Modulation sources catalogue** for v1: `Macro`, `LFO`, `EnvelopeFollower`, `SidechainAudioFollower`, `ExternalMidiCC`. Each is a small struct with a `process(&mut self, block_len: usize) -> f32` method returning the current source value.
- **Colored arc ring** is a presentation-only component. Reuse existing knob widget styling; add a ring overlay computed from `(min, max, current_value, macro_color)`.

---

## Test plan

### Manual

- [ ] Create a rack, add 3 chains, add different devices to each, verify they all play in parallel.
- [ ] Switch rack kind between Instrument/MidiFx/AudioFx/Drum and verify UI updates appropriately.
- [ ] Create a Drum rack, assign pads, set choke groups 1/1/2, play overlapping hits, verify choke behavior by ear and via meter.
- [ ] Enter map mode (Cmd+M), click Macro 1, click a knob on a device, verify the colored ring appears and the macro drives the parameter.
- [ ] Edit a mapping's `min`/`max`/`curve` in the Mapping Inspector, verify real-time effect.
- [ ] Create 10 mappings, delete 5, save, reload, verify state round-trips.
- [ ] Live-edit the rack while playback is running, verify no audio dropouts.

### Automated

- [ ] R1 — Round-trip serialization unit tests (frontend + engine).
- [ ] R2 — Parallel-chain DSP fixture tests (engine).
- [ ] R3 — Chain-selector unit tests (engine).
- [ ] R4 — Drum rack choke-group unit tests (engine).
- [ ] R5 — Macro-to-parameter fan-out unit tests (engine).
- [ ] R6 — Map-mode E2E tests (frontend Playwright or equivalent).
- [ ] R7 — Matrix population + audio-thread no-allocation instrumented test (engine).
- [ ] R8 — Audio-rate FM fixture (spectrum analysis) + control-rate tremolo fixture (envelope analysis) (engine).
- [ ] R9 — Zipper-noise spectral threshold test (engine).
- [ ] R10 — Compiler correctness unit tests + property test over random trees (engine).
- [ ] R11 — 30-second live-edit xrun stress test (engine integration test with a dummy backend).
- [ ] R12 — CLAP / VST3 fixture plugin event recording tests (engine).
- [ ] R13 — Schema migration unit tests + CRDT convergence test (engine or shared).

---

## Open questions

- [ ] **[CRITICAL]** Macro maps to a parameter that is subsequently **removed** (device deleted, plugin uninstalled, or nested rack collapsed). What is the defined behavior?
  - **Option A**: Mapping is kept as "stale," greyed out in the inspector, restorable if the target reappears at the same `ParameterRef`.
  - **Option B**: Mapping is auto-deleted on first load where the target is missing.
  - **Option C**: Mapping is kept and silently skipped at runtime until a target of a matching path appears.
  - This blocks R5 / R13 because the serialization contract depends on the answer. Decide before implementation.
- [ ] **[CRITICAL]** **Modulation conflict resolution** when two sources target the same parameter. R7 specifies additive summation by default, but the Bitwig/Ableton convention for "slot priority" is not universal.
  - **Option A**: Always additive (current default).
  - **Option B**: Per-connection `conflict_policy: Additive | LatestWins | Max | Min`. Adds slot flag space.
  - **Option C**: Per-target conflict policy set on the parameter itself, not per connection.
  - This blocks R7 implementation. Decide before writing the matrix evaluator.
- [ ] **[MAJOR]** **Macro mapping for third-party plugins** is out of scope for v1 (Non-goals), but the boundary is fuzzy: the rack still lists plugin parameters as targets, the user can still map via the right-click "Map to Macro …" flow. What is the minimum viable v1 behavior for plugin parameters without the drag-to-map UX on the plugin's own editor? (Current answer: users map via the rack's parameter list in the Mapping Inspector only. Confirm.)
- [ ] **[MINOR]** **Audio-rate modulation of pitched parameters** (frequency, detune) needs a defined unit convention. Is the depth in Hz? Semitones? Normalized fraction? R8 uses normalized `[0, 1]` depth on the target's normalized parameter range, but this gives non-musical results for frequency. A per-parameter-type depth unit might be needed; defer to v2 unless users report unusable behavior.
- [ ] **[MINOR]** Does v1 support **per-project macros** (scoped to the project, not to a rack)? The future-spec mentions global macros. Current scope: **rack-scoped only**.
- [ ] **[MINOR]** Maximum rack **nesting depth** is configurable (default 8). Is 8 sufficient? Reason caps at 1; Ableton effectively caps by UX fatigue; Bitwig caps at ~32. 8 seems safe but warrants confirmation.
- [ ] **[MINOR]** Should the colored-ring macro color scheme be user-configurable, or use a fixed 8-color palette keyed to M1…M8? v1: fixed palette.

---

## Tradeoffs and risks

- **Compiler correctness risk**: Kahn's algorithm is well-understood, but Split/Mix insertion, nested-rack expansion, and tie-breaking are novel to this codebase. A bug here produces wrong audio or wrong topology. Mitigation: property test over random trees (R10) + extensive unit coverage + deterministic-output contract.
- **ArcSwap rename race**: If two edits land in quick succession and both spawn compile jobs, the later-completing job may store a stale schedule. Mitigation: compile jobs carry a monotonic edit sequence number; `ArcSwap::store` only succeeds if the incoming sequence number is newer than the currently-stored one (via `compare_and_swap` loop).
- **Plugin format churn**: CLAP is still evolving; `param_mod` semantics are well-defined today but future CLAP extensions may require revisiting R12. Low risk short-term.
- **VST3 absolute-value race**: When the user moves a plugin knob while modulation is active, the rack and the plugin may disagree on `base`. R12 designates the rack as the single authority on final values; the plugin's own UI moves must round-trip through the rack's base tracker. If the plugin has its own internal automation, this becomes hard to guarantee. Acknowledged limitation; logged as a known quirk rather than blocker.
- **UX learning curve**: Map mode is a modal interaction; new users will need discoverable affordances (first-run tooltip, empty-state prompt on the Mapping Inspector). Not a correctness risk, but a product risk.
- **Memory pressure from 256 slots × N racks**: Each rack preallocates 256 slots plus source/dest arrays. At 64 racks in a large project that is still < 2 MB — acceptable.
- **Off-thread compile latency**: For very large racks (hundreds of devices), compilation may take > 10 ms. This does not block audio (it runs off-thread) but may produce a user-perceived delay before an edit takes effect. Mitigation: incremental compilation is a follow-up if needed; v1 accepts the delay.
