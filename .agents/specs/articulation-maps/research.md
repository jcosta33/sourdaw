---
type: research
id: RESEARCH-articulation-maps
title: Articulation maps and orchestral intelligence
status: open
owner: The Sourdaw team
sources:
  - VI-Control, Steinberg Forums, Reddit, KVR composer reports
  - Logic Pro Articulation Sets, Cubase Expression Maps, Reaticulate, Art Conductor, ArtiQverse
---

# Research: Articulation maps and orchestral intelligence

## Question

How should a Tauri v2 DAW with a Rust real-time engine and CRDT state implement
articulation maps so it avoids the setup-time, chase, VEPro, and visual-scale
failures that recur across every commercial DAW?

## Findings

### R-001 — Note-attached metadata is the most reliable ownership model

- **Claim:** Storing the articulation as metadata on each MIDI note (Logic's
  model) keeps assignments correct through quantization and editing and allows
  different notes in a chord to carry different articulations.
- **Evidence:** Logic supports up to 256 articulation IDs as note metadata;
  VI-Control consensus cites this as Logic's one clear win. Cubase's
  timeline-event model is the source of its region-split and chase bugs.
- **Confidence:** high
- **Bears on:** the data model (AC-002), region-split integrity.

### R-002 — Program-change-style chase eliminates a decade of Cubase chase bugs

