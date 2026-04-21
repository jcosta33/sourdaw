# Spec: Freeze, Flatten, and Bounce Operations

## Context

Track freezing is the single most impactful CPU-saving feature a DAW can offer. It replaces real-time plugin processing with pre-rendered audio, allowing users to work with complex projects on limited hardware. This spec defines a unified freeze/flatten/bounce architecture for Sourdaw based on extensive UX research across Ableton Live, Logic Pro, Pro Tools, Cubase, Studio One, Reaper, FL Studio, and Bitwig.

Key findings from research:

- **Two-phase model is essential**: Reversible freeze for CPU savings, irreversible flatten for commitment
- **Freeze must preserve editability**: Volume, pan, sends remain live; only source content and inserts are baked
- **Staleness detection is novel**: No surveyed DAW detects when frozen content becomes outdated
- **Sidechain is the #1 pain point**: Most DAWs either block freeze or render incorrect audio
- **File bloat requires GC**: Orphaned freeze files accumulate rapidly during iterative workflows

Reference: `.agents/research/factory/active/freeze-flatten-bounce.md`

---

## Goal

Implement a complete freeze/flatten/bounce system that: (1) allows users to freeze tracks to reclaim CPU while preserving mixer control, (2) detects when frozen content becomes stale due to edits, (3) supports flatten to permanently commit frozen audio, (4) provides bounce-to-new-track for non-destructive rendering, and (5) manages freeze file lifecycle with automatic garbage collection.

---

## User-Visible Behavior

### Freeze Track

- User selects "Freeze Track" from track context menu or shortcut
- Track enters "freezing" state with progress indicator
- All clips and devices on the track are rendered to a 32-bit float WAV file
- Original clips remain in document but are bypassed during playback
- Volume, pan, sends, mute, solo remain editable in real-time
- Clip editing, device parameter changes, and MIDI note editing are disabled
- Track displays frozen indicator (snowflake icon with visual overlay)
- Frozen audio plays back instantly without CPU load from plugins

### Unfreeze Track

- User selects "Unfreeze Track" to restore live processing
- Original clips and devices become active again
- Freeze file is marked for garbage collection (retained in undo history)

### Staleness Detection

- If user modifies frozen track content (clips, devices, MIDI notes), track enters "stale" state
- Stale tracks continue playing frozen audio but display warning indicator
- User can re-freeze to update or unfreeze to discard

### Flatten Track

- Available only when track is frozen and up-to-date (not stale)
- Permanently replaces original clips and devices with frozen audio clip
- Track type may change (MIDI track becomes audio track)
- Warning dialog if plugin state changed since freeze
- Undoable via CRDT undo, but becomes irreversible after project close

### Bounce in Place / Bounce to New Track

- Renders track to audio without freezing intermediate state
- Option to include/exclude: inserts, sends, volume/pan automation, tail
- Option to normalize (off / overload protection / full)
- Creates new audio track or replaces current track
- Non-destructive: original track can be muted or deleted

### Freeze File Management

- Freeze files stored in project `freeze/` directory
- Automatic cleanup of unreferenced files on project close
- Undo history protects recently unreferenced files
- Smart project export option includes freeze files only for missing plugins

---

## Scope

### In Scope:

- Freeze/unfreeze operations with state machine (unfrozen → freezing → frozen → stale → unfrozen)
- Offline render pipeline for freeze using existing `OfflineAudioContext` infrastructure
- CRDT freeze state model extending existing `Track.frozen` boolean
- Staleness detection via content hashing
- Flatten operation (destructive commit)
- Bounce in place and bounce to new track
- Freeze file garbage collection with undo awareness
- UI indicators: freeze button, progress overlay, stale warning, snowflake icon
- Sidechain dependency handling (detect and include sidechain sources in render)
- Tail detection and rendering for reverb/delay
- Multi-output instrument freeze (render all outputs as separate freeze files)

### Non-Goals (Explicitly Out of Scope):

- Partial freeze up to specific insert (Pro Tools feature) — may be added later
- Real-time freeze fallback — offline only for MVP
- Plugin-specific freeze optimizations (VST3 kOffline mode) — use generic offline flag
- Hardware insert freeze — blocked with error message
- Cross-project freeze file sharing — freeze files are project-local
- Collaborative freeze conflict resolution beyond LWW semantics
- Freeze for folder tracks (flatten children first)
- Audio-to-MIDI conversion on unfreeze
- Freeze analysis data (spectral, pitch) — audio only

---

## Requirements

### R1: Freeze State Model

The system MUST maintain a freeze state machine per track with the following states:

- `unfrozen`: Normal live processing
- `freezing`: Render in progress, UI shows progress indicator
- `frozen`: Frozen audio active, live plugins bypassed
- `stale`: Frozen audio active but source content changed, warning indicator shown
- `error`: Freeze failed, error message displayed, revert to unfrozen

### R2: Freeze State CRDT Schema

The `Track` model MUST be extended with:

```typescript
type FreezeState = {
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
    freezeId?: string; // Unique render identifier
    frozenBufferId?: string; // Reference to audioBufferCache
    frozenAudioHash?: string; // SHA-256 of rendered audio
    sourceContentHash?: string; // Hash of clips + positions + device states
    deviceChainHash?: string; // Hash of ordered device IDs + states
    renderSettings?: {
        sampleRate: number;
        bitDepth: number; // Always 32 for freeze
        channelCount: number;
        tailLengthSeconds: number;
    };
    renderProgress?: number; // 0.0-1.0 during freezing
    errorMessage?: string; // Set when status is 'error'
    renderedAt?: number; // Unix epoch ms
};
```

### R3: Content Hash Computation

The system MUST compute `sourceContentHash` by SHA-256 hashing:

- Sorted clips: `${id}:${startBeat}:${duration}:${assetHash ?? ''}:${gain}`
- Sorted devices: `${device.id}:${device.type}:${sortedParamValues}:${device.bypassed}`
- Hash recomputed on every CRDT change and compared to `FreezeState.sourceContentHash`

### R4: Offline Freeze Render

When freezing, the system MUST:

1. Compute source content hash at initiation
2. Calculate total render duration: max clip end beat + tail length
3. Query all devices for tail length; use max reported
4. For devices reporting infinite tail: use silence detection (continue rendering until output RMS drops below -96 dB for 512 consecutive samples)
5. Build dependency subgraph including sidechain source tracks
6. Render using `OfflineAudioContext` with existing `scheduleTrackClips`
7. Apply PDC (Plugin Delay Compensation) to automation timing: automation must be delayed to account for plugin latency to prevent timing drift
8. Store result in `audioBufferCache` with unique ID
9. Write to `freeze/` directory as 32-bit float WAV
10. Update CRDT with `status: 'frozen'` and metadata

### R5: Sidechain Handling

The system MUST detect sidechain inputs and:

- Include sidechain source tracks in dependency subgraph
- Render sidechain sources before or alongside frozen track
- Render with silent sidechain if source unavailable (with warning)
- Block freeze with error if circular sidechain detected

### R6: Real-Time Playback of Frozen Tracks

The audio engine MUST:

- Check `track.freezeState.status` on each process block
- If `frozen` or `stale`: read from frozen buffer, skip device processing
- If `unfrozen`: normal clip → device chain → output
- If `freezing`: continue normal processing (freeze is background operation)
- Apply live volume, pan, sends, mute to frozen audio

### R7: Unfreeze Operation

The system MUST:

- Restore `status: 'unfrozen'` in CRDT
- Clear freeze metadata (buffer ID, hashes)
- Retain freeze file in undo history (protected from GC)
- Resume normal live processing immediately

### R8: Staleness Detection

The system MUST:

- Recompute `sourceContentHash` after every track modification
- Compare to `FreezeState.sourceContentHash`
- If different and `status === 'frozen'`, transition to `status: 'stale'`
- Display stale indicator in track header
- Allow playback to continue (prevent CPU spike during editing)

### R9: Flatten Operation

The system MUST:

- Require `status === 'frozen'` and hash match (not stale)
- Warn if `deviceChainHash` differs from current devices (params changed)
- Display pre-flatten dialog: _"Plugin settings changed since this track was frozen. Flattening will commit the older rendered audio, not the current plugin state."_ with options to re-freeze first or proceed
- Replace track clips with single audio clip referencing freeze file
- Clear track devices
- Update track type: MIDI → audio if applicable
- Move freeze file from `freeze/` to `audio/` (promote to permanent)
- Reset `freezeState` to `unfrozen`
- Group all mutations in single CRDT undo entry
- Warn that flatten becomes irreversible after project close (matches Ableton/Logic behavior)

### R10: Bounce Operations

The system MUST support:

- **Bounce in Place**: Render track, replace clips with audio, remove devices
- **Bounce to New Track**: Render track, create new audio track with result, mute source
- Options dialog with: include inserts (yes/no), include sends (yes/no), include volume/pan automation (yes/no), tail handling (auto/manual/off), normalization (off/protection/full), destination (new track/replace)

### R11: Freeze File Management

The system MUST:

- Store freeze files in `Project/freeze/<freezeId>.wav`
- Write to `.tmp` file and atomic rename on completion
- Delete `.tmp` files on startup (crash recovery)
- Run GC sweep: on project save (conservative), on close (aggressive), periodic (size limit)
- GC mark phase: collect referenced freeze IDs from CRDT + undo history
- GC sweep phase: delete unreferenced files older than threshold
- GC age thresholds: default **7 days** for referenced-but-orphaned candidates in active projects; **immediate** deletion of unreferenced files on project close
- Periodic GC: enforce total `freeze/` byte budget on a **10-minute** interval, in addition to save/close triggers
- CRDT sync to audio engine: debounce into 16ms batches (one animation frame); if fewer than 10 tracks changed, send incremental per-track updates; if more, send full project snapshot

### R12: Progress and Cancellation

The system MUST:

- Report render progress via callback (0.0-1.0)
- Display progress in track header during freezing
- Allow cancellation mid-render (clean up temp file, revert to unfrozen)
- Set 5-minute watchdog timer to auto-revert stuck freeze operations

### R13: Error Handling

The system MUST handle:

- Disk space exhaustion: Check before render with 2x safety margin
- Plugin crash during render: Abort, clean up, set error status
- Missing audio buffer: Warning, continue with silence
- Sidechain cycle: Error dialog, abort freeze
- Render timeout: Auto-cancel, revert to unfrozen

### R14: UI Indicators

The track header MUST display:

- Snowflake icon when frozen
- Yellow warning overlay when stale
- Progress spinner/bar when freezing
- Red error indicator with tooltip when error
- Cross-hatched pattern overlay on frozen clips (Arrangement view)

### R15: Project Artifact Layout

The freeze folder MUST support mark-and-sweep GC plus undo retention. Recommended layout:

- `Project/freeze/<freezeId>.wav` — rendered freeze audio (written via `.tmp` + atomic rename)
- `Project/freeze/.freeze-manifest.json` — GC metadata (last-seen references, byte budget, age counters)
- Undo-retained freeze IDs tracked alongside the CRDT undo history (mechanism mirrors research's `.undo-refs.json`; exact storage is an implementation detail)

### R16: Collaborative Lock UI

While any peer holds `freezeState.status === 'freezing'` for a track, all peers MUST:

- Show a **lock/busy indicator** on that track's freeze control (mirrors research's recommendation)
- Suppress competing freeze commands client-side, reporting "freeze in progress on <peer>"
- Accept LWW resolution if two peers did start concurrently: the later writer's `frozenBufferId` wins, and the losing render file becomes GC-eligible at the next sweep

### R17: Research Traceability (Non-Normative)

The following DAW behaviors inform this spec and are captured here so implementers can reference them without re-reading the research:

- **Ableton** — freeze to 32-bit float WAV under `Samples/Processed/Freeze/`; refuses to freeze tracks with active sidechain input; Arrangement-view reverb/delay tails render as separate tail clips, Session-view folds ~2 loop cycles; Live 12.2 renamed Flatten to "Bounce Track in Place".
- **Logic Pro** — Source Only (blue indicator, effects remain live) vs Pre-Fader (green, full chain baked); **cannot freeze multi-output software instruments**; documented PDC bug on high-latency plugins; automation can fire at incorrect times during freeze.
- **Pro Tools** — Freeze Up To This Insert (partial freeze); **cannot freeze external hardware inserts** (offline rendering produces silence).
- **Cubase** — RIP with configurable depth; Complete Signal Path is the only mode that bakes sends.
- **Studio One / Reaper / FL Studio / Bitwig** — varying levels of transform/bounce; see research file for full table.

### R18: State Vocabulary Alignment

- The research five-state sketch uses `unfrozen → freezing → frozen → stale → unfreezing`; this spec replaces `unfreezing` with `error` (R1) and treats unfreeze as an **instantaneous** transition (R7). If future teardown paths require a transient state, add it explicitly rather than overloading `freezing`.

---

## Constraints

- MUST follow domain-driven module architecture (`AGENTS.md`)
- MUST use existing Automerge CRDT (not Loro as in research)
- MUST reuse existing `offlineRender.ts` infrastructure
- MUST maintain backward compatibility with existing `Track.frozen` boolean
- Freeze files MUST be project-local (not shared across projects)
- Audio format MUST be 32-bit float WAV for freeze (preserves headroom)
- MUST NOT break existing offline mixdown/stem export
- MUST handle collaborative editing (LWW semantics for freeze state)
- MUST NOT block UI thread during freeze render

---

## Design Decisions

### Decision: Extend Existing Track.frozen vs New Freeze Module

**Chosen:** Extend existing `Track` model with `freezeState` object, keeping `frozen` boolean for backward compatibility.

