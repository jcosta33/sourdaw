---
type: spec
id: SPEC-device-racks
title: Device racks — instrument, MIDI FX, audio FX, and drum
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Device racks — instrument, MIDI FX, audio FX, and drum

## Intent

Add nestable device racks (Instrument, MIDI FX, Audio FX, Drum) with parallel
chains, chain selectors, eight macro knobs, and a unified additive modulation
matrix — authored as a nested UI tree but compiled to the engine's flat
schedule and swapped atomically so topology changes never glitch.

## Non-goals

- New DSP devices; racks contain existing devices and plugins.
- Per-sample modulation of every parameter; modulation evaluates at control rate
  with interpolation to audio rate.
- Cross-track racks; a rack lives on one track.

## Requirements

### AC-001 — A rack is a tree of chains and devices

A rack must persist as a tree of parallel chains, each holding an ordered device
list, that round-trips through save/load with versioning.

Verify with: `pnpm test:run -- deviceRackModel`

### AC-002 — The rack tree compiles to a flat engine schedule

Building a rack must flatten the nested tree into the engine's
`Vec<ProcessTask>` schedule preserving chain order and parallel summing.

Verify with: `pnpm cargo:test -- -p daw-engine rack::flatten_schedule`

### AC-003 — Topology changes swap the schedule atomically

Adding, removing, or reordering a chain or device must publish a new compiled
schedule via `ArcSwap` so the audio thread switches with no dropout.

Verify with: `pnpm cargo:test -- -p daw-engine rack::arc_swap_topology`

### AC-004 — Eight macro knobs map to multiple parameters

Each rack must expose 8 macro knobs, each mappable to many device parameters
with independent ranges, so one knob drives several targets.

Verify with: `pnpm test:run -- macroMapping`

### AC-005 — Modulation is additive and stored sparsely

The modulation matrix must sum all sources targeting a parameter onto its base
value (Bitwig-style additive) and store only non-zero connections.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::sparse_additive`

### AC-006 — Modulation evaluates at control rate and interpolates to audio rate

Modulation sources must evaluate once per control block and interpolate linearly
across the audio block to avoid zipper noise.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::control_rate_interp`

### AC-007 — A chain selector routes by zone

A chain selector must activate chains based on a key/velocity/macro zone value
so only in-zone chains process.

Verify with: `pnpm test:run -- chainSelector`

### AC-008 — A drum rack maps pads to chains

A drum rack must route incoming notes to per-pad chains, each an independent
device chain with its own output.

Verify with: `pnpm test:run -- drumRack`

### AC-009 — Modulation reaches CLAP and VST3 parameters

Modulation values must be delivered to hosted CLAP plugins via per-voice/note
modulation and to VST3 via parameter automation, per each format's model.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::plugin_delivery`

### AC-010 — Macro and modulation edits are live with no audio stall

Turning a macro or editing a modulation amount must take effect within the next
control block without rebuilding the whole schedule.

Verify with: `manual` — map a macro to filter cutoff, sweep it during playback, confirm a smooth click-free sweep

### AC-011 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-012 — Slots carry a control-rate vs audio-rate flag

Each modulation slot must carry an `AUDIO_RATE` flag; flagged slots evaluate
per-sample (for FM-style modulation where the source LFO exceeds ~500 Hz or an
oscillator acts as an FM carrier) and skip the control-rate interpolation, while
unflagged slots evaluate once per control tick — required.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::audio_rate_slot`

### AC-013 — Drum rack uses a 4x4 pad model with choke groups

A drum rack must bind each chain to a `DrumPadBinding { pad_index 0..16,
midi_note, choke_group 0..=16 }` (default C1/36 ascending, `key_range` forced to
`(note, note)`) — required.

Verify with: `pnpm test:run -- drumRackChoke`

### AC-014 — Format-aware modulation delivery contract

Modulation must be delivered format-aware: CLAP targets receive a
`CLAP_EVENT_PARAM_MOD` whose `amount` is the accumulated offset with
`note_id/channel/key = -1`, the base `param_value` sent only on a user UI move so
base and modulation stay separable; VST3 targets receive a clamped absolute
`final = clamp(base + offset, 0.0, 1.0)` via `IParamValueQueue::addPoint` with the
rack tracking base separately — required.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::format_delivery_contract`

### AC-015 — Compiler flattens via Kahn's sort with Split/Mix and cycle rejection

The compiler must flatten the rack tree using Kahn's-algorithm topological sort,
inserting one Split plus N chain paths plus one Mix node per rack, with
deterministic tie-breaking (chain index then slot index) and graph-coloring buffer
allocation — required.

Verify with: `pnpm cargo:test -- -p daw-engine rack::kahn_split_mix_cycle`

### AC-016 — Serialization carries a version tag with registered migrations