- **Claim:** Projecting articulations as program changes (Reaticulate's model)
  gives native, bug-free chase, versus Cubase's "revert to first slot" failure.
- **Evidence:** Reaticulate chases cleanly because REAPER natively chases
  program changes; Cubase users insert a dummy slot 1 as a known workaround.
- **Confidence:** high
- **Bears on:** chase architecture and the default-articulation rule (AC-009).

### R-003 — A hybrid O(log n) chase is required for the real-time thread

- **Claim:** Bar-boundary snapshots plus per-parameter binary-search indexes
  give O(log n) chase at any position; a linear scan from track start is
  unacceptable on the audio thread.
- **Evidence:** Snapshot size is ~2–4 KB each (128 CC × 16 channels), ~800 KB
  for a 200-bar piece — negligible; rebuild is a single O(n) background pass.
- **Confidence:** high
- **Bears on:** chase performance (AC-008).

### R-004 — `ArcSwap` is the lock-free map-sharing primitive

- **Claim:** The UI builds a new `Arc<ArticulationMap>` per edit and stores it
  atomically; the audio thread loads once per buffer with zero allocation.
- **Evidence:** `arc_swap::ArcSwap` / its `Cache` variant make repeated reads
  nearly free; old snapshots free on a non-audio thread.
- **Confidence:** high
- **Bears on:** lock-free access (AC-006).

### R-005 — Intra-buffer priority order is load-bearing

- **Claim:** At a shared sample offset, events must sort KS Off → KS On → CC →
  Note On so the keyswitch takes effect before the note renders, at zero added
  latency.
- **Evidence:** Plugins process events sequentially within a buffer; a priority
  value as secondary sort key enforces the order.
- **Confidence:** high
- **Bears on:** the preprocessor (AC-007), overlap resolution.

### R-006 — Three UX features would differentiate the product

- **Claim:** Inline articulation labels on note bars (no DAW does this),
  per-articulation timing compensation (only Cubase 15, Nov 2025), and automated
  map creation via plugin introspection are the highest-value gaps.
- **Evidence:** Articulation Lane becomes unreadable at 30+ articulations;
  attack latency ranges from ~−20 ms (spiccato) to ~−80 ms (legato).
- **Confidence:** medium
- **Bears on:** inline labels (AC-004), timing compensation (AC-005).

### R-007 — VEPro reorders events; CC switching breaks Attributes

- **Claim:** Vienna Ensemble Pro reorders CC and Note events so CC-based
  switches arrive after their Note-On; a 1-tick note delay or Note-On
  keyswitches restore ordering.
- **Evidence:** The single most-reported real-world articulation bug across
  large-template users.
- **Confidence:** high
- **Bears on:** VEPro compensation and the VST3-vs-CLAP dispatch note.

## Open questions

- [ ] Q-001 — Channel-routing chase: is releasing the previous channel's
  keyswitch (KS Off) required in addition to `All Notes Off`, or is ANO alone
  sufficient? Plugins differ on a stray KS Off on an unselected channel.
- [ ] Q-002 — Overlapping articulation resolution: validate "lower
  exclusion-group index wins, later note wins within a group" against user
  expectation before freezing the engine implementation.
- [ ] Q-003 — Scrub ANO/ASO policy: unconditional per scrub, only on detected
  hung notes, or a user-facing preference?

## Recommendation

Adopt the separation R-001 + R-002 establish: articulations are note metadata
(the semantic layer the user edits) but are projected as program-change /
keyswitch events at playback (the MIDI layer the instrument receives). Pair this
with R-003's snapshot-plus-binary-search chase and R-004's `ArcSwap` sharing for
a real-time-safe engine, and prioritize the three R-006 UX differentiators.
Resolve Q-001–Q-003 in the spec before the engine's emit path is written.

---

## Restored source material (co-located full survey)

> This research note is the co-located home for `.agents/specs/articulation-maps/`.
> The sections below are restored verbatim from the original full survey
> (`research/factory/active/articulation-maps.md`, git `bb84b0e`) so the spec's
> distilled findings retain their underlying evidence. Wording is preserved as
> written; only this heading is editorial.

### Quantitative competitor framing (Sections 1-2, restored)

#### 1. How Logic and Cubase actually work—and where they fail

##### Logic Pro's Articulation Set Editor

Logic's system is **note-centric**: every MIDI note carries an Articulation ID as metadata (up to **256 IDs**). The editor is a standalone window with three tabs—Articulations (names, IDs, score symbols), Switches (MIDI input triggers for live performance), and Output (MIDI messages sent to the instrument). Output types include Note On (keyswitches), CC, Program Change, Channel, Velocity, Pitch Bend, and Aftertouch.

The critical limitation is Logic's **maximum of 3 output assignments per articulation**. Modern libraries like VSL Synchron Elite Strings require up to 6 simultaneous MIDI messages per articulation, making Logic's system unusable without the Scripter MIDI FX plugin as a workaround. Logic's piano roll shows articulations only through **color-coding** (View → Set Note Color → By Articulation) and a dropdown menu—there is no dedicated articulation lane. Users on VI-Control consistently cite this as Logic's biggest orchestral workflow gap.

Strengths worth borrowing: articulation-as-note-metadata means assignments move with notes during quantization and editing. Different notes in the same chord can carry different articulations. The mental model is simple and intuitive.

##### Cubase Expression Maps

Cubase's system is the most feature-complete reference implementation. The Expression Map Setup window has four sections: a map list, Sound Slots (articulation configurations), Articulations (vocabulary definitions), and Output Mappings. Each Sound Slot can reference up to **4 simultaneous articulation groups** and supports **unlimited output events**—Note-On, CC, Program Change, with per-event channel assignment, velocity scaling, length modification, and transpose.

The defining design axis is **Direction vs. Attribute**. Direction articulations are latching—they persist from their insertion point until the next Direction change, displayed as colored horizontal bars in the Articulation Lane. Attribute articulations are per-note, tied to individual notes, and assigned via the Info Line dropdown. Cubase supports up to **4 mutual exclusion groups**, enabling orthogonal articulation dimensions (e.g., Group 1: bowing style, Group 2: mute status).

The Articulation Lane—a dedicated controller lane below the piano roll—is the gold standard for visual articulation feedback. All articulations appear as labeled rows; Direction articulations render as spanning colored blocks, Attributes as markers at note positions. However, this lane becomes **unwieldy with large maps** (30+ articulations require excessive vertical space), and the Expression Map editor itself has been nearly unchanged since 2009. Column widths are not resizable, the output mapping window is absurdly small, and copy-paste between maps was missing for over a decade.

##### What the common output triggers are

| Output type                      | Use case                                                | Support                                             |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| **Note On (keyswitch)**          | Most sample libraries                                   | Universal                                           |
| **CC (Controller Change)**       | UACC (CC#32), Spitfire, generic CC-switched instruments | Logic, Cubase, S1, Reaticulate                      |
| **Program Change**               | Legacy MIDI, some modern libraries                      | All major DAWs                                      |
| **MIDI Channel routing**         | Different channels = different articulations            | Cubase, S1, Reaticulate; Logic requires Scripter    |
| **Multi-output combos**          | KS + CC + Channel simultaneously                        | Cubase (unlimited), Reaticulate (16), Logic (max 3) |
| **Velocity/Length modification** | Accents, staccato shortening                            | Cubase only                                         |

#### 2. The pain points orchestral composers actually have

Research across VI-Control, the Steinberg Forums, Reddit, and KVR reveals **15 recurring frustrations** that should directly inform the design. The top five are architectural, not cosmetic.

**Setup time is the #1 complaint.** Creating expression maps is described as "brutally tedious"—one VI-Control user reported spending "hundreds of hours" building maps and regretting it. Even Cubase 15's late-2025 editor redesign drew the response "editing sound slots is still messy." The root cause is that editors lack copy-paste, batch operations, drag-and-drop reordering, and auto-detection of instrument capabilities. Third-party tools (ArtiQverse's iQLense Pro, Babylonwaves Art Conductor, community Excel macros) exist solely because DAW-native editors are hostile.

**Chase/playback bugs have persisted for over a decade in Cubase.** When starting playback mid-song, Cubase frequently reverts to the first Sound Slot instead of chasing the correct articulation. Users insert an empty dummy slot at position 1 as a universal workaround—this trick has been shared hundreds of times on forums. The Direction/Attribute interaction compounds this: Direction articulations don't survive cycle jumps reliably, and mixing both types in one map produces unpredictable behavior.

**VEPro compatibility breaks Attribute-type articulations.** Vienna Ensemble Pro reorders CC and Note events in transit, causing CC-based articulation switches to arrive _after_ the Note-On they were supposed to precede. This forces users to abandon Attributes entirely and use only Direction articulations when hosting through VEPro—a major constraint given VEPro's near-universal adoption in large orchestral templates.

**Visual feedback collapses at scale.** The Articulation Lane in Cubase becomes unreadable with large maps (Audiobro MSS, complex Kontakt multis). No major DAW displays articulation names directly on piano roll note bars. Logic offers only color-coding with no lane at all.

**Per-articulation timing compensation was missing until Cubase 15** (November 2025) and remains absent in Logic Pro and Studio One. Different articulations have wildly different sample attack latencies—a legato patch might need **-80ms** offset while a spiccato needs **-20ms**. Without per-articulation negative delay, composers are forced to use separate tracks per articulation group, exponentially increasing template complexity.

Other significant pain points include: Logic's 3-output limit, limited articulation groups (4 max in Cubase/Reaticulate), no batch import/export, no folder organization for large map libraries, stuck notes from channel-routing bugs, and zero cross-DAW portability between proprietary formats (.expressionmap, .plist, .keyswitch, .reabank).

### Competitor lessons (Section 3, restored)

#### 3. Lessons from Reaticulate, Art Conductor, and ArtiQverse

##### Reaticulate's architectural insight

Reaticulate (free, open-source for REAPER) makes one brilliant architectural choice: it **maps articulations to MIDI Program Changes**, which REAPER natively chases. This eliminates the entire class of chase bugs that plague Cubase. Articulation names appear as labeled program change markers in the piano roll—clean, visible, and functional.

The dockable side panel shows available articulations per track with custom icons, colors, and labels. Each articulation can trigger up to **16 simultaneous output events** (CC, Note On/Off, Note Held for momentary keyswitches, Program Change, Channel routing). It supports **4 articulation groups** for orthogonal dimensions. The main UX weakness is that bank definitions require hand-editing text-based `.reabank` files—there is no GUI editor for creating custom banks, which is the #1 barrier to adoption.

##### Art Conductor's universal mapping

Art Conductor (Babylonwaves, ~€90) sells **14,000+ pre-built articulation presets** across 1,000+ libraries for 6+ DAWs. Its most praised feature is a **standardized universal keyswitch layout**: Spiccato is always on E, Pizzicato always on F#, regardless of library vendor. This enables portable muscle memory and allows MIDI regions to transfer between different library tracks with articulations intact. The standardized naming, color scheme, and alphabetical sorting reduce cognitive load significantly.

##### ArtiQverse's cross-DAW conversion

ArtiQverse (by SymphoniQ) is a universal articulation map editor that exports to any DAW format. Its standout feature, **iQLense Pro**, uses OCR to capture articulation names from plugin GUIs and auto-builds maps—addressing the setup time problem directly. The community repository (iQSpace) with 2,000+ shared maps tackles the cold-start problem.

##### Design patterns to adopt

- **Program-change-based articulation control** for native chase support (Reaticulate)
- **Universal keyswitch layout** with standardized naming as a default (Art Conductor)
- **Automated map creation** via plugin introspection or OCR (ArtiQverse, Studio One's dynamic API)
- **Built-in community sharing repository** (iQSpace model)
- **GUI editor for all configuration**—never require text file editing (Reaticulate's lesson)

### Editor UX design (Section 4, restored)

#### 4. UX configuration view design for the articulation map editor

The editor should use a **two-panel split layout** rather than the three-tab confusion of Logic or the cramped single-window of Cubase. The left panel is the Articulation List (a reorderable table of all articulations with inline editing). The right panel is the Output Configuration for the selected articulation.

##### Articulation list (left panel)

A table with drag-and-drop reordering, multi-select, and inline editing. Columns: **Color swatch** (click to pick), **Name** (editable text), **Short Name** (2-4 chars for piano roll display), **Type** (Direction/Attribute toggle), **Group** (dropdown for exclusion group assignment), **Outputs** (summary badges showing "KS C0 + CC#32:56"). A toolbar above the list provides: Add, Duplicate, Delete, Import from Library, Auto-Detect from Plugin. Below the list: Exclusion Group management (name, default articulation per group).

##### Output configuration (right panel)

For the selected articulation, a vertical stack of Output Event cards. Each card shows the event type (Keyswitch, CC, Program Change, Channel Route) with appropriate fields. A "+" button adds more output events—**no arbitrary limit** on the number of outputs. Each card also shows: **Target Channel** (track default or override), **Pre-send offset** (ms, for per-articulation timing compensation). A "Test" button sends the output events to the instrument so the user can audibly verify.

##### Key UX requirements

Batch operations are essential: select multiple articulations and change their group, type, or channel simultaneously. Copy-paste between maps. Search/filter for articulations by name. Folder organization for the map library. Import/export as JSON (human-readable, diffable, CRDT-friendly). A "Learn" button that listens for incoming MIDI to auto-populate keyswitch notes and CC values.

### Piano-roll editing workflows (Section 5, restored)

#### 5. Piano roll integration: how articulations appear and are edited

The piano roll should combine the best of all existing paradigms: **note-attached metadata** (Logic's model) for editing reliability, **a compact articulation lane** (Cubase's model) for visual overview, and **inline note labels** (no DAW does this yet) for at-a-glance identification.

##### Primary display: inline note labels with color coding

Each note bar in the piano roll displays a **short text label** (the articulation's `shortName`: "Leg", "Stacc", "Spic", "Pizz") directly on the note, plus a **color fill** matching the articulation's assigned color. This is the missing feature every DAW lacks—no current DAW renders articulation names on note bars. Notes are wide enough at typical zoom levels to display 3-4 character abbreviations.

##### Secondary display: compact articulation lane

Below the piano roll, an optional **articulation lane** shows the articulation flow as a timeline. Direction articulations render as labeled colored blocks spanning their duration. Attribute articulations appear as small markers aligned to their notes. Unlike Cubase's implementation (which shows ALL articulations as rows, becoming unwieldy), this lane should use a **single-row** design that shows only the currently active articulation at each point in time, with the articulation name and color inside the block. Clicking on a block opens a dropdown to change the articulation. Groups are shown as stacked single rows (one row per active group).

##### Editing workflow

Assign articulations by: (1) selecting notes and choosing from a right-click context menu grouped by exclusion group, (2) using a keyboard shortcut palette (assignable shortcuts per articulation), (3) clicking in the articulation lane with the pencil tool, (4) using a dockable articulation palette panel (Reaticulate-style) with click-to-assign buttons. Support "paint mode" where clicking on an articulation in the palette and then clicking/dragging notes applies that articulation to all touched notes.

### Data model: per-articulation transforms and CRDT integration (Section 6, restored)

#### 6. Schema and data model

##### TypeScript types (React frontend)

```typescript
type ArticulationId = string; // UUID v7 for CRDT ordering
type ExclusionGroupId = string;
type ArticulationMapId = string;

type OutputEventType =
    | { kind: 'keyswitch'; note: number; velocity: number }
    | { kind: 'cc'; controller: number; value: number }
    | { kind: 'program_change'; program: number; bank?: number }
    | { kind: 'channel_pressure'; value: number };

interface OutputEvent {
    type: OutputEventType;
    channel: number | null; // null = use track default
}

type ArticulationBehavior = 'direction' | 'attribute';

interface KeyswitchMode {
    kind: 'latching' | 'momentary';
}

interface Articulation {
    id: ArticulationId;
    name: string;
    shortName: string; // 2-4 chars for piano roll labels
    color: string; // hex "#FF5733"
    iconId?: string;

    behavior: ArticulationBehavior;
    exclusionGroupId: ExclusionGroupId | null;
    keyswitchMode: KeyswitchMode;

    outputEvents: OutputEvent[];

    // Per-articulation timing compensation
    preSendOffsetMs: number; // ms before note (typically 0-100)

    // Optional note transformations
    velocityScale?: number; // 1.0 = no change
    lengthScale?: number; // 1.0 = no change
    transposeOctaves?: number;
}

interface ExclusionGroup {
    id: ExclusionGroupId;
    name: string;
    defaultArticulationId: ArticulationId | null;
}

interface ArticulationMap {
    id: ArticulationMapId;
    name: string;
    version: number;
    description?: string;

    articulations: Articulation[];
    exclusionGroups: ExclusionGroup[];

    defaultDirectionId: ArticulationId | null;
    globalPreSendOffsetMs: number; // fallback if per-articulation not set
}

// Per-note assignment (stored on MIDI note objects)
interface NoteArticulation {
    // One direction per exclusion group
    directionIds: Record<ExclusionGroupId, ArticulationId>;
    // Attributes are per-note, independent
    attributeIds: ArticulationId[];
}
```

##### Rust structs (real-time engine)

```rust
use std::sync::Arc;
use serde::{Serialize, Deserialize};

pub type ArticulationIdx = u16; // index into ArticulationMap.articulations

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum OutputAction {
    Keyswitch { note: u8, velocity: u8, channel: u8 },
    ControlChange { cc: u8, value: u8, channel: u8 },
    ProgramChange { program: u8, bank: Option<u16>, channel: u8 },
    ChannelPressure { value: u8, channel: u8 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArticulationBehavior {
    Direction,
    Attribute,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyswitchMode {
    Latching,   // note-on switches; note-off irrelevant
    Momentary,  // note must be held for duration of articulation
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Articulation {
    pub name: Arc<str>,
    pub short_name: Arc<str>,
    pub color_rgba: u32,
    pub behavior: ArticulationBehavior,
    pub keyswitch_mode: KeyswitchMode,
    /// Index into exclusion_groups; u16::MAX = none
    pub exclusion_group_idx: u16,
    /// Output MIDI events to generate (max ~8 in practice)
    pub output_actions: smallvec::SmallVec<[OutputAction; 4]>,
    pub pre_send_samples: u32,     // converted from ms at load time
    pub velocity_scale: f32,       // 1.0 = unchanged
    pub length_scale: f32,         // 1.0 = unchanged
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExclusionGroup {
    pub name: Arc<str>,
    pub default_articulation_idx: Option<ArticulationIdx>,
}

/// Immutable snapshot shared with audio thread via ArcSwap
#[derive(Clone, Debug)]
pub struct ArticulationMap {
    pub name: Arc<str>,
    pub articulations: Vec<Articulation>,
    pub exclusion_groups: Vec<ExclusionGroup>,
    pub default_direction_idx: Option<ArticulationIdx>,
}

/// Per-note articulation metadata (stored inline with note data)
#[derive(Clone, Copy, Debug, Default)]
pub struct NoteArticulationState {
    /// Active direction per group (up to 8 groups; u16::MAX = none)
    pub direction_per_group: [ArticulationIdx; 8],
    /// Bitmask of active attribute articulations
    pub attribute_mask: u64,
}
```

##### CRDT integration

The articulation map lives in the CRDT document as a `Y.Map` (Yjs) or equivalent. Each `Articulation` is a nested map keyed by its UUID. Concurrent edits to different articulations merge trivially. Same-field conflicts use **Last-Writer-Wins** semantics. The OR-Set provides add/remove convergence for the articulation collection. On every CRDT update, the frontend serializes to Rust structs, wraps in `Arc<ArticulationMap>`, and stores via `arc_swap::ArcSwap` for lock-free audio thread access.

### VST3-vs-CLAP dispatch and lock-free access (Section 7, restored)

#### 7. Rust architectural blueprint for MIDI interception and hidden event generation

##### Processing pipeline

The audio engine processes MIDI in a block-based pipeline. Articulation interception occurs in a dedicated **pre-processing stage** between event collection and plugin dispatch:

```
Transport → Event Collector → [Articulation Preprocessor] → Event Dispatcher → Plugin.process()
```

The Event Collector scans the timeline for all MIDI events within the current audio buffer window (e.g., 256 samples). The Articulation Preprocessor inspects each note's `NoteArticulationState`, looks up the active `ArticulationMap` (read from `ArcSwap` once per buffer), and generates hidden keyswitch/CC events. The Event Dispatcher converts the final event list to VST3 `IEventList` or CLAP `clap_input_events_t` format.

##### Event insertion algorithm

```rust
fn preprocess_articulations(
    events: &mut EventBuffer,        // pre-allocated, sorted by timing
    state: &mut TrackArticulationState,
    map: &ArticulationMap,
    buffer_size: u32,
) {
    // 1. Emit any pending events deferred from the previous buffer
    for pending in state.pending_events.drain(..) {
        events.insert_sorted(pending);
    }

    // 2. Process each note-on in chronological order
    let note_indices: SmallVec<[usize; 64]> = events.note_on_indices();
    for &idx in &note_indices {
        let note = &events[idx];
        let art_idx = note.articulation_idx();

        // Skip if articulation matches current state (suppress redundant KS)
        if state.current_direction_idx == art_idx {
            continue;
        }

        if let Some(articulation) = map.articulations.get(art_idx as usize) {
            let ks_timing = note.timing.saturating_sub(articulation.pre_send_samples);

            for action in &articulation.output_actions {
                let event = match action {
                    OutputAction::Keyswitch { note, velocity, channel } => {
                        // Release previous keyswitch if latching
                        if let Some(prev) = state.active_keyswitch.take() {
                            let off = ProcessEvent::note_off(ks_timing, prev.channel, prev.note);
                            emit_or_defer(events, &mut state.pending_events, off, buffer_size);
                        }
                        state.active_keyswitch = Some(ActiveKeyswitch { channel: *channel, note: *note });
                        ProcessEvent::note_on(ks_timing, *channel, *note, *velocity)
                    }
                    OutputAction::ControlChange { cc, value, channel } => {
                        ProcessEvent::cc(ks_timing, *channel, *cc, *value)
                    }
                    OutputAction::ProgramChange { program, bank, channel } => {
                        ProcessEvent::program_change(ks_timing, *channel, *program, *bank)
                    }
                    // ... other action types
                };
                emit_or_defer(events, &mut state.pending_events, event, buffer_size);
            }
            state.current_direction_idx = art_idx;
        }
    }
}

/// Insert into current buffer or defer to next buffer if timing exceeds bounds
fn emit_or_defer(events: &mut EventBuffer, pending: &mut Vec<ProcessEvent>, event: ProcessEvent, buffer_size: u32) {
    if event.timing < buffer_size {
        events.insert_sorted(event);
    } else {
        pending.push(event);
    }
}
```

##### Event ordering at the same sample offset

When keyswitch and note share the same sample offset, the sort order within the event list must be: (1) keyswitch note-off, (2) keyswitch note-on, (3) CC events, (4) actual note-on. This ordering is enforced by assigning each event type a **priority value** used as a secondary sort key. Plugins process events sequentially within a buffer—the keyswitch takes effect before the note renders audio, with **zero additional latency**.

##### VST3 vs. CLAP dispatch

For **VST3 plugins**, send keyswitches as `kNoteOnEvent` events in the `IEventList`. Avoid CC-based articulation switching in VST3—the protocol converts CCs to parameter changes, which can lose ordering relative to note events. For **CLAP plugins**, use the plugin's preferred note dialect (query via `note_ports`). CLAP's unified event queue preserves ordering across all event types, making CC-based keyswitching reliable. Always query `IKeyswitchController` (VST3) or equivalent to discover the plugin's keyswitch ranges programmatically.

##### Lock-free map access

The `ArticulationMap` is shared via `arc_swap::ArcSwap<ArticulationMap>`. The UI thread constructs a new `Arc<ArticulationMap>` on every edit and stores it atomically. The audio thread calls `map.load()` once per buffer callback—this returns a `Guard` with zero allocation overhead. The `ArcSwap::Cache` variant makes repeated reads nearly free when the map hasn't changed. Old snapshots are deallocated when the last reference drops, always on a non-audio thread.

### Chase: momentary vs latching distinction (Section 8, restored)

#### 8. Real-time state chasing without scanning the entire track

##### The hybrid chase architecture

A pure linear scan from the beginning of a track is O(n) and unacceptable for the real-time thread. The recommended approach combines **pre-computed snapshots** at bar boundaries with **per-parameter binary search indexes**, providing O(log n) chase at any playback position.

```rust
/// Pre-computed chase index, rebuilt on background thread when MIDI data changes
pub struct ChaseIndex {
    /// Full state snapshots at bar boundaries
    snapshots: BTreeMap<Tick, ChaseState>,
    /// Per-(channel, CC) sorted event list for binary search
    cc_index: HashMap<(u8, u8), Vec<(Tick, u8)>>,
    /// Sorted keyswitch events with on/off tracking
    keyswitch_index: Vec<(Tick, u8, u8, bool)>, // (tick, note, vel, is_on)
    /// Program changes per channel
    pc_index: HashMap<u8, Vec<(Tick, u8)>>,
    /// Articulation ID changes (from note metadata)
    articulation_index: Vec<(Tick, ArticulationIdx)>,
}

#[derive(Clone, Default)]
pub struct ChaseState {
    channels: [ChannelState; 16],
    active_articulation_idx: Option<ArticulationIdx>,
    active_keyswitch: Option<(u8, u8)>, // (note, velocity)
}

#[derive(Clone, Default)]
pub struct ChannelState {
    cc_values: [Option<u8>; 128],
    program: Option<u8>,
    pitch_bend: Option<i16>,
    channel_pressure: Option<u8>,
}

impl ChaseIndex {
    /// O(log S + E_interval) where S = snapshots, E_interval = events per bar
    pub fn chase_at(&self, tick: Tick) -> ChaseState {
        // Find nearest snapshot at or before tick
        let (snap_tick, mut state) = self.snapshots
            .range(..=tick)
            .next_back()
            .map(|(t, s)| (*t, s.clone()))
            .unwrap_or_default();

        // Apply only the events between snapshot and target tick
        self.apply_events_in_range(&mut state, snap_tick, tick);
        state
    }

    /// Rebuild in O(n) single pass — called on background thread
    pub fn rebuild(&mut self, events: &[MidiEvent], bar_ticks: &[Tick]) {
        // Single pass builds all indexes + snapshots simultaneously
        // Swap into audio thread via Arc<ChaseIndex> + ArcSwap
    }
}
```

Each snapshot stores **~2-4KB** (128 CC values × 16 channels + program/pitch/pressure state). For a 200-bar piece, that's **~800KB**—negligible. Snapshots are rebuilt on a background thread whenever MIDI data changes, then swapped atomically into the audio thread via `ArcSwap<ChaseIndex>`.

##### Chase for latching vs. momentary keyswitches

**Latching keyswitches** (the common case): chase requires finding only the last keyswitch Note-On before the playback position—the Note-Off is irrelevant. A binary search on the `keyswitch_index` gives O(log n) lookup.

**Momentary keyswitches**: chase must verify that the most recent keyswitch Note-On has **not** been followed by a corresponding Note-Off before the playback position. This requires tracking note-on/note-off pairs and checking whether the keyswitch is still "held" at the target tick.

##### Channel routing chase

When an articulation change also changes the MIDI channel, the chase must: (1) reconstruct the target channel, (2) re-send all relevant CC values (CC#1, CC#11, CC#64, etc.) on the new channel, and (3) ensure no hanging notes on the previous channel. Reaticulate explicitly handles this case and it is one of the trickier edge cases to get right.

##### Debouncing rapid scrubbing

During rapid transport scrubbing, avoid chasing on every playhead position. Use a **50-100ms debounce timer**: only execute chase after the playhead has been stationary for the debounce period. During scrubbing, optionally send an All Notes Off / All Sound Off (CC#120/123) to prevent hanging notes.

### Engine edge cases: overlapping notes, buffer boundaries, UACC (Section 9, restored)

#### 9. Edge cases and gotchas from existing implementations

**Overlapping notes with different articulations** are the most fundamental limitation of the keyswitch model. If a legato note overlaps with a staccato note, the staccato's keyswitch will change the articulation for _all_ sounding notes on that channel. The only true solutions are channel-per-articulation routing (send each articulation to a different MIDI channel within a multi-timbral instrument) or separate plugin instances. The engine should detect this conflict and either warn the user or automatically route to separate channels when the articulation map is configured for channel routing.

**Buffer boundary crossings** occur when a keyswitch's pre-send offset places it before the current buffer's start. The `pending_events` buffer (shown in the algorithm above) handles this: events that belong in a previous buffer are deferred and emitted at sample offset 0 of the next buffer. Alternatively, the engine can report latency equal to the maximum pre-send time, shifting the entire pipeline to guarantee keyswitches always fit before their notes. This adds latency but is the cleanest approach.

**VEPro event reordering** is the single most reported real-world bug. When hosting instruments through Vienna Ensemble Pro, CC events sent from the DAW arrive _after_ Note-On events at the plugin, causing Attribute-type articulations to always be "one note late." The workaround is to add a 1-tick delay to all notes when VEPro hosting is detected, or to use only Note-On keyswitches (which maintain ordering) rather than CC-based switching.

**Cubase's "revert to first slot" bug** occurs because the chase implementation falls back to the first Sound Slot when no prior articulation event is found. The fix is to define an explicit **default articulation** per exclusion group (typically "Long/Sustain") and always chase to that default rather than an arbitrary first slot.

**Region splitting must carry articulations.** When a MIDI region is split, both halves must inherit the active articulation state at the split point. Cubase fails here with Direction articulations. Since articulations are note metadata in our model (not timeline events), splitting a region simply preserves each note's attached articulation—no special handling needed. Direction articulations _do_ need a "chase on split" to insert the active direction state at the start of the new region.

**Large map scalability**: libraries like VSL Dimension Strings or Audiobro MSS can require **100-200+ articulations**. The UI must remain usable at this scale through search/filter, collapsible groups, and a compact articulation lane that shows only the active articulation per group rather than all possible articulations as rows. The audio engine's lookup must remain O(1)—the articulation index on each note is a direct array index into the map, not a search.

**UACC (Universal Articulation Controller Channel)** from Spitfire Audio uses CC#32 with standardized values (1=Long, 40=Staccato, 42=Spiccato, 56=Pizzicato, 80=Tremolo, etc.). This standard should be a first-class preset in the map editor, with one-click creation of UACC-compatible maps. UACC chases cleanly as a CC value.

**The MIDI 2.0 Orchestral Profile**, currently in development with consultation from five major sample library companies, will embed articulation information directly in the Note-On packet—potentially eliminating keyswitches entirely. The data model should include a `NoteExpression` output action type to support this future standard alongside traditional keyswitches.
