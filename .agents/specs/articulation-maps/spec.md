---
type: spec
id: SPEC-articulation-maps
title: Articulation maps with real-time chase
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Articulation maps with real-time chase

## Intent

Give orchestral composers an articulation mapping system that combines a
note-attached data model with program-change-style chase, real-time-safe MIDI
interception, and inline piano-roll feedback — eliminating the tedious setup,
chase bugs, and visual collapse that plague existing DAWs.

## Non-goals

- OCR capture of articulation names from plugin GUIs.
- Native MIDI 2.0 Orchestral Profile packet generation (data model only).
- A library manager for thousands of pre-built maps (Art Conductor scale).

## Requirements

### AC-001 — Unlimited output events per articulation

An articulation must persist and round-trip an arbitrary number of output
events (keyswitch, CC, program change, channel pressure, pitch bend, note
expression) through JSON export/import with no field loss.

Verify with: `pnpm test:run -- articulationMapRoundTrip`

### AC-002 — Direction and Attribute behaviors coexist in one map

A map must support both latching Direction articulations and per-note Attribute
articulations simultaneously.

Verify with: `pnpm test:run -- articulationBehavior`

### AC-003 — Up to eight mutual exclusion groups

An articulation map must support up to 8 exclusion groups for orthogonal
articulation dimensions.

Verify with: `pnpm test:run -- exclusionGroups`

### AC-004 — Inline short-name labels on piano-roll notes

Notes wider than 16 px must render a 2–4 character short name with the
articulation's color; notes 4–16 px render color fill only; notes under 4 px
render no label.

Verify with: `pnpm test:run -- PianoRollArticulationLabels`

### AC-005 — Per-articulation timing compensation

For a note at tick T with `preSendOffsetMs`, the generated keyswitch timestamp
must equal `T − samples_for(preSendOffsetMs)`, falling back to
`globalPreSendOffsetMs` when the per-articulation value is 0.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::pre_send_offset`

### AC-006 — Articulation maps are shared lock-free to the audio thread

The engine must read the active `ArticulationMap` via `arc_swap::ArcSwap` with
no allocation or locking on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::arc_swap_access`

### AC-007 — Hidden events are emitted in priority order

Hidden events generated at the same sample offset must be ordered KS Off → KS
On → CC → Note On.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::preprocess_priority`

### AC-008 — Chase is O(log n) at any playback position

`ChaseIndex::chase_at` for a 200-bar / 5,000-event project must complete in
≤ 1 ms p99 on the reference workstation.

Verify with: `pnpm cargo:bench -- -p daw-engine chase_at_mid_timeline`

### AC-009 — Chase falls back to an explicit default per group

When no prior state is found for a group, chase must resolve to that group's
`defaultArticulationId` (then the map-level `defaultDirectionId`, then no active
direction) rather than reverting to the first slot.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::default_chase`

### AC-010 — Scrubbing debounces chase to at most once per gesture

During a scrub gesture moving the playhead through many positions within one
second, the engine must execute chase at most once (after the playhead has been
stationary for the configurable debounce interval, range 50–100 ms, default
75 ms) and emit no articulation hidden events while scrubbing is in progress.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::scrub_debounce_single_chase`

### AC-011 — Channel-routing chase produces seek-invariant output

When an articulation change moves the output channel, the engine must produce a
byte-identical emitted event sequence whether the position was reached by
playback from tick 0 or by direct seek.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::channel_chase_equivalence`

### AC-012 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-013 — VEPro event-reordering compensation

The engine must compensate for VEPro event reordering by providing a 1-tick
note-delay toggle (every note-on on a VEPro-routed channel delayed by exactly
1 MIDI tick when enabled, 0 ticks when disabled) or by prioritizing Note-On
keyswitches over CC switches. This is required.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::vepro_compensation_toggle`

### AC-014 — Region splitting preserves articulation metadata

MIDI region splitting must preserve note-attached articulation metadata and
correctly insert the active Direction state at the split point so the new
region's first notes chase to the correct direction. This is required.

Verify with: `pnpm test:run -- regionSplitArticulationIntegrity`

### AC-015 — Overlapping-notes / keyswitch conflict resolution is deterministic

When two or more hidden events from different articulations would be emitted at
the same sample offset on the same channel, the engine must disambiguate
deterministically: (a) the intra-buffer priority sort (KS Off → KS On → CC →
Note On) is the first tiebreaker; (b) within the same priority, the articulation
in the exclusion group with the lower `exclusionGroupIdx` wins; (c) within the
same group, the later-starting note wins and any previously-latched keyswitch
for that group is released via an explicit KS Off before the new KS On at the
same offset; (d) Attribute articulations always emit their hidden events and
never mutate any group's persistent Direction state; (e) if a single note
carries two articulations from the same exclusion group, the engine must log a
structured warning and fall back to the group's `defaultArticulationId` rather
than silently pick one. This contract must hold exactly.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::overlap_cross_group`

### AC-016 — Momentary keyswitch is suppressed in chase when not held at the playhead