Rack serialization must be JSON `{ schema_version: u16, rack }` with opaque
base64 plugin-state blobs and a CRDT/Automerge-compatible tree shape (child
arrays, opaque string IDs, no numeric-keyed maps) — required.

Verify with: `pnpm cargo:test -- -p daw-engine rack::serialization_migration`

### AC-017 — Granular RT command path complements the schedule swap

Granular edits (`SetParameter`, `SetMacro`, `AddModRoute`, `RemoveModRoute`) must
flow through an SPSC ring buffer drained at the top of the process callback, single
hot scalars must cross via `AtomicF32`, and old schedules must be reclaimed via
`basedrop` deferred to a non-RT thread — required.

Verify with: `pnpm cargo:test -- -p daw-engine rack::rt_command_path`

### AC-018 — Chain selector handles stuck notes, broadcast, and inverted ranges

The chain selector must always deliver a note-off to whichever chain received the
matching note-on regardless of the chain's current range (stuck-note prevention),
broadcast non-note MIDI (CC, pitch bend, aftertouch) to all chains, treat ranges
as inclusive on both ends, and treat a chain whose `key_range.0 > key_range.1` as
off — required.

Verify with: `pnpm test:run -- chainSelectorRouting`

### AC-019 — Modulation source catalogue and matrix sizing

The modulation matrix must support the five v1 sources (`Macro`, `LFO`,
`EnvelopeFollower`, `SidechainAudioFollower`, `ExternalMidiCC`), provide 256
pre-allocated slots per rack with bipolar depth in `[-1, 1]`, and pre-allocate its
`source_values`/`base_values`/`dest_accumulators`/`final_values`/`current_values`
arrays so a control-rate tick performs no allocation — required.

Verify with: `pnpm cargo:test -- -p daw-engine modulation::source_catalogue_sizing`

### AC-020 — Macro mapping map-mode UX

Map mode must be enterable via `Ctrl/Cmd+M` and exitable via `Esc`/Done, expose a
right-click "Map to Macro M1..M8" alternate flow, render a colored arc ring per
mapping keyed to the macro index, and provide a Mapping Inspector listing every
`(macro, target, min, max, curve)` row with inline edit and delete — required.

Verify with: `pnpm test:run -- macroMapMode`

### AC-021 — Configurable rack nesting depth limit

Racks must be nestable within chains up to a configurable depth limit (default 8);
exceeding the limit must be rejected rather than nested without bound — required.

Verify with: `pnpm test:run -- rackNestingDepthLimit`

### AC-022 — Choke groups silence other sounding pads in the group

Firing a pad in a non-zero choke group must immediately note-off every other
currently sounding pad in that group, and a pad chokes itself
(monophonic-per-pad) — required.

Verify with: `pnpm test:run -- drumRackChoke`

### AC-023 — A cyclic rack tree is rejected at compile time

A tree that would require a cycle must be rejected with a `ScheduleError::Cycle`
error rather than compiled — required.

Verify with: `pnpm cargo:test -- -p daw-engine rack::kahn_split_mix_cycle`

### AC-024 — A reader migrates older versions and rejects newer ones

A serialization reader must run registered `V_n -> V_{n+1}` migration steps for
older versions and return an `UnsupportedVersion` error when
`version > CURRENT` — required.

Verify with: `pnpm cargo:test -- -p daw-engine rack::serialization_migration`

### AC-025 — A MidiFx rack routes input to the first matching chain

A `MidiFx` rack must route an input MIDI event to the **first** chain (lowest
index) whose key/velocity ranges contain the event — first-match, not parallel
summing — and its output is the processed MIDI from that one chain. (`AudioFx`,
`Instrument`, and `Drum` racks sum outputs per AC-002; `MidiFx` is the exception.)

Verify with: `pnpm cargo:test -- -p daw-engine rack::midifx_first_match_routing`

### AC-026 — Macro mapping applies a named curve and supports inverted ranges

A `MacroMapping.curve` must be one of `Linear`, `ExpPow2`, `LogInverseExpPow2`,
or `SCurve`, and the driven target value must be computed as
`target = min + (max - min) * curve(m)` where `m` is the macro value in `[0, 1]`
and `min`/`max` are in the target's normalized `[0, 1]` space. A mapping with
`min > max` must produce an inverted mapping with no separate inversion flag.

Verify with: `pnpm test:run -- macroMappingCurve`

### AC-027 — Choke silences the prior voice within one sample of the new trigger

When a pad in a non-zero choke group is re-triggered (or another pad in the same
group fires), the previously sounding voice must be silenced **within 1 sample**
of the new trigger, delivered as an internally routed MIDI note-off scheduled at
the triggering note-on's sample offset plus one.

Verify with: `pnpm test:run -- drumRackChoke`

### AC-028 — Control-rate parameters interpolate with a per-sample delta over the tick window

