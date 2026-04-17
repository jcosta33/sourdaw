# Articulation Maps

## Context

Articulation maps are the single most requested—and often most poorly implemented—feature across commercial DAWs. This spec defines a system for a Tauri v2 DAW that leapfrogs existing implementations by combining Cubase's Direction/Attribute duality and unlimited output mappings with Reaticulate's program-change-based chase elegance. It addresses the 15 major recurring frustrations identified in orchestral composer research, including setup time, chase bugs, VEPro compatibility, and visual feedback collapse at scale.

Reference Research: `.agents/research/factory/active/articulation-maps.md`

---

## Goal

Provide a robust, CRDT-backed articulation mapping system with real-time-safe MIDI interception, O(log n) chase behavior, and an intuitive UI that eliminates "brutally tedious" setup through batch operations and inline piano roll labels.

---

## User-visible behavior

1. **Articulation Editor (Two-Panel Split Layout):**
    - **Articulation List (Left Panel):**
        - Table with drag-and-drop reordering, multi-select, and inline editing.
        - Columns: Color swatch, Name, Short Name (2-4 chars), Type (Direction/Attribute), Group (exclusion group dropdown), Outputs summary badges.
        - Toolbar: Add, Duplicate, Delete, Import from Library, Auto-Detect from Plugin, Learn (MIDI input capture).
        - Footer: Exclusion Group management (name, default articulation per group).
    - **Output Configuration (Right Panel):**
        - Vertical stack of limitless Output Event cards.
        - Supported Types: Note On (Keyswitch), CC (UACC), Program Change, Channel Route, Velocity/Length modification, Transpose, Pitch Bend, Aftertouch (Channel Pressure), Note Expression (MIDI 2.0 placeholder).
        - Fields: Event type, Target Channel (track default or override), Pre-send offset (ms), Test button (audible verification).
    - **General UX:** Batch operations for changing groups/types, copy-paste between maps, search/filter, folder organization, JSON import/export (compatible with community sharing models like iQSpace).

2. **Piano Roll Integration:**
    - **Inline Note Labels:** Every note bar renders a short text label (`shortName`) and color fill matching the articulation.
    - **Compact Articulation Lane:** Optional single-row timeline lane per exclusion group. Direction articulations render as labeled colored blocks spanning their duration; Attributes as markers. Active group rows stack vertically.
    - **Editing Workflow:**
        - Right-click context menu (grouped by exclusion group).
        - Keyboard shortcut palette (per-articulation shortcuts).
        - Pencil tool editing in the articulation lane.
        - Dockable palette with click-to-assign and "paint mode" (click/drag across notes).

---

## Scope

**In scope:**