A momentary keyswitch whose held duration ends before the playhead position
must not appear in the engine's emitted event buffer when playback starts at
that position. This is required.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::chase_momentary_suppressed`

### AC-017 — Articulation-List toolbar and batch actions

The Articulation List must provide toolbar actions Add, Duplicate, Delete,
Import from Library, Auto-Detect from Plugin, and Learn (MIDI input capture),
plus batch operations to change group/type across the multi-selection and
copy-paste of articulations between maps. This is required.

Verify with: `pnpm test:run -- ArticulationListToolbar`

### AC-018 — Piano-roll articulation assignment methods

The piano roll must support assigning articulations via all four methods: a
right-click context menu grouped by exclusion group, a per-articulation
keyboard shortcut palette, pencil-tool editing in the articulation lane, and a
dockable click-to-assign palette with a "paint mode" that applies the selected
articulation to every note touched by a click/drag. This is required.

Verify with: `pnpm test:run -- PianoRollArticulationAssignment`

### AC-019 — Articulation Lane row and marker rendering

The Articulation Lane must render one row per exclusion group that has at least
one articulation event in the region; Direction articulations render as colored
spans whose start/end pixels match the event's sample tick ± 1 px; Attribute
articulations render as 8 px markers centered on their note start. This is
required.

Verify with: `pnpm test:run -- ArticulationLaneRendering`

### AC-020 — Per-articulation transform and mode fields round-trip

An articulation must persist and round-trip `velocityScale`, `lengthScale`,
`transposeOctaves`, `iconId`, and `keyswitchMode` (latching/momentary), through
JSON export/import with no field loss. This is required.

Verify with: `pnpm test:run -- articulationTransformFieldsRoundTrip`

### AC-021 — Intra-buffer priority indices and pre-send buffer deferral

Hidden events generated at the same sample offset must carry the explicit
priority index values KS Off = 0, KS On = 1, CC = 2, Note On = 3 as the
secondary sort key. This is required.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::pending_events_deferral`

### AC-022 — ArticulationMap version field round-trips

An `ArticulationMap` must persist its `version` field (used for CRDT ordering
and cache invalidation) through JSON export/import with no field loss. This is
required.

Verify with: `pnpm test:run -- articulationTransformFieldsRoundTrip`

### AC-023 — Pre-send keyswitches are deferred to the next buffer

Keyswitches whose pre-send offset places them before the current buffer's start
must be deferred via a `pending_events` buffer and emitted at sample offset 0 of
the next buffer. This is required.

Verify with: `pnpm cargo:test -- -p daw-engine articulation::pending_events_deferral`

### AC-024 — Per-output-card audible Test action

Each Output Event card in the editor's Output Configuration panel must provide a
Test action that sends that output event (or the articulation's full output-event
set) to the routed instrument so the user can audibly verify the configured
keyswitch/CC/program-change behavior without placing a note. This is required.

Verify with: `pnpm test:run -- ArticulationOutputTestAction`

## Open questions

- [ ] (non-blocking) Channel-routing chase: is a KS Off on the previous channel
  required in addition to `All Notes Off`, or is ANO sufficient? Plugins differ
  on a stray KS Off on an unselected channel.
- [ ] (non-blocking) Overlapping resolution: confirm "lower exclusion-group
  index wins, later note wins within a group" matches user expectation versus
  "earlier note wins".
- [ ] (non-blocking) Scrub ANO/ASO policy: emit unconditionally on every scrub,
  only on detected hung notes, or as a user preference.
- [ ] (non-blocking) (restored detail) Should we impose a maximum global
  pre-send latency limit to bound buffer-boundary deferral complexity (AC-023's
  `pending_events` path), or allow arbitrary `globalPreSendOffsetMs` /
  per-articulation `preSendOffsetMs` values? The unbounded alternative survives
  as research §9 prose; the limit-vs-unbounded decision is unresolved.

## Affected areas

- `src/modules/Articulation/` (editor UI, list toolbar, batch ops, models, CRDT
  data model)
- `src/modules/PianoRoll/` (inline labels, articulation lane, assignment methods)
- `src/modules/` MIDI region handling (split preserves note-attached metadata,
  inserts Direction state at the split point)
- `crates/daw-engine/` (preprocessor, `pending_events` deferral, `ChaseIndex`,
  `ArcSwap` map access, overlap/VEPro/channel-routing chase)

## Dropped from sources

- MIDI 2.0 Orchestral Profile packet generation — data model carries a
  `note_expression` output type, but packet emission is deferred.
- VST3 vs CLAP per-format keyswitch dialect tuning is captured as an
  implementation note in `research.md`, not as a separate requirement.
- Original Requirement 11 (VST3/CLAP Discipline — "avoid CC-based switching for
  VST3, use Parameter Changes or Note-On to maintain ordering; use unified event
  queues for CLAP") was deliberately demoted from a standalone requirement to a
  research/implementation note (restored in `research.md` Section 7). Reason: it
  prescribes a per-format dispatch mechanism rather than a verifiable external
  behavior, so it belongs as engineering guidance, not as an acceptance
  criterion. The ordering guarantee it protects is still verified through the
  intra-buffer priority contract (AC-007, AC-021).
- First-class UACC (CC#32) support and Art Conductor-style naming/colors were
  originally listed as in-scope deliverables; they now survive only as a UACC
  preset / naming convention in `research.md`. No AC requires a built-in UACC
  preset or Art Conductor colour mapping — the data model carries the generic
  `cc` output type and free-form `color`/`shortName` fields that make such
  presets expressible, but shipping the presets themselves is not specified.
- Standardized universal keyswitch layout defaults were originally an in-scope
  deliverable; they now survive only as guidance in `research.md`. No AC
  mandates a default keyswitch layout — articulation output events are
  user-configured per map.