For each control-rate destination, the smoother must advance by
`per_sample_delta[dest] = (final[dest] - current[dest]) / 32` each audio sample,
reaching `final` at the end of the 32-sample tick window. Zipper-noise spectral
peaks at `Fs / 32` Hz and its harmonics must stay below **-80 dBFS** for a rapid
macro sweep. (Audio-rate slots per AC-012 skip this and write the raw value.)

Verify with: `pnpm cargo:test -- -p daw-engine modulation::control_rate_interp`

## Open questions

- [ ] (blocking) Stale macro mappings: a macro maps to a parameter that is
  subsequently removed (device deleted, plugin uninstalled, or nested rack
  collapsed). What is the defined behavior? Option A — keep the mapping as
  "stale," greyed out in the inspector, restorable if the target reappears at the
  same `ParameterRef`. Option B — auto-delete the mapping on first load where the
  target is missing. Option C — keep the mapping and silently skip it at runtime
  until a target of a matching path appears. This blocks AC-001 / AC-016
  serialization because the on-disk contract depends on the answer.
- [ ] (blocking) CLAP vs VST3 modulation parity: CLAP supports polyphonic
  per-note modulation, VST3 does not. Do macros degrade to monophonic parameter
  automation on VST3, and is that surfaced to the user?
- [ ] (non-blocking) Macro curve shaping (linear vs exponential vs custom) per
  mapping in v1 or later?
- [ ] (non-blocking) Maximum modulation-matrix connection count before the
  sparse representation needs a different structure?
- [ ] (blocking) (restored detail) Modulation conflict resolution when two
  sources target the same parameter. AC-005 hard-codes additive summation
  (Bitwig model), but the slot-priority convention is not universal. Option A —
  always additive (current default). Option B — per-connection
  `conflict_policy: Additive | LatestWins | Max | Min` (adds slot flag space).
  Option C — per-target policy set on the parameter itself, not per connection.
  Blocks the AC-005 matrix evaluator (R7); decide before writing it.
- [ ] (non-blocking) (restored detail) Audio-rate modulation of pitched
  parameters (frequency, detune) needs a defined depth unit. AC-012 uses
  normalized `[0, 1]` depth on the target's normalized range, which gives
  non-musical results for frequency — should depth be Hz, semitones, or
  normalized? A per-parameter-type depth unit may be needed; defer to v2 unless
  users report unusable behavior.
- [ ] (non-blocking) (restored detail) Macro scope: does v1 support per-project
  or global macros (the future-spec mentions global macros), or rack-scoped only?
  Current scope is rack-scoped only.
- [ ] (non-blocking) (restored detail) Is the nesting depth limit of 8 (AC-021)
  sufficient? Reason caps at 1, Ableton caps by UX fatigue, Bitwig caps at ~32.
  8 seems safe but warrants confirmation.
- [ ] (non-blocking) (restored detail) Should the colored-ring macro color scheme
  (AC-020) be user-configurable, or a fixed 8-color palette keyed to M1..M8?
  v1 assumes a fixed palette.

## Affected areas

- `src/modules/DeviceRack/` (rack model, chains, macros, modulation UI)
- `crates/daw-engine/` (`rack` flatten/compile, `ArcSwap` swap, `modulation`)
- `src/modules/PluginHost/` (CLAP/VST3 modulation delivery)

## Dropped from sources

- FL Studio's Patcher-style free-routing canvas — racks are tree-structured, not
  free-graph (that is the Bakery's domain; see `../bakery/spec.md`).
- Reason-style rear-panel cable view — modulation is a matrix UI, not virtual
  cables, in v1.
- Per-modulation-source LFO/envelope editor depth beyond a basic set — a follow-up.

### Tradeoffs and risks carried from source (not requirements)

These risk notes with concrete mitigations were in the original source's
"Tradeoffs and risks" section. They are recorded here as design context, not as
verifiable requirements:

- **ArcSwap edit-race**: if two edits land in quick succession and both spawn
  compile jobs, the later-completing job may store a stale schedule. Mitigation:
  compile jobs carry a monotonic edit sequence number; `ArcSwap::store` only
  succeeds if the incoming sequence number is newer than the currently-stored one
  (via a `compare_and_swap` loop).
- **VST3 base-value race**: when the user moves a plugin knob while modulation is
  active, the rack and plugin may disagree on `base`. The rack is designated the
  single authority on final values; plugin UI moves must round-trip through the
  rack's base tracker. Acknowledged limitation, logged as a known quirk rather
  than a blocker.
- **Memory pressure from 256 slots x N racks**: each rack preallocates 256 slots
  plus source/dest arrays. At 64 racks in a large project that is still < 2 MB —
  acceptable.
- **Off-thread compile latency**: for very large racks (hundreds of devices),
  compilation may exceed 10 ms. It does not block audio (runs off-thread) but may
  produce a user-perceived delay before an edit takes effect; incremental
  compilation is a possible follow-up.