- Articulation Map Editor UI (React).
- Piano roll visual integration (Inline labels + Articulation Lane).
- CRDT-backed data model (Yjs) and mapping to Rust engine state (`ArcSwap`).
- Audio thread pre-processing stage for MIDI interception and hidden event generation.
- O(log n) real-time chase via bar-boundary snapshots and binary search indexes.
- Per-articulation timing compensation (negative delay).
- First-class support for UACC (CC#32) and Art Conductor naming/colors.
- Standardized universal keyswitch layout defaults.
- Scrubbing debounce logic (50-100ms) for real-time transport.

**Non-goals:**

- Automated OCR capture from plugin GUIs (OCR-specific spec).
- Native MIDI 2.0 Orchestral Profile packet generation (data model only).

---

## Requirements

1. **Lossless Configuration** — Support unlimited output events per articulation (Cubase model) rather than Logic's 3-output limit.
2. **Direction vs. Attribute Duality** — Support both latching (Direction) and per-note (Attribute) articulations in the same map.
3. **Mutual Exclusion Groups** — Support up to 8 mutual exclusion groups for orthogonal articulation dimensions (exceeding Cubase's 4-group limit).
4. **Inline Visual Feedback** — Render 2-4 character short names and color fills directly on piano roll note bars.
5. **Per-Articulation Timing Compensation** — Support negative delay offsets (pre-send) per articulation to handle attack latency variations (e.g., -80ms for legato).
6. **Program-Change-Based Chase** — Map articulations to MIDI Program Changes at the engine level (Reaticulate model) to ensure native, bug-free chase behavior.
7. **O(log n) Chase Performance** — Implement chase via pre-computed snapshots at bar boundaries (O(n) rebuild on background thread, O(log n) lookup on audio thread).
8. **Lock-Free Engine Access** — Use `arc_swap::ArcSwap` for atomic, non-blocking sharing of Articulation Maps between UI and audio thread.
9. **Intra-Buffer Sorting & Priority** — Hidden events must be inserted with priority sorting: (1) KS Off [Priority 0], (2) KS On [Priority 1], (3) CC [Priority 2], (4) Note On [Priority 3].
10. **VEPro Compatibility** — Compensate for VEPro event reordering by providing a 1-tick note delay toggle or prioritizing Note-On keyswitches over CC switches.
11. **VST3/CLAP Discipline** — Avoid CC-based switching for VST3 (use Parameter Changes or Note-On) to maintain ordering; use unified event queues for CLAP.
12. **Region Splitting Integrity** — MIDI region splitting must preserve note-attached metadata and correctly insert Direction state at the split point.
13. **Default Articulation Chase** — Fall back to an explicit default articulation per group when no prior state is found (preventing the "Cubase revert to slot 1" bug). When no `defaultArticulationId` is set for a group, chase must use the map-level `defaultDirectionId`; if that is also null, the group resolves to "no active direction" and emits no hidden events for that group.
14. **Scrubbing Performance** — Transport scrubbing must debounce chase execution using a configurable timer in the range 50–100 ms (default 75 ms). Chase runs only after the playhead has been stationary for the debounce interval. During active scrubbing (before the interval elapses), the engine must emit `All Notes Off` (CC#123) and `All Sound Off` (CC#120) once per scrub start on every channel that has active keyswitches or sounding notes, and must not generate any articulation hidden events while scrubbing is in progress. Resolution of whether ANO/ASO are sent unconditionally on every scrub vs only when hanging notes are detected is tracked in Open Questions.
15. **Overlapping Notes / Keyswitch Conflict Resolution** — When two or more hidden events generated from different articulations would be emitted at the same sample offset on the same channel, the engine must disambiguate deterministically:
    - a) The intra-buffer priority sort (KS Off → KS On → CC → Note On) is the first tiebreaker.
    - b) Within the same priority, the articulation belonging to the exclusion group with the lower `exclusionGroupIdx` wins (lower index = higher priority).
    - c) Within the same exclusion group, the later-starting note's articulation wins (the "last write" model), and any previously-latched keyswitch for that group is released via an explicit KS Off before the new KS On at the same sample offset.
    - d) Attribute articulations always emit their hidden events; they do not mutate the persistent Direction state of any group.
    - e) If a single note carries two articulations from the same exclusion group (data-model violation), the engine must log a structured warning and fall back to the group's `defaultArticulationId` — it must not silently pick one.
16. **Channel Routing Chase** — When an articulation change causes the effective MIDI output channel for a note to differ from the previous active channel for that track (via `OutputEvent.channel` override), the engine must:
    - a) Emit `All Notes Off` (CC#123) on the **previous** channel at the articulation change boundary to prevent hung notes.
    - b) Re-send the chased state of CC#1, CC#11, CC#64, pitch bend, channel pressure, and the active program on the **new** channel before the first note-on on that channel.
    - c) If the previous channel had a latching keyswitch active, emit the corresponding KS Off on the previous channel before switching.
    - d) Channel-switch hidden events must respect the same priority sort (KS Off on old channel → ANO on old channel → CC/PC re-send on new channel → KS On on new channel → Note On).
    - e) The chase must produce identical output whether the engine started from the beginning of the track or jumped to the chase point mid-playback.

---

## Data Model (Lossless Distillation)

### TypeScript (Frontend)

