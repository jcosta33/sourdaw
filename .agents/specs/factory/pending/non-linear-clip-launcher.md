# Non-linear Clip Launcher

## Context

The non-linear clip launcher provides a session-view style performance and arrangement environment, enabling quantized clip triggering, scene-based organization, and probabilistic follow actions. This feature is a core pillar of modern DAWs (Ableton Live, Bitwig Studio) and allows for non-linear composition and live performance.

Reference research: `.agents/research/non-linear-clip-launcher.md`

---

## Goal

Implement a production-grade non-linear clip launcher with a dual-mode scheduling architecture (Arrangement vs. Launcher), sample-accurate quantized triggering, and complex probabilistic Follow Actions, fully integrated with the Tauri v2 Rust audio engine.

---

## User-visible behavior

- **Grid Interaction**: Users interact with a grid of **Tracks (columns)** and **Scenes (rows)**.
- **Clip Slot States**: Slots can be empty (with/without stop button), filled/stopped, queued (flashing), playing (with progress readout), or recording.
- **Stop Button Logic**: Empty slots with stop buttons silence the track on scene launch. Removing a stop button makes the track "immune" to scene launches.
- **Quantization**: Global setting (None to 8 Bars) with per-clip overrides.
- **Trigger Modes**:
    - **Trigger**: Starts on next boundary.
    - **Gate**: Plays while held, stops on release.
    - **Toggle**: Click to start, click to stop.
    - **Momentary/Retrigger**: Performance-oriented modes (Logic-style).
    - **ALT Trigger**: Modifier-key based alternative launch behavior (Bitwig-style).
- **Follow Actions**: Automated triggers after a clip finishes or a duration elapses.
- **Dual View**: Launcher and Arranger visible simultaneously (Bitwig/Logic style).
- **Back to Arrangement**: Per-track source toggle. The arrangement playhead continues advancing even when a track is in Launcher mode.
- **Smart Pickup**: Late-triggered cells can start at the "correct" relative position (Logic-style).

---

## Scope

### In scope:

- **Grid UI**: React-based grid with virtualized rendering.
- **Launcher State Machine**: Per-track source multiplexer (Arrangement, Launcher, Stopped).
- **Quantization**: Sample-accurate buffer splitting at quantization boundaries.
- **Follow Actions**: Full implementation of Ableton-style A/B probability and Linked/Unlinked modes.
- **Warp/Time-stretch**: Integration with a custom or permissively licensed (e.g., MIT/Apache) time-stretch engine (such as a Phase Vocoder + WSOLA hybrid) for tempo-synced clip playback.
    > ⚠️ **LEGAL & COMPLIANCE WARNING**: Do not link against or implement algorithms directly sourced from GPL-licensed software such as the Rubber Band Library. Rubber Band may be referenced for performance benchmarks, but all stretching logic must be implemented clean-room or utilize compatible permissive licenses.
- **Legato Mode**: Position inheritance in beat-time across clip launches.
- **MIDI State Tracking**: Note-on tracking, CC chase, and cleanup to prevent stuck notes.
- **Recording to Arrangement**: Flattening of launcher performance logs into arrangement clips.
- **IPC Protocol**: High-performance Tauri v2 Commands (UI -> Rust) and Channels (Rust -> UI).

### Non-goals:

- Multi-clip editing within a single slot.
- Real-time audio recording _into_ slots (initially).
- Complex MIDI MPE support in the launcher.

---

## Requirements

### 1. Data Model & State

- **LauncherMatrix**: Global structure containing Tracks, Scenes, and Global Quantization settings.
- **ClipSlot**:
    - `ClipId`, `hasStopButton`, `launchQuantize` override.
    - `PlayMode`: Trigger, Gate, Toggle, Retrigger, Repeat.
- **FollowActionConfig**:
    - Actions: `NoAction`, `Stop`, `Again`, `Previous`, `Next`, `First`, `Last`, `Any`, `Other`, `Jump(Scene)`, `ReturnToArrangement`.
    - `Next/Previous` Logic: Wraps within contiguous "Clip Blocks" (blocks of non-empty slots).
    - Probabilities: A/B weights (0-100%).
    - `Linked`: Fires at clip end (with `loopCount` multiplier).
    - `Unlinked`: Fires after fixed `duration`.