**Considered and rejected:**

- New `Freeze` module: Would separate freeze logic from track ownership, complicating CRDT updates and track deletion
- Separate freeze metadata document: Would introduce cross-document references, harder to keep in sync

**Rationale:** Freeze is fundamentally a track property. Extending the existing model keeps all track state in one place and maintains compatibility with existing code checking `track.frozen`.

### Decision: Automerge vs Loro for CRDT

**Chosen:** Use existing Automerge integration.

**Considered and rejected:**

- Migrate to Loro as recommended in research: Would require massive refactoring of existing collaboration system

**Rationale:** The research recommends Loro for its Rust-native implementation and MovableList/MovableTree types. However, Sourdaw already has a working Automerge integration. The freeze state model is simple enough (single Map per track) to work well in Automerge.

### Decision: Browser-First Architecture

**Chosen:** Implement using Web Audio `OfflineAudioContext` for freeze rendering.

**Considered and rejected:**

- Rust/Tauri offline executor as primary: Research assumes native backend, but current Sourdaw is browser-first with Tauri as optional wrapper

**Rationale:** The existing `offlineRender.ts` already uses `OfflineAudioContext` successfully for mixdown/stem export. Freeze can reuse this infrastructure. When Tauri native backend is added, the freeze pipeline can be extended with a Rust executor path.

### Decision: Content Hash for Staleness Detection

**Chosen:** SHA-256 hash of canonical clip and device state representation.

**Considered and rejected:**

- Timestamp-based staleness: Would false-positive on non-content changes (e.g., clip selection)
- Deep equality comparison: Too slow for large tracks
- Event-based staleness tracking: Complex to maintain, misses edge cases

**Rationale:** Content hashing is deterministic, fast to compare, and catches all meaningful changes. The cost of hashing is acceptable during user editing (not real-time critical).

### Decision: Sidechain Inclusion in Render

**Chosen:** Include sidechain sources in freeze render subgraph.

**Considered and rejected:**

- Block freeze with sidechain (Ableton approach): Limits user workflow
- Render without sidechain (silent): Produces incorrect audio
- Require frozen sidechain sources: Complex dependency management

**Rationale:** Including sidechain sources in the render ensures correct audio output. The cost is longer render time for tracks with sidechain, but correctness is prioritized over speed.

---

## Acceptance Criteria

- [ ] Track freeze transitions through all state machine states correctly
- [ ] Frozen tracks play pre-rendered audio with live volume/pan/sends
- [ ] Content hash detects all clip and device modifications
- [ ] Stale indicator appears when frozen track is modified
- [ ] Unfreeze restores live processing and clears freeze metadata
- [ ] Flatten replaces original content with frozen audio clip
- [ ] Bounce to new track creates audio track from rendered output
- [ ] Freeze files written to `freeze/` directory as 32-bit float WAV
- [ ] GC removes unreferenced freeze files on project close
- [ ] Sidechain sources included in freeze render
- [ ] Tail length detected and rendered correctly
- [ ] Progress indicator shown during freeze operation
- [ ] Cancellation aborts render and cleans up temp files
- [ ] Error states handled with user-friendly messages
- [ ] Undo restores freeze state and protects files from GC
- [ ] `pnpm deps:validate` passes with zero violations
- [ ] Collaborative editing: freeze state uses LWW semantics correctly
- [ ] Existing mixdown/export continues to work with frozen tracks

---

## Implementation Notes

### Key Files to Modify

- `src/modules/Arrangement/models/Track.ts` — Add `FreezeState` type, extend `Track`
- `src/modules/Arrangement/useCases/freezeTrack.ts` — New: initiate freeze
- `src/modules/Arrangement/useCases/unfreezeTrack.ts` — New: restore live processing
- `src/modules/Arrangement/useCases/flattenTrack.ts` — New: commit frozen audio
- `src/modules/Arrangement/useCases/bounceTrack.ts` — New: bounce operations
- `src/modules/AudioEngine/useCases/renderFreeze.ts` — New: offline render for freeze
- `src/modules/AudioEngine/stores/freezeFileCache.ts` — New: manage freeze file lifecycle
- `src/modules/Arrangement/events/FreezeStateChangedEvent.ts` — New: freeze state notifications

### Reuse Patterns

- Offline render: Extend `offlineRender.ts` with freeze-specific duration/tail handling
- Audio cache: Use existing `audioBufferCache` with freeze-specific IDs
- CRDT mutations: Follow `mutateCrdtDoc.ts` patterns
- Progress UI: Reuse existing progress components from stem export

### Testing Strategy

