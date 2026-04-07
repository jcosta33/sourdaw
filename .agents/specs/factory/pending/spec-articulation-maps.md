# Articulation Maps

## Context

Articulation maps are the single most requested—and often most poorly implemented—feature across commercial DAWs. This spec defines a system for a Tauri v2 DAW that leapfrogs existing implementations by combining Cubase's Direction/Attribute duality and unlimited output mappings with Reaticulate's program-change-based chase elegance. It addresses the 15 major recurring frustrations identified in orchestral composer research, including setup time, chase bugs, VEPro compatibility, and visual feedback collapse at scale.

Reference Research: `.agents/research/articulation-maps.md`

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
13. **Default Articulation Chase** — Fall back to an explicit default articulation per group when no prior state is found (preventing the "Cubase revert to slot 1" bug).
14. **Scrubbing Performance** — Implement a 50-100ms debounce timer for transport scrubbing to prevent chase flood.

---

## Data Model (Lossless Distillation)

### TypeScript (Frontend)
```typescript
interface Articulation {
    id: UUID; // UUID v7 for CRDT ordering
    name: string;
    shortName: string; // 2-4 chars
    color: string;
    iconId?: string;
    behavior: 'direction' | 'attribute';
    exclusionGroupId: UUID | null;
    keyswitchMode: 'latching' | 'momentary';
    outputEvents: Array<{
        type: 'keyswitch' | 'cc' | 'program_change' | 'channel_pressure' | 'pitch_bend' | 'note_expression';
        noteOrCc: number;
        value: number;
        channel: number | null; // null = track default
    }>;
    preSendOffsetMs: number;
    velocityScale?: number;
    lengthScale?: number;
    transposeOctaves?: number;
}
```

### Rust (Engine)
```rust
pub struct ArticulationMap {
    pub articulations: Vec<Articulation>,
    pub exclusion_groups: Vec<ExclusionGroup>,
    pub default_direction_idx: Option<u16>,
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
- [ ] Articulation Editor supports unlimited output events per sound slot.
- [ ] Piano roll notes display labels and colors at all zoom levels wide enough for 2 chars.
- [ ] Articulation Lane renders correctly for multiple stacked exclusion groups.
- [ ] Chase from mid-timeline restores state in <1ms (Rust).
- [ ] Keyswitches fire with correct pre-send offset relative to notes.
- [ ] Momentary keyswitches are correctly suppressed if Note-Off precedes playhead.
- [ ] VEPro 1-tick delay compensation is toggleable and functional.
- [ ] Scrubbing the playhead rapidly does not cause audio thread spikes (verified via debounce).

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

## Open questions

- [ ] **[MINOR]** Should we implement a "maximum pre-send" global latency limit to avoid buffer boundary complexity?
- [ ] **[MINOR]** UI/UX for managing thousands of pre-built maps (Art Conductor style).