```typescript
type ArticulationId = string; // UUID v7 for CRDT ordering
type ExclusionGroupId = string;
type ArticulationMapId = string;

type OutputEvent = {
    type:
        | 'keyswitch'
        | 'cc'
        | 'program_change'
        | 'channel_pressure'
        | 'pitch_bend'
        | 'note_expression';
    noteOrCc: number;
    value: number;
    bank?: number; // program_change only
    channel: number | null; // null = track default
};

type Articulation = {
    id: ArticulationId;
    name: string;
    shortName: string; // 2-4 chars for piano roll labels
    color: string; // hex, e.g. "#FF5733"
    iconId?: string;
    behavior: 'direction' | 'attribute';
    exclusionGroupId: ExclusionGroupId | null;
    keyswitchMode: 'latching' | 'momentary';
    outputEvents: OutputEvent[];
    preSendOffsetMs: number;
    velocityScale?: number;
    lengthScale?: number;
    transposeOctaves?: number;
};

type ExclusionGroup = {
    id: ExclusionGroupId;
    name: string;
    defaultArticulationId: ArticulationId | null;
};

type ArticulationMap = {
    id: ArticulationMapId;
    name: string;
    version: number; // monotonically increasing on edit; used for CRDT ordering and cache invalidation
    description?: string;
    articulations: Articulation[];
    exclusionGroups: ExclusionGroup[];
    defaultDirectionId: ArticulationId | null;
    globalPreSendOffsetMs: number; // fallback when per-articulation preSendOffsetMs is 0
};

// Per-note assignment (stored on MIDI note objects, not on the map)
type NoteArticulation = {
    directionIds: Record<ExclusionGroupId, ArticulationId>;
    attributeIds: ArticulationId[];
};
```

### Rust (Engine)

```rust
pub struct ArticulationMap {
    pub id: Arc<str>,
    pub name: Arc<str>,
    pub version: u64,
    pub articulations: Vec<Articulation>,
    pub exclusion_groups: Vec<ExclusionGroup>,
    pub default_direction_idx: Option<u16>,
    pub global_pre_send_samples: u32, // converted from globalPreSendOffsetMs at load time
}

pub struct NoteArticulationState {
    pub direction_per_group: [u16; 8], // u16::MAX = none
    pub attribute_mask: u64, // bitmask for up to 64 attributes
}
```

---

## Design decisions

### Decision: Articulation State Ownership

**Chosen:** Note-attached metadata (Logic model).
**Justification:** Ensures assignments move with notes during quantization/editing and allows polyphonic articulations (different notes in the same chord).

### Decision: Real-time Chase Architecture

**Chosen:** Hybrid O(log n) chase with bar-boundary snapshots and per-parameter binary search indexes.
**Justification:** Avoids O(n) linear scans from track start which are unacceptable for the real-time thread.

### Decision: Audio Thread Interception Point

**Chosen:** Pre-processing stage between Event Collection and Plugin Dispatch.
**Justification:** Maintains sample-accurate timing and intra-buffer priority sorting while remaining transparent to the plugin.

---

## Acceptance criteria

- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] Articulation Editor persists and round-trips an articulation with **at least 32 output events** (stress target; no UI-imposed cap below that) via JSON export/import without field loss.
- [ ] Engine test harness drives a single articulation trigger with **N = 64 configured output events** and the dispatched MIDI event buffer contains exactly 64 hidden events in the correct sort order with zero drops, measured by `preprocess_articulations` integration test.
- [ ] Piano roll notes wider than **16 px** render a `shortName` label of 2–4 characters with background color matching `Articulation.color`; notes between 4 px and 16 px render color fill only; notes narrower than 4 px render no label (verified by snapshot test at zoom factors 0.25×, 1×, 4×, and 16×).
- [ ] Articulation Lane renders one row per exclusion group that contains at least one articulation event in the region; Direction articulations render as colored spans whose start/end pixels match the event's sample tick ± 1 px; Attribute articulations render as 8 px markers centered on their note start (verified by visual regression test with a fixture containing 3 stacked groups).
- [ ] `ChaseIndex::chase_at` for a 200-bar project with 5,000 MIDI events completes in **≤ 1 ms p99** on the reference workstation (measured by criterion benchmark `chase_at_mid_timeline`).
- [ ] For a note at tick T with `preSendOffsetMs = 80` and `globalPreSendOffsetMs = 0`, the generated keyswitch event timestamp equals `T - samples_for(80 ms, sample_rate)` ± 0 samples; when `preSendOffsetMs = 0` the fallback equals `T - samples_for(globalPreSendOffsetMs)`.
- [ ] A momentary keyswitch whose held duration ends before the current playhead position must not appear in the engine's emitted event buffer when playback starts at that position (verified by `chase_momentary_suppressed` unit test asserting zero keyswitch events in the dispatch buffer).
- [ ] With VEPro compensation enabled, every note-on emitted on a VEPro-routed channel is delayed by exactly 1 MIDI tick relative to the scheduled position; with the toggle disabled the delay is 0 ticks (verified by `vepro_compensation_toggle` test comparing emitted event timestamps).
- [ ] During a scrubbing gesture that moves the playhead through 500 positions within 1 second, the engine executes chase **at most once** (after the debounce interval), and no more than one `CC#123` and one `CC#120` per channel are emitted per scrub gesture (verified by `scrub_debounce_single_chase` test counting chase invocations and CC emissions).
- [ ] Overlapping articulation resolution: given two notes from different exclusion groups starting at the same tick with conflicting keyswitches, the emitted buffer contains both groups' KS Off events before both KS On events, ordered by ascending `exclusionGroupIdx` within each priority class; no duplicate keyswitches are emitted for the same `(channel, note)` pair at the same tick (verified by `overlap_cross_group` test).
- [ ] Channel routing chase: given a chase from a position where the previous active articulation used channel 1 and the next articulation uses channel 2, the emitted buffer contains, in order, KS Off on channel 1, CC#123 on channel 1, CC#1/CC#11/CC#64/PC re-send on channel 2, KS On on channel 2, then Note On on channel 2 (verified by `channel_chase_full_rewrite` test asserting exact byte sequence and ordering).
- [ ] Engine produces byte-identical emitted event sequences whether the same playhead position is reached via (a) playback from tick 0 or (b) direct seek from elsewhere (verified by `chase_equivalence` fixture comparing serialized event buffers).