### 2. Audio Engine (Rust)

- **Three-Thread Architecture**:
    - **Audio Thread**: Pure DSP, no alloc/lock. Processes `ScheduledEvent`s.
    - **Scheduler Thread**: Evaluates Follow Actions, resolves quantization to sample offsets, manages priority queue.
    - **UI/Tauri Thread**: IPC bridging.
- **Buffer Splitting & Crossfading**:
    - Detect multiple boundaries per buffer.
    - Apply **32-64 sample micro-crossfade** at splice points.
    - Use **Equal-power crossfading** (`cos(t·π/2)` and `sin(t·π/2)`).
- **Priority System**: `TransportStop(0)` > `SceneLaunch(1)` > `ClipStop(2)` > `ClipLaunch(3)` > `FollowAction(4)` > `LoopBoundary(5)`.
- **IPC**:
    - **UI -> Scheduler**: `tokio::sync::mpsc`.
    - **Scheduler -> Audio**: `rtrb` (SPSC).
    - **Audio -> UI (Feedback)**: Tauri Channels (60Hz decimated).
    - **Audio -> UI (Metering)**: `triple_buffer`.
    - **Params**: `atomic_float`.

### 3. Warp & Legato

- **Time-Stretch Engine**: Push-input/pull-output model supporting generic variable-ratio processing.
- **Warp Map**: Piecewise linear interpolation between `(beat_pos, sample_pos)` markers.
- **Legato**: Inherit beat position, map through target warp map to new source sample offset.

### 4. MIDI Handling

- **Active Note Tracker**: 16 channels x 128 notes bitfield.
- **CC Chase**: Scan backwards before start beat to emit latest CC/PitchBend.
- **Loop Boundary Race Prevention**: Note-Offs at `sample_offset`, Note-Ons at `sample_offset + 1`.

### 5. Recording & Arrangement

- **Snapshot**: On "Record", snapshot all playing clips as `ClipStart` events at the start beat.
- **Flattening**: Log `PerformanceEvent`s and flatten into `ArrangementClipRef` (preserving deterministic outcomes, optionally preserving seeds).

---

## Design decisions

### Decision: Follow Action Logic Location

**Chosen:** Scheduler Thread.
**Rationale:** Keeps the audio thread focused on DSP. Sub-microsecond queue overhead + 1ms poll is inaudible for quantization boundaries.

### Decision: Warp Marker Interpolation

**Chosen:** Piecewise Linear.
**Rationale:** Industry standard for predictable time-stretching and simple beat-to-sample mapping.

---

## Acceptance criteria

- [ ] Audio thread renders with zero heap allocations (verified via `assert_no_alloc`).
- [ ] Micro-crossfades are applied at all quantization boundaries (no clicks).
- [ ] Follow Action "Next" wraps correctly within clip blocks.
- [ ] CC values are chased correctly when launching mid-clip.
- [ ] Recording into arrangement captures the performance accurately, including mid-clip starts.
- [ ] UI grid remains responsive (60fps) during heavy scene launching.

---

## Test plan

- [ ] **Automated**: `FollowAction` distribution tests (A/B probability accuracy).
- [ ] **Automated**: `WarpMap` linear interpolation edge case tests.
- [ ] **Manual**: Verify "Back to Arrangement" resumes correctly at current transport position.
- [ ] **Manual**: Test "ALT Trigger" (Bitwig-style) with modifier keys.

---

## Open questions

- [ ] **[CRITICAL]** How to handle deallocation of old clip data when a clip is replaced while playing? (Proposed: `basedrop::Shared` pointers).
- [ ] **[MINOR]** Should we implement "Clip Blocks" as visual groups or purely logical? (Proposed: Purely logical for V1).

---

## Tradeoffs and risks

- **Time-stretch Latency**: Algorithmic group delay (e.g., FFT frame latency in phase vocoders) must be compensated for by priming with silence.
- **IPC Latency**: Tauri command serialization overhead. Mitigation: Keep payloads minimal.