- Unit: Content hash computation, state machine transitions
- Integration: Freeze/unfreeze roundtrip, flatten commit, GC sweep
- E2E: Full workflow with plugins, sidechain, collaborative editing

---

## Test Plan

### Manual Testing

1. Create MIDI track with instrument, add some notes
2. Freeze track — verify progress indicator, verify snowflake appears
3. Verify CPU usage drops (plugins bypassed)
4. Modify volume/pan — verify changes apply to frozen audio
5. Edit a MIDI note — verify stale indicator appears
6. Unfreeze — verify live processing restored
7. Refreeze — verify fresh render
8. Flatten — verify track becomes audio track with frozen content
9. Undo flatten — verify original MIDI restored
10. Close project, reopen — verify freeze files still work
11. Delete track with freeze file — verify GC removes file on close

### Automated Testing

- State machine property tests: all valid transitions
- Content hash tests: detect changes, ignore non-changes
- GC tests: reference tracking, age-based eviction
- Sidechain tests: dependency detection, inclusion in render

---

## Open Questions

- [ ] **[MINOR]** Should freeze support undo history beyond project close? Currently flatten becomes irreversible after close (matches Ableton/Logic behavior).
- [ ] **[MINOR]** Should frozen tracks allow clip duplication/copy-paste? Research shows mixed behavior across DAWs.
- [ ] **[CRITICAL]** Disk space check threshold: 2x estimated size sufficient, or use 3x safety margin?
- [ ] **[MINOR]** Archive packing modes (from research): `Full` (include all freeze files), `Minimal` (exclude all — re-render on open), `Smart` default (include freeze files only when `deviceChainHash` implies missing plugins on recipient). Ship in v1 or defer?
- [ ] **[MINOR]** Optional Premiere-style GC tuning for very large sessions: **90-day** age cap, **10%** of volume cap, weekly housekeeping on launch. Currently out of scope (R11 uses 7-day + 10-min sweep + project-close rules).
- [ ] **[MINOR]** Should VST3 plugins be called with `processMode = kOffline` during freeze (research recommendation), with an opt-in **real-time render fallback** for plugins that behave differently offline? Currently Non-Goal for MVP (real-time fallback / plugin-specific offline mode both deferred).

---

## Tradeoffs and Risks

### Tradeoffs

- **Stale state vs auto-refreeze**: Auto-refreeze would be seamless but CPU-intensive during editing. Explicit stale indicator gives user control.
- **Include sidechain vs block**: Including sidechain makes freeze slower but more useful. Blocking limits workflow.
- **GC aggressiveness**: Conservative GC (7-day retention) vs aggressive (immediate). Conservative is safer but uses more disk.

### Risks

- **Disk space exhaustion**: Large projects with many freeze iterations could fill disk. Mitigation: Pre-render check, user warning. Research: a **50-track session with 10 freeze iterations** can accumulate gigabytes of dead files without GC.
- **Plugin non-determinism**: Some plugins produce slightly different output each render. Mitigation: Accept as limitation, document.
- **Collaborative conflicts**: Two users freezing same track simultaneously wastes render effort. Mitigation: LWW semantics, UI lock indicator (see R16).
- **Undo history growth**: Long undo chains retain many freeze files. Mitigation: Undo depth limits, explicit GC.
- **Logic-style PDC automation bug**: Plugins with high latency have a documented history of firing automation at incorrect times during freeze on other DAWs. Mitigation: PDC is mandatory (R4.7); regression-test automation timing on high-latency plugin chains.
- **Large-template CPU spikes during offline render**: Orchestral templates can saturate CPU during freeze. Mitigation: progress/cancellation (R12) stays responsive; consider documenting expected worst-case render duration as a known limitation.

## Implementation Status

**What is implemented:**

- `FreezeState` type on the `Track` model (CRDT schema).
- Freeze operations state machine (`freezeTrack`, `unfreezeTrack`, `flattenTrack`).
- Staleness detection using content hashing (`initStalenessDetection`, `computeTrackHash`).
- Background offline render infrastructure (`renderOffline`).
- Garbage collection sweeps (`cleanupUnusedFreezeFiles`).
- Basic bounce operations (`bounceInPlace`, `bounceToNewTrack`).

**What is not implemented:**

- Moved to `.agents/specs/missing/spec-of-the-gaps.md`.

**What is done well:**

- Strong separation of concerns with domain-driven `useCases` (`freezeTrack`, `unfreezeTrack`, `flattenTrack`).
- Content hashing strategy for staleness is well-implemented and isolated.
- The CRDT integration uses the `Track` state naturally without creating a parallel structure.

**What needs refactoring:**

- Moved to `.agents/specs/missing/spec-of-the-gaps.md`.