---

## Implementation notes

- **UACC Support:** Include a preset for Spitfire's UACC (CC#32) standard values.
- **Event Ordering:** Priority sorting is critical: KS Off (0) -> KS On (1) -> CC (2) -> Note On (3).
- **Buffer Boundary Crossings:** Use a `pending_events` buffer to defer keyswitches that land in the previous buffer due to pre-send offsets.
- **VST3 Caution:** Protocol converts CCs to parameter changes; ordering can be lost relative to notes. Prioritize Note-On keyswitches for VST3.

---

## Test plan

- [ ] **Manual:** Create a map with 200 articulations; verify UI responsiveness and search speed.
- [ ] **Manual:** Verify "paint mode" correctly assigns articulations to a selection of notes.
- [ ] **Automated:** Rust unit tests for `ChaseIndex` rebuild and `chase_at` logic.
- [ ] **Automated:** Integration test for `preprocess_articulations` event ordering.

---

## Implementation Status

- **What is implemented:** Nothing. This feature is completely missing from the codebase.
- **What is not implemented:** Everything described in the spec (Articulation Editor UI, Piano Roll integration, CRDT data model, audio thread pre-processing, chase engine, etc.).
- **What is done well:** N/A.
- **What needs refactoring:** N/A.

---

## Open questions

- [ ] **[CRITICAL]** Channel routing chase semantics — when a Direction articulation changes the output channel for subsequent notes, must the previous channel's active keyswitch be released (KS Off) before the channel switch, or is an `All Notes Off` (CC#123) on the previous channel sufficient? Requirement 16 currently requires **both**; confirm this is the desired contract before implementation, because plugins differ in how they handle a stray KS Off on an unselected channel.
- [ ] **[CRITICAL]** Overlapping articulation resolution — Requirement 15 defines "lower `exclusionGroupIdx` wins" as the cross-group tiebreaker and "later-starting note wins" as the intra-group tiebreaker. Validate with a product owner that this matches user expectation; the alternative (earlier note wins, stable ordering) would require a different engine implementation and cannot be changed without re-verifying all acceptance criteria.
- [ ] **[CRITICAL]** Scrub ANO/ASO policy — should `CC#120`/`CC#123` be emitted unconditionally on every scrub start (safest, audible artifact on each scrub), only when the engine detects hung notes / latched keyswitches (quieter, relies on engine bookkeeping being correct), or made a user-facing preference? Requirement 14's behavior depends on this choice.
- [ ] **[MINOR]** Should we implement a "maximum pre-send" global latency limit to avoid buffer boundary complexity?
- [ ] **[MINOR]** UI/UX for managing thousands of pre-built maps (Art Conductor style).
