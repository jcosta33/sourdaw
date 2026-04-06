# Non-linear clip launcher blueprint for a Tauri v2 DAW

**A dual-mode scheduling architecture combining Rust lock-free audio, React UI, and quantized clip launching can replicate — and improve on — the Session View paradigm pioneered by Ableton Live.** The core insight from studying all three major implementations (Ableton, Bitwig, Logic) is that the clip launcher and arrangement timeline are best modeled as two independent sequencers sharing a single transport, with a per-track priority multiplexer that defaults to the arrangement and overrides to the launcher on demand. This document provides the complete UX analysis, Rust data model, IPC flow, and scheduling architecture to build one.

---

## How the three major clip launchers actually work

### Ableton Live: the 20-year reference implementation

Ableton's Session View arranges clips in a grid of **tracks (columns) × scenes (rows)**. Each clip slot exists in one of six states: empty-with-stop-button, empty-without-stop-button, filled/stopped, queued (flashing green), playing (solid green with pie-chart progress), or recording (red). Launching a scene triggers every clip in that row simultaneously — critically, **empty slots that retain their stop buttons send a stop command to their track**, silencing whatever was playing there. Removing stop buttons (Ctrl+E) is the only way to make a track "immune" to scene launches, a non-obvious workaround that remains one of the most common beginner frustrations.

**Quantization** operates at two levels: a global setting in the Control Bar (None through 8 Bars) and per-clip overrides. Multi-bar values define a fixed launch grid — 2-bar quantization means launches can only occur at bars 1, 3, 5, 7, etc. from timeline origin. Legato mode bypasses this entirely: the incoming clip inherits the outgoing clip's playback position, enabling seamless variation-switching mid-phrase. Follow Actions bypass global quantization but respect per-clip quantization — an inconsistency that regularly confuses users.

**Follow Actions** (substantially overhauled in Live 11/12) offer 10 action types: No Action, Stop, Again, Previous, Next, First, Last, Any, Other, and Jump (to specific slot). Each clip carries two action slots (A and B) with independent probability percentages, creating weighted random behavior. The Linked/Unlinked switch determines whether actions fire at clip end (with a loop-count multiplier) or after an absolute time duration. Scene-level Follow Actions (Live 11+) enable self-playing arrangements that advance through song sections automatically. Clips with Follow Actions display a distinctive striped launch button.

The **Session↔Arrangement interaction** follows a per-track override model. Launching any Session clip on a track silences that track's arrangement playback. The arrangement playhead never stops — it continues advancing on all tracks. Clicking "Back to Arrangement" (or per-track arrows in the Arrangement View) restores arrangement playback at the **current transport position**, not where it was interrupted. Some tracks can play from the arrangement while others play Session clips simultaneously. Recording a Session performance into the arrangement logs all actions as clip references at correct timeline positions — no new audio data is created.

**The biggest pain points** reported across forums: Session and Arrangement Views contain independent clip instances (changes don't sync between views); Follow Actions only coordinate within a single track (no cross-track coordination without Max for Live); the "No Action" Follow Action permanently stops further Follow Action evaluation for that clip instance; and the "Back to Arrangement" button behavior remains a persistent source of confusion for new users.

### Bitwig Studio: per-track independence as an architectural advantage

Bitwig's launcher is oriented horizontally (tracks as rows, scenes as columns) and — crucially — **embeds directly alongside the Arranger Timeline**. Both views are visible simultaneously without switching, which is its single most-praised UX difference from Ableton. The launcher and arranger are described internally as "two distinct sequencers sharing one transport."

**The defining architectural feature is per-track launcher/arranger independence.** Each track independently determines whether it reads from the launcher or arranger at any moment. A track switches to the launcher when a clip is triggered, and returns to the arranger only when its dedicated "Switch Playback to Arranger" button is pressed. This is fundamentally more granular than Ableton's model, where the "Back to Arrangement" button is effectively a global action. Bitwig even offers a built-in "Return to Arrangement" Next Action, allowing automated per-clip return — something Ableton lacks entirely.

Bitwig's **Next Action** system (its Follow Action equivalent) supports a single action per clip rather than Ableton's dual A/B probability system. Available actions include Play Next, Previous, First, Last, Random, Other, Round-robin, and a unique suite of **Clip Block** actions (First in Block, Random in Block, First in Next Block, etc.). Clip Blocks — groups of adjacent clips separated by empty slots — provide sophisticated block-based navigation with no Ableton equivalent. However, Bitwig **lacks scene-level Follow Actions** and **has no probability weighting between two alternatives**, both of which are significant limitations for generative workflows.

Unique features include the **Main + ALT trigger system** (two complete launch behaviors per clip, accessible via modifier key), **On-Release actions** (Bitwig 5+) enabling press-and-hold performance gestures, and **seed value preservation** when recording launcher performances to the arranger — ensuring randomized elements replay exactly as heard during recording.

### Logic Pro Live Loops: accessible but incomplete

Logic's Live Loops uses the same track × scene grid concept but transposes the orientation (tracks horizontal, scenes as columns). Like Bitwig, both the Live Loops grid and arrangement are visible simultaneously. Three trigger modes per cell — Start/Stop, Momentary (press-and-hold), and Retrigger — provide expressive control. Smart Pickup allows late-triggered cells to start at the "correct" position, trading off the beginning of the clip to maintain sync.

The integration with Apple's ecosystem is strong: Logic Remote on iOS provides multi-touch cell triggering, and Remix FX (DJ-style filter/stutter/scratch effects with X/Y pad) adds a performance dimension that neither Ableton nor Bitwig offer natively. **However, Logic Pro has no Follow Action equivalent whatsoever** — the single most-cited missing feature. Users consistently describe Live Loops as a "scratchpad for ideas" rather than a serious performance tool. Quantization bugs with "Cell End" mode across complex scenes are also frequently reported.

### How performers actually use Follow Actions

In practice, Follow Actions serve three primary workflows. **Sequential cycling** (all clips set to "Next" at 100%) creates deterministic multi-bar patterns from single-bar clips — e.g., four 1-bar drum clips chained into a 4-bar phrase where the 4th bar is a fill. **Generative ambient music** uses "Any" or "Other" actions across clips in the same key, creating endlessly evolving, non-repeating textures. Brian Eno's tape-loop technique is replicated by using clips of different lengths across tracks — since each track's Follow Actions run independently, different-length loops continuously create new combinations. **DJ-style transitions** combine Legato mode with Follow Actions so clips switch without resetting playback position, enabling constant breakbeat-style variation every 16th note.

**The universal pain point when capturing launcher performances to arrangement** is the loss of generative behavior. The arrangement records a static snapshot of one possible outcome — the Follow Action logic itself is not preserved. Every recording produces a different result. Additionally, the "Back to Arrangement" button confusion persists during the recording workflow: after recording, accidentally launching a Session clip re-overrides the arrangement, requiring the button click again.

---

## Dual-mode scheduling architecture in Rust

### The per-track source multiplexer

The core abstraction is a **per-track state machine** that determines whether each track reads audio from the arrangement timeline or from a launched clip. Every track independently maintains this state:

```
States: ARRANGEMENT → LAUNCHER_QUEUED → LAUNCHER_PLAYING → STOPPED
                ↑                                              |
                └──────── (return to arrangement) ─────────────┘
```

The transitions: triggering a launcher clip moves the track to `LAUNCHER_QUEUED`; reaching the quantization boundary transitions to `LAUNCHER_PLAYING`; pressing stop moves to `STOPPED` (silence, not arrangement); and explicitly returning to arrangement restores `ARRANGEMENT` at the current transport position. The global transport position advances continuously regardless of individual track states — when a track returns to arrangement mode, it reads from wherever the transport currently sits, not from where it was interrupted.

This design matches Bitwig's per-track independence model (superior to Ableton's more global approach) while maintaining Ableton's priority semantics: launcher always overrides arrangement, and arrangement playback must be explicitly restored.

### Transport and beat position tracking

The audio engine maintains a monotonically increasing **global sample counter** (never resets, never loops — distinct from arrangement position, which can loop). From this counter, beat and bar positions are derived:

```
current_beat = global_sample_pos / (sample_rate * 60.0 / tempo)
current_bar = current_beat / beats_per_bar
```

For tempo changes, a **tempo map** (sorted list of `(beat_position, bpm)` entries) replaces the single-tempo formula. Beat-to-sample conversion integrates over tempo map segments. Fractional sample positions are tracked with `f64` precision to prevent drift over long playback sessions. A `MonotonicBeat` type (inspired by Tracktion Engine's design) provides a continuously-increasing beat counter independent of arrangement looping or position jumps.

### Quantization boundary detection within buffers

Each audio callback receives a buffer of N samples. The engine must detect whether any quantization boundary (beat, bar, N-bar phrase) falls within the current buffer. The algorithm:

1. Convert buffer start and end sample positions to beat positions
2. For each pending quantized event, check if its target beat falls within the buffer's beat range
3. Compute the exact sample offset within the buffer: `offset = beat_to_sample(target_beat) - buffer_start_sample`
4. **Split the buffer** at that offset: render the first portion from the old source, the second portion from the new source

This buffer-splitting approach is the industry standard (confirmed by Unreal Engine's Quartz system, VST3 architecture, and Tracktion Engine). A micro-crossfade of **32–64 samples** (~0.7–1.5ms at 44.1kHz) at the splice point prevents clicks. Equal-power crossfading (`cos(t·π/2)` and `sin(t·π/2)`) maintains perceived loudness across the transition.

### Three-thread architecture

Following the established DAW pattern (documented in Max/MSP's architecture, confirmed by ADC conference talks from Ableton and Tracktion engineers), the engine uses three threads:

- **Audio thread** (highest priority, real-time): Renders audio buffers only. Reads commands from lock-free queues. Detects quantization boundaries. Executes buffer splits. Writes metering data and state change notifications. Never allocates, never locks, never does I/O.
- **Scheduler thread** (high priority, not real-time): Evaluates Follow Action logic, resolves quantization targets, manages clip state transitions, handles scene launching coordination. Communicates with audio thread via lock-free SPSC queues. Reads the audio clock via a shared atomic sample counter.
- **UI/Tauri thread** (normal priority): Handles React IPC, user input, file I/O, state display. Forwards commands to scheduler via `tokio::sync::mpsc`. Receives state updates via Tauri Channels.

---

## IPC command flow from React to the audio thread

### The complete signal path

The path from a user click to sample-accurate clip playback traverses four stages with a total latency budget under **2ms** for the command path (well within perceptual thresholds):

```
React UI (click)
  │  invoke('launch_clip', { trackId: 0, clipId: 42, quantize: 'next_bar' })
  │  [~0.5ms: Tauri IPC, JSON serialization of small payload]
  ▼
Tauri async command handler (tokio thread pool)
  │  Deserializes to AudioCommand::LaunchClip
  │  Pushes to scheduler_tx: tokio::sync::mpsc::Sender<AudioCommand>
  │  [~μs: channel send]
  ▼
Scheduler thread (dedicated std::thread)
  │  Receives command, resolves quantize target to exact beat
  │  Pushes ScheduledLaunch { track, clip_id, target_beat } to audio SPSC queue
  │  [~ns: rtrb push]
  ▼
Audio thread (cpal callback)
  │  Drains SPSC queue, sets track state to QUEUED
  │  At quantization boundary sample offset: splits buffer, starts clip playback
  │  Pushes ClipStateChanged feedback to reverse SPSC queue
```

### Tauri v2 specifics

**Commands** (not events) should carry all audio commands from React to Rust. Tauri v2 commands offer strong typing via serde, ~0.5ms round-trip latency for small payloads, and binary data support via `ArrayBuffer`. Async commands (`#[tauri::command(async)]`) execute on the tokio thread pool, never blocking the Tauri main thread.

The Tauri `setup()` hook creates the audio engine, spawns the scheduler thread, and stores the command sender in managed state:

```rust
app.manage(AudioCommandSender(scheduler_tx.clone()));
```

Command handlers extract this sender and forward immediately:

```rust
#[tauri::command(async)]
async fn launch_clip(
    sender: State<'_, AudioCommandSender>,
    track_id: u8, clip_id: u64, quantize: String
) -> Result<(), String> {
    sender.0.send(AudioCommand::LaunchClip {
        track: track_id,
        clip_id: ClipId(clip_id),
        quantize: QuantizeTarget::from_str(&quantize),
    }).await.map_err(|e| e.to_string())
}
```

**For feedback (audio→UI)**, Tauri v2 **Channels** are the optimal choice. They're faster than events, provide ordering guarantees, and support streaming. The scheduler thread emits state updates through a Tauri Channel passed during initialization. Playback position, clip states, and metering data flow back to React at **60Hz** (matching UI frame rate), decimated from the audio callback rate.

### Lock-free crate selection

| Communication path               | Pattern           | Crate                      | Rationale                                                 |
| -------------------------------- | ----------------- | -------------------------- | --------------------------------------------------------- |
| Scheduler → Audio commands       | SPSC ring buffer  | **`rtrb`**                 | Wait-free, zero-allocation, 793K downloads, gold standard |
| Audio → Scheduler notifications  | SPSC ring buffer  | **`rtrb`**                 | Same — clip-end events, state changes                     |
| Audio → UI metering              | Triple buffer     | **`triple_buffer`**        | UI only needs latest values, tolerates skips              |
| Simple params (volume, pan)      | Atomic            | **`atomic_float`**         | Zero-overhead reads on audio thread                       |
| Large state (clip data, routing) | Deferred-drop Arc | **`basedrop::SharedCell`** | Prevents deallocation on audio thread                     |
| Audio I/O                        | Callback stream   | **`cpal`**                 | Cross-platform de facto standard                          |

The **`assert_no_alloc`** crate should wrap the entire audio callback during development to catch accidental heap allocations. The **`no_denormals`** crate prevents CPU slowdowns from denormalized floating-point values in DSP chains.

---

## Where Follow Action logic should execute

**The scheduler thread (Option C/D hybrid) is the correct placement.** This recommendation follows from three converging lines of evidence:

First, the **industry standard**: Max/MSP (which underlies Max for Live and is deeply integrated with Ableton's architecture) explicitly uses a three-thread model where the scheduler thread handles all timing-critical musical events at ~1ms intervals. The audio thread only renders samples. ADC conference talks from Ableton and Tracktion engineers consistently reinforce this separation.

Second, **the audio thread contract**: Follow Action evaluation requires probability computation (random number generation via the `rand` crate), clip state lookups, and potentially complex chaining logic. While individually trivial (~microseconds), these operations conceptually violate the audio thread's mandate of pure DSP computation. As features grow (conditional Follow Actions, cross-track coordination, MIDI-triggered actions), scheduler-thread placement scales cleanly; audio-thread placement accumulates risk.

Third, **the latency math**: Lock-free SPSC queue communication between scheduler and audio threads adds **sub-microsecond overhead**. The scheduler thread polls at 1ms intervals or wakes on audio-thread signals. Even in the worst case, this adds <1ms latency to Follow Action resolution — completely inaudible and well within the quantization window (typically a full bar at minimum).

The hybrid model works as follows: the audio thread detects that a clip has reached its Follow Action trigger point (a simple beat-position comparison, appropriate for the audio thread) and pushes a `FollowActionTriggered { track, clip_id, trigger_beat }` notification to the scheduler. The scheduler evaluates probability, selects the next action, resolves the quantized start beat, and pushes a `LaunchClip` command back to the audio thread. React receives display-only state updates via Tauri Channels showing which Follow Actions are active and what clips are queued.

---

## Data model for clips, scenes, launcher state, and the compiled schedule

### Core types

```rust
// === Identifiers ===
#[derive(Clone, Copy, Hash, Eq, PartialEq)]
struct ClipId(NonZeroU64);
type TrackIdx = u16;
type SceneIdx = u16;

// === Clip definition (owned by UI/scheduler, shared with audio via basedrop) ===
struct ClipData {
    id: ClipId,
    audio_buffer: basedrop::Shared<Vec<f32>>,  // interleaved stereo samples
    sample_rate: u32,
    length_beats: f64,          // musical length
    length_samples: u64,        // computed from length_beats + tempo at load time
    loop_enabled: bool,
    loop_start_beat: f64,       // loop region within clip
    loop_end_beat: f64,
    warp_markers: Vec<WarpMarker>,  // for time-stretching
}

// === Follow Action definition ===
struct FollowActionConfig {
    enabled: bool,
    linked: bool,               // true = fire at clip end; false = fire at fixed time
    action_a: FollowActionType,
    action_b: FollowActionType,
    chance_a: u8,               // 0-100 percent
    chance_b: u8,               // 0-100 percent
    time_bars: u16,             // for unlinked mode
    time_beats: u8,
    time_sixteenths: u8,
    loop_count: u16,            // for linked mode: play N loops before firing
    legato: bool,
}

enum FollowActionType {
    NoAction, Stop, Again, Previous, Next,
    First, Last, Any, Other,
    Jump(SceneIdx),             // target specific scene/slot
    ReturnToArrangement,        // Bitwig-inspired
}

// === Clip slot (one per track × scene intersection) ===
struct ClipSlot {
    clip: Option<ClipId>,
    has_stop_button: bool,      // Ableton-style: empty slots can stop or be ignored
    launch_quantize: QuantizeOverride,
    follow_action: FollowActionConfig,
    legato: bool,
    play_mode: PlayMode,        // Trigger, Gate, Retrigger, Repeat
}

enum QuantizeOverride {
    Global,                     // inherit from global setting
    Override(QuantizeValue),
}

enum QuantizeValue {
    None, ThirtySecond, Sixteenth, Eighth, Quarter,
    HalfBar, OneBar, TwoBars, FourBars, EightBars,
}

// === Scene ===
struct Scene {
    index: SceneIdx,
    name: String,
    tempo_override: Option<f64>,
    time_sig_override: Option<(u8, u8)>,
    follow_action: Option<FollowActionConfig>,  // scene-level Follow Action
}

// === Per-track launcher state (lives on scheduler thread) ===
struct TrackLauncherState {
    playback_source: PlaybackSource,
    active_clip: Option<ClipId>,
    queued_clip: Option<QueuedClip>,
    follow_action_beat: Option<f64>,  // beat at which next Follow Action fires
    loops_completed: u16,
}

enum PlaybackSource { Arrangement, Launcher, Stopped }

struct QueuedClip {
    clip_id: ClipId,
    target_beat: f64,           // exact beat to start playback
    legato_from: Option<f64>,   // if legato, inherit this playback position
}
```

### The compiled schedule format

The scheduler thread maintains a **pending event priority queue** sorted by target beat position. The audio thread receives pre-resolved, sample-stamped commands:

```rust
// What the scheduler pushes to the audio thread (via rtrb)
enum AudioThreadCommand {
    StartClip {
        track: TrackIdx,
        clip_id: ClipId,
        start_beat: f64,            // global beat position to begin
        clip_offset_beat: f64,      // position within clip to start from (legato)
    },
    StopClip {
        track: TrackIdx,
        stop_beat: f64,
    },
    SwitchToArrangement {
        track: TrackIdx,
        at_beat: f64,
    },
    SetTempo {
        bpm: f64,
        at_beat: f64,
    },
}

// What the audio thread pushes back (via rtrb)
enum AudioThreadEvent {
    ClipReachedFollowAction { track: TrackIdx, clip_id: ClipId, at_beat: f64 },
    ClipEnded { track: TrackIdx, clip_id: ClipId },
    ClipStartedPlaying { track: TrackIdx, clip_id: ClipId, at_beat: f64 },
    BeatTick { beat: f64 },  // decimated, for UI sync
}
```

The audio thread's per-track clip player is minimal: it maintains a read position in the clip's audio buffer, handles loop boundaries, and writes samples into the output buffer. All scheduling intelligence — Follow Action evaluation, quantization resolution, scene coordination — lives on the scheduler thread.

### Launcher matrix (shared state snapshot)

The full clip launcher state is represented as a `LauncherMatrix` that the scheduler owns and publishes to both the audio thread (via `basedrop::SharedCell` for clip data references) and the UI (via Tauri Channel serialization):

```rust
struct LauncherMatrix {
    tracks: Vec<TrackLauncher>,
    scenes: Vec<Scene>,
    global_quantize: QuantizeValue,
    follow_actions_enabled: bool,
}

struct TrackLauncher {
    slots: Vec<ClipSlot>,       // indexed by scene
    state: TrackLauncherState,
}
```

Edits from the UI (adding clips, changing Follow Action settings, rearranging scenes) flow through Tauri commands to the scheduler thread, which updates the matrix and publishes clip data changes to the audio thread via `basedrop::Shared` pointers — ensuring the audio thread never deallocates memory.

---

## Conclusion

The three commercial implementations converge on a shared architectural core — per-track source multiplexing between two sequencers sharing a single transport — but diverge meaningfully in UX sophistication. **Bitwig's per-track independence and simultaneous launcher/arranger visibility should be the baseline** for any new implementation, not Ableton's view-switching model. Ableton's dual-probability Follow Actions and scene-level Follow Actions should be adopted wholesale; Bitwig's Clip Blocks and "Return to Arrangement" action should supplement them. Logic Pro's absence of Follow Actions demonstrates that the feature is non-negotiable for serious use.

The Rust implementation maps cleanly onto a three-thread model: `cpal` audio callback for pure DSP, a scheduler thread for all musical intelligence (Follow Actions, quantization resolution, scene coordination), and Tauri's tokio pool for IPC bridging. The `rtrb` crate handles all lock-free inter-thread communication, `basedrop` prevents audio-thread deallocation, and Tauri v2's `invoke` commands provide typed, sub-millisecond IPC from React. Sample-accurate clip transitions require buffer splitting at quantization boundary sample offsets — a well-documented pattern with reference implementations in Tracktion Engine (open source) and Ardour's TriggerBox. The data model centers on a `LauncherMatrix` of `ClipSlot` values with pre-resolved `AudioThreadCommand` messages flowing through the SPSC queue, keeping the audio thread's responsibilities to the absolute minimum: read the command, find the buffer offset, split, render.

# Non-Linear Clip Launcher: Advanced Implementation Guide

**This document provides production-grade algorithms, data structures, and Rust pseudocode for the nine hardest unsolved problems in building a real-time clip launcher within a Tauri v2 DAW.** It targets AI coding agents and assumes familiarity with the architecture stack: cpal for audio I/O, rtrb for lock-free SPSC queues, basedrop for deferred deallocation, and Rubber Band Library via FFI for time-stretching. Every section covers the algorithm, the edge cases professional engines handle (drawn from Ardour's TriggerBox, Tracktion Engine, and observed Ableton/Bitwig behavior), and Rust pseudocode precise enough to implement against.

---

## 1. Multi-event buffer splitting when boundaries collide

A 512-sample audio buffer at 120 BPM / 44100 Hz spans roughly 0.7 beats. At high tempos or with per-clip quantization differences, **multiple quantization boundaries can land inside one buffer** — a clip end on sample 200, a scene launch on sample 200, and a follow-action on sample 387. The engine must process each sub-region with the correct clip state.

### How professional engines solve this

Ardour's `PluginInsert::automate_and_run()` implements the canonical approach: it collects every automation breakpoint inside the current buffer, sorts them, and calls `connect_and_run(bufs, nframes, offset)` for each sub-block. The **offset parameter** avoids any buffer copying — the same memory is addressed with a different start pointer and length. Tracktion Engine takes a coarser approach, splitting only at transport-level boundaries (loop points, tempo changes) rather than at individual events within a block. JUCE's `AudioProcessor` provides no built-in splitting at all — the `MidiBuffer` carries sample-accurate timestamps but the developer must implement sub-block iteration manually.

The pattern all converge on is: **sort, split, process sub-blocks in order, never copy the buffer**.

### The algorithm

```rust
/// Every event that can cause a state change mid-buffer.
#[derive(Clone)]
struct ScheduledEvent {
    sample_offset: u32,       // offset within the current buffer, 0..buffer_len
    priority: EventPriority,  // determines ordering when offsets collide
    payload: EventPayload,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum EventPriority {
    // Lower numeric value = higher priority (processed first at same sample)
    TransportStop   = 0,   // transport stop overrides everything
    SceneLaunch     = 1,   // user-initiated scene launch
    ClipStop        = 2,   // explicit clip stop
    ClipLaunch      = 3,   // user-initiated single clip launch
    FollowAction    = 4,   // automatic follow action
    LoopBoundary    = 5,   // clip loop wrap-around
}

enum EventPayload {
    LaunchClip { track_id: TrackId, clip_id: ClipId, mode: LaunchMode },
    StopClip { track_id: TrackId },
    SceneLaunch { scene_index: usize },
    FollowAction { track_id: TrackId, action: FollowActionKind },
    LoopWrap { track_id: TrackId },
    TransportStop,
}
```

The core splitting function runs on the audio thread inside cpal's callback:

```rust
fn process_buffer_with_events(
    output: &mut [f32],              // interleaved stereo output, len = buffer_len * 2
    buffer_len: u32,
    events: &mut Vec<ScheduledEvent>, // pre-sorted before this call
    tracks: &mut [TrackState],
) {
    // --- Step 1: Sort by (sample_offset ASC, priority ASC) ---
    events.sort_unstable_by(|a, b| {
        a.sample_offset.cmp(&b.sample_offset)
            .then(a.priority.cmp(&b.priority))
    });

    // --- Step 2: Split and process ---
    let mut cursor: u32 = 0;

    for event in events.iter() {
        let offset = event.sample_offset;

        // Process audio from cursor..offset (may be zero-length)
        if offset > cursor {
            let sub_len = offset - cursor;
            for track in tracks.iter_mut() {
                track.render_audio(output, cursor, sub_len);
            }
            cursor = offset;
        }

        // Apply the event at this exact sample
        apply_event(event, tracks);
    }

    // --- Step 3: Process the tail of the buffer ---
    if cursor < buffer_len {
        let sub_len = buffer_len - cursor;
        for track in tracks.iter_mut() {
            track.render_audio(output, cursor, sub_len);
        }
    }
}
```

### The degenerate case: events on the same sample

When a follow-action and a scene launch land on sample 200, **priority ordering determines which is applied first**. The audio sub-block between the two events has zero length, so no audio is rendered — only state changes. This is safe: `render_audio` with `sub_len == 0` should be a no-op. The priority enum above encodes Ableton's observed hierarchy: transport stop > scene launch > clip stop > clip launch > follow action > loop boundary.

**Critical rule**: when a scene launch and a follow action collide on the same sample, the scene launch wins because it is processed first (lower priority value). The follow action's `apply_event` implementation must check whether the track already received a launch command at this sample and skip itself if so:

```rust
fn apply_event(event: &ScheduledEvent, tracks: &mut [TrackState]) {
    match &event.payload {
        EventPayload::FollowAction { track_id, action } => {
            let track = &mut tracks[track_id.0];
            // Skip if a higher-priority event already changed this track's state
            // at this exact sample offset
            if track.last_event_sample == event.sample_offset
                && track.last_event_priority < event.priority
            {
                return; // scene launch already handled this track
            }
            track.execute_follow_action(action);
            track.last_event_sample = event.sample_offset;
            track.last_event_priority = event.priority;
        }
        EventPayload::SceneLaunch { scene_index } => {
            for track in tracks.iter_mut() {
                if let Some(clip_id) = track.scene_clip(*scene_index) {
                    track.queue_launch(clip_id, event.sample_offset);
                    track.last_event_sample = event.sample_offset;
                    track.last_event_priority = event.priority;
                }
            }
        }
        // ... other variants
    }
}
```

### Recursive splitting

True recursive splitting occurs when **processing a sub-block generates new events** — for example, rendering a clip discovers a loop boundary at sample 250 within a sub-block that runs from 200..400. The cleanest approach is **not** recursion but a two-phase model: first, **pre-scan** all tracks to discover every event in the buffer (loop boundaries are computable from clip position and tempo), collect them into the event list, sort once, then process. This avoids unbounded stack depth. Ardour uses this pre-scan approach: `TriggerBox::run()` calculates transition points before entering the render loop.

```rust
fn pre_scan_events(
    tracks: &[TrackState],
    buffer_start_beat: f64,
    buffer_end_beat: f64,
    buffer_len: u32,
    tempo_map: &TempoMap,
    pending_commands: &mut Vec<ScheduledEvent>,
) {
    for track in tracks {
        // Check for loop boundaries
        if let Some(clip) = track.playing_clip() {
            if let Some(loop_sample) = clip.next_loop_boundary_in_range(
                buffer_start_beat, buffer_end_beat, tempo_map
            ) {
                pending_commands.push(ScheduledEvent {
                    sample_offset: loop_sample,
                    priority: EventPriority::LoopBoundary,
                    payload: EventPayload::LoopWrap { track_id: track.id },
                });
            }
            // Check for follow-action trigger point
            if let Some(fa_sample) = clip.follow_action_trigger_in_range(
                buffer_start_beat, buffer_end_beat, tempo_map
            ) {
                pending_commands.push(ScheduledEvent {
                    sample_offset: fa_sample,
                    priority: EventPriority::FollowAction,
                    payload: EventPayload::FollowAction {
                        track_id: track.id,
                        action: clip.follow_action.clone(),
                    },
                });
            }
        }
    }
    // User-initiated launches arrive via rtrb from the UI thread
    while let Ok(cmd) = ui_command_consumer.pop() {
        pending_commands.push(cmd.into_scheduled_event(tempo_map, buffer_start_beat, buffer_len));
    }
}
```

---

## 2. Warp and time-stretch integration with Rubber Band

Rubber Band Library uses a **push-input / pull-output** model: you call `process()` to feed source samples, query `available()` to check output readiness, and call `retrieve()` to pull stretched frames. It is **not** a same-call in/out API. The `getSamplesRequired()` method tells you how many input frames to supply to guarantee some output becomes available. This entire flow is RT-safe in real-time mode (`OptionProcessRealTime`) with `OptionThreadingNever` — no allocation, no locking, no blocking after initialization.

### Latency characteristics

Rubber Band introduces a fixed start delay queryable via `getStartDelay()` (the deprecated `getLatency()` is an alias). **This delay is constant for a given engine/window/sample-rate configuration and does not vary with time ratio.** Typical values at 48 kHz: R2 default window = **1024 samples** (~21 ms), R2 short window = **512 samples** (~11 ms), R3 default window = **2048 samples** (~43 ms), R3 short window = **1280 samples** (~27 ms). Before first use, feed `getPreferredStartPad()` silent frames to prime internal buffers, then discard `getStartDelay()` frames from the output to achieve correct time alignment.

### Warp mode mappings to Rubber Band options

Each Ableton-style warp mode maps to a specific combination of Rubber Band flags. The R3 engine (`OptionEngineFiner`) ignores transient/detector/phase flags and manages them internally via multi-resolution analysis:

| Warp Mode       | Rubber Band Configuration                                                       |
| --------------- | ------------------------------------------------------------------------------- |
| **Beats**       | R2 + `TransientsCrisp` + `DetectorPercussive` + `WindowShort`                   |
| **Tones**       | R2 + `TransientsMixed` + `DetectorCompound` + `PhaseLaminar` + `WindowStandard` |
| **Texture**     | R2 + `TransientsSmooth` + `DetectorSoft` + `PhaseIndependent` + `WindowLong`    |
| **Complex**     | R3 + `ChannelsTogether` + `WindowStandard`                                      |
| **Complex Pro** | R3 + `ChannelsTogether` + `WindowShort` (draft/fast R3 mode)                    |

SoundTouch uses time-domain WSOLA (overlap-add) rather than a phase vocoder. It runs at roughly **3× less CPU** than Rubber Band R2 but has no transient detection — drums are doubled or smeared. It accepts interleaved samples via `putSamples()`/`receiveSamples()`. For a DAW, SoundTouch is appropriate only as a "Re-Pitch"-adjacent lightweight mode; Rubber Band is required for production-quality stretching.

### The warp-aware clip player

A `WarpMap` is a sorted list of `(beat_position, source_sample_position)` pairs. Between any two adjacent markers, the mapping is **piecewise linear**: for beat `t` in `[beat_a, beat_b]`, `source_sample = sample_a + (t - beat_a) * (sample_b - sample_a) / (beat_b - beat_a)`. The local stretch ratio at any point is `(sample_b - sample_a) / (beat_b - beat_a) / samples_per_beat_at_project_tempo`.

```rust
struct WarpMarker {
    beat_pos: f64,      // position in clip-local beat time
    sample_pos: f64,    // position in source audio samples
}

struct WarpMap {
    markers: Vec<WarpMarker>, // sorted by beat_pos, minimum 2 entries
}

impl WarpMap {
    /// Piecewise linear interpolation: beat position -> source sample position
    fn beat_to_source_sample(&self, beat: f64) -> f64 {
        // Find the segment containing this beat
        let idx = self.markers.partition_point(|m| m.beat_pos <= beat).saturating_sub(1);
        let idx = idx.min(self.markers.len() - 2);
        let a = &self.markers[idx];
        let b = &self.markers[idx + 1];
        let t = (beat - a.beat_pos) / (b.beat_pos - a.beat_pos);
        a.sample_pos + t * (b.sample_pos - a.sample_pos)
    }

    /// Returns the local time-stretch ratio for a given beat position.
    /// ratio > 1.0 means audio is being slowed down (stretched).
    fn local_time_ratio(&self, beat: f64, project_samples_per_beat: f64) -> f64 {
        let idx = self.markers.partition_point(|m| m.beat_pos <= beat).saturating_sub(1);
        let idx = idx.min(self.markers.len() - 2);
        let a = &self.markers[idx];
        let b = &self.markers[idx + 1];
        let source_samples_per_beat = (b.sample_pos - a.sample_pos) / (b.beat_pos - a.beat_pos);
        // ratio = stretched_duration / original_duration
        // If source has 22050 samples/beat and project expects 24000 samples/beat,
        // we need to stretch: ratio = 24000/22050 ≈ 1.088
        project_samples_per_beat / source_samples_per_beat
    }
}
```

The clip player drives Rubber Band on the audio thread:

```rust
struct WarpedClipPlayer {
    stretcher: RubberBandState,  // opaque FFI handle
    warp_map: WarpMap,
    source_audio: AudioBuffer,   // de-interleaved [channel][samples]
    current_beat: f64,           // playback position in clip-local beat time
    start_delay: u32,            // from getStartDelay(), frames to discard
    delay_remaining: u32,        // frames still to discard after priming
    primed: bool,
    warp_mode: WarpMode,
}

impl WarpedClipPlayer {
    fn prime(&mut self) {
        let pad = rubberband_get_preferred_start_pad(self.stretcher);
        let silence = vec![0.0f32; pad as usize];
        let ptrs: Vec<*const f32> = (0..self.channels())
            .map(|_| silence.as_ptr())
            .collect();
        rubberband_process(self.stretcher, ptrs.as_ptr(), pad, 0);
        self.delay_remaining = rubberband_get_start_delay(self.stretcher);
        self.primed = true;
    }

    /// Called from audio callback. Fills `output` with `num_frames` of stretched audio.
    fn render(
        &mut self,
        output: &mut [&mut [f32]],  // de-interleaved [channel][num_frames]
        num_frames: u32,
        project_samples_per_beat: f64,
    ) {
        if !self.primed {
            self.prime();
        }

        let mut frames_written: u32 = 0;

        while frames_written < num_frames {
            // --- Pull any available output from Rubber Band ---
            let avail = rubberband_available(self.stretcher);
            if avail > 0 {
                let to_retrieve = avail.min((num_frames - frames_written) as i32) as u32;

                if self.delay_remaining > 0 {
                    // Discard start-delay frames
                    let discard = to_retrieve.min(self.delay_remaining);
                    let mut trash: Vec<Vec<f32>> = (0..self.channels())
                        .map(|_| vec![0.0; discard as usize])
                        .collect();
                    let ptrs: Vec<*mut f32> = trash.iter_mut().map(|v| v.as_mut_ptr()).collect();
                    rubberband_retrieve(self.stretcher, ptrs.as_ptr(), discard);
                    self.delay_remaining -= discard;
                    continue;
                }

                // Write to output buffer
                let out_ptrs: Vec<*mut f32> = output.iter_mut()
                    .map(|ch| unsafe { ch.as_mut_ptr().add(frames_written as usize) })
                    .collect();
                let got = rubberband_retrieve(
                    self.stretcher, out_ptrs.as_ptr(), to_retrieve
                );
                frames_written += got;
                continue;
            }

            // --- Push source audio into Rubber Band ---
            let required = rubberband_get_samples_required(self.stretcher);
            if required == 0 { continue; }

            // Update the time ratio based on current warp map position
            let ratio = self.warp_map.local_time_ratio(
                self.current_beat, project_samples_per_beat
            );
            rubberband_set_time_ratio(self.stretcher, ratio);

            // Read source samples from warp map position
            let source_sample = self.warp_map.beat_to_source_sample(self.current_beat);
            let src_start = source_sample.round() as usize;
            let src_end = (src_start + required as usize)
                .min(self.source_audio.num_frames());

            let actual_frames = (src_end - src_start) as u32;
            let is_final = src_end >= self.source_audio.num_frames();

            let src_ptrs: Vec<*const f32> = (0..self.channels())
                .map(|ch| unsafe {
                    self.source_audio.channel(ch).as_ptr().add(src_start)
                })
                .collect();

            rubberband_process(
                self.stretcher,
                src_ptrs.as_ptr(),
                actual_frames,
                is_final as i32,
            );

            // Advance beat position by the number of source samples consumed
            // converted back to beats via the inverse warp map
            let source_advance = actual_frames as f64;
            let beats_per_source_sample = 1.0
                / ((self.warp_map.local_source_samples_per_beat(self.current_beat)));
            self.current_beat += source_advance * beats_per_source_sample;
        }
    }
}
```

### Loop boundary handling

**Calling `reset()` at loop points is recommended** but has a cost: the stretcher must be re-primed with `getPreferredStartPad()` silent frames and `getStartDelay()` output frames must be discarded again. For short loops (< 1 bar), this overhead is audible. The practical solution is a **crossfade at the loop boundary**: maintain two stretcher instances, fade out the ending instance over ~5 ms, and fade in the new instance starting from the loop start. Alternatively, if the loop is seamless (loop end sample == loop start sample in the source), skip the reset entirely and feed the loop-start audio directly — the stretcher's phase continuity will handle it, though minor artifacts may appear on non-seamless content.

---

## 3. Legato position inheritance across tempo-warped clips

Ableton's Legato mode inherits position in **beat time, not sample time**. When clip B launches in Legato mode while clip A is playing, the engine reads clip A's current beat position, then maps that beat position through clip B's warp map to find the correct source sample offset. This is critical: two clips with different warp maps will map the same beat position to completely different source samples.

### The algorithm

```rust
fn legato_launch(
    outgoing: &WarpedClipPlayer,
    incoming_clip: &ClipData,
    incoming_warp_map: &WarpMap,
    stretcher: &mut RubberBandState,
) -> WarpedClipPlayer {
    // Step 1: Read outgoing clip's current beat position
    let current_beat = outgoing.current_beat;

    // Step 2: Clamp to incoming clip's beat range
    // (if outgoing played longer than incoming's length, wrap into loop)
    let incoming_length_beats = incoming_clip.loop_length_beats();
    let target_beat = if incoming_clip.is_looping {
        current_beat % incoming_length_beats
    } else {
        // For non-looping clips, clamp — clip may immediately stop
        // if current_beat exceeds its length
        current_beat.min(incoming_length_beats)
    };

    // Step 3: Map beat position through incoming clip's warp map
    let source_sample = incoming_warp_map.beat_to_source_sample(target_beat);

    // Step 4: Reset the stretcher and re-prime from the new position
    rubberband_reset(*stretcher);

    let mut player = WarpedClipPlayer {
        stretcher: *stretcher,
        warp_map: incoming_warp_map.clone(),
        source_audio: incoming_clip.audio.clone(),
        current_beat: target_beat,
        start_delay: rubberband_get_start_delay(*stretcher),
        delay_remaining: 0,
        primed: false,
        warp_mode: incoming_clip.warp_mode,
    };

    player.prime(); // feeds silent padding, sets delay_remaining
    player
}
```

### Edge cases in legato inheritance

**Non-looping incoming clip shorter than current position**: If the outgoing clip has been playing for 16 beats and the incoming clip is only 8 beats long (non-looping), the incoming clip is at beat 16 — past its end. Ableton effectively stops the clip immediately. The implementation should detect `target_beat >= incoming_length_beats` for non-looping clips and either stop or clamp to the last sample.

**RAM mode requirement**: Legato with warped clips jumps to an arbitrary source sample position. If audio is streamed from disk, this position has not been pre-fetched. Ableton warns users to enable "Clip RAM Mode" to avoid dropouts. The Tauri DAW should either load entire clips into memory (practical for clips < 100 MB) or implement a pre-fetch ring buffer with a fallback silence strategy when the read head jumps unpredictably.

**Warp must be enabled**: Legato requires a beat-time coordinate system. Without warp, there is no beat-to-sample mapping, and the engine should fall back to raw sample position inheritance or refuse the legato launch.

---

## 4. MIDI clip launching: stuck notes, CC continuity, pedal state

MIDI clip transitions in a clip launcher are more error-prone than audio transitions because **MIDI state is cumulative** — a note-on without a matching note-off creates a stuck note. Professional DAWs use fundamentally different strategies here.

### Active note tracking

Bitwig's approach is the safest for clip launchers: **notes are hard-cut at clip boundaries and cannot sustain beyond them**. Ableton tracks active notes internally and sends note-offs at transitions, but still sends CC 123 (All Notes Off) as a safety net on transport stop. The hybrid approach is best: track individual active notes for precision, send All Notes Off as fallback.

```rust
/// Per-track MIDI state tracker, lives on the audio thread.
struct MidiStateTracker {
    /// Bitfield: active_notes[channel][note] = velocity (0 = off)
    active_notes: [[u8; 128]; 16],

    /// Last known CC value per channel per CC number
    cc_values: [[u8; 128]; 16],

    /// Sustain pedal state per channel (CC 64)
    sustain_down: [bool; 16],

    /// Pitch bend per channel (14-bit, center = 8192)
    pitch_bend: [u16; 16],
}

impl MidiStateTracker {
    fn note_on(&mut self, channel: u8, note: u8, velocity: u8) {
        self.active_notes[channel as usize][note as usize] = velocity;
    }

    fn note_off(&mut self, channel: u8, note: u8) {
        self.active_notes[channel as usize][note as usize] = 0;
    }

    fn cc(&mut self, channel: u8, cc: u8, value: u8) {
        self.cc_values[channel as usize][cc as usize] = value;
        if cc == 64 {
            self.sustain_down[channel as usize] = value >= 64;
        }
    }

    /// Generate all note-offs and CC resets for a clean transition.
    /// Returns MIDI messages to send BEFORE starting the new clip.
    fn generate_cleanup_messages(&self) -> Vec<MidiMessage> {
        let mut msgs = Vec::new();

        for ch in 0..16u8 {
            // Individual note-offs (more reliable than CC 123 with hardware)
            for note in 0..128u8 {
                if self.active_notes[ch as usize][note as usize] > 0 {
                    msgs.push(MidiMessage::NoteOff { channel: ch, note, velocity: 0 });
                }
            }

            // Reset sustain pedal if it was down
            if self.sustain_down[ch as usize] {
                msgs.push(MidiMessage::CC { channel: ch, cc: 64, value: 0 });
            }

            // Reset pitch bend to center
            if self.pitch_bend[ch as usize] != 8192 {
                msgs.push(MidiMessage::PitchBend { channel: ch, value: 8192 });
            }

            // Safety net: All Notes Off
            msgs.push(MidiMessage::CC { channel: ch, cc: 123, value: 0 });
        }

        msgs
    }

    /// Clear all tracked state after sending cleanup messages.
    fn reset(&mut self) {
        self.active_notes = [[0; 128]; 16];
        self.cc_values = [[0; 128]; 16];
        self.sustain_down = [false; 16];
        self.pitch_bend = [8192; 16];
    }
}
```

### CC continuity and the chase problem

Ableton **does not implement CC chase** — this is a documented, longstanding omission. When a clip starts mid-way through, CC values only take effect when the playhead crosses an actual CC event. Cubase and Logic both offer configurable CC chase. The correct implementation for a new DAW: when launching a clip or seeking to a position within one, **scan backward from the play position to find the most recent value of every active CC, pitch bend, and program change**, then emit those values before the first note:

```rust
fn chase_cc_values(
    clip: &MidiClip,
    start_beat: f64,
) -> Vec<MidiMessage> {
    let mut last_cc: HashMap<(u8, u8), u8> = HashMap::new(); // (channel, cc) -> value
    let mut last_pb: HashMap<u8, u16> = HashMap::new();       // channel -> value
    let mut msgs = Vec::new();

    // Scan all events before start_beat, keeping only the latest of each type
    for event in clip.events.iter() {
        if event.beat_pos >= start_beat { break; }
        match &event.message {
            MidiMessage::CC { channel, cc, value } => {
                last_cc.insert((*channel, *cc), *value);
            }
            MidiMessage::PitchBend { channel, value } => {
                last_pb.insert(*channel, *value);
            }
            _ => {}
        }
    }

    // Emit chased values
    for ((ch, cc), val) in &last_cc {
        msgs.push(MidiMessage::CC { channel: *ch, cc: *cc, value: *val });
    }
    for (ch, val) in &last_pb {
        msgs.push(MidiMessage::PitchBend { channel: *ch, value: *val });
    }
    msgs
}
```

### MIDI clip looping

At the loop boundary, **all active notes must receive note-offs**, and notes starting at beat 0 of the loop must receive fresh note-ons. The danger is ordering: if note-offs and note-ons are processed at the same sample, some synths will ignore the note-on (interpreting it as a re-trigger while the note-off hasn't been processed). Tracktion Engine documented this exact bug — loop-restart note-ons were being "eaten" by simultaneous note-offs. The solution: **process note-offs one sample before the loop boundary**, or ensure note-offs are sent to the MIDI buffer at `sample_offset` and note-ons at `sample_offset + 1`. One sample of latency is inaudible but prevents the race.

```rust
fn handle_midi_loop_boundary(
    tracker: &mut MidiStateTracker,
    clip: &MidiClip,
    loop_sample_offset: u32,
    midi_output: &mut MidiBuffer,
) {
    // Step 1: Kill all active notes at loop_sample_offset
    let cleanup = tracker.generate_cleanup_messages();
    for msg in cleanup {
        midi_output.push(loop_sample_offset, msg);
    }
    tracker.reset();

    // Step 2: Chase CC state from the start of the clip
    let cc_chase = chase_cc_values(clip, 0.0);
    for msg in cc_chase {
        midi_output.push(loop_sample_offset + 1, msg); // +1 sample offset
    }

    // Step 3: Fire note-ons for notes that begin at beat 0
    for event in clip.events.iter() {
        if event.beat_pos > 0.0 { break; }
        if let MidiMessage::NoteOn { .. } = &event.message {
            midi_output.push(loop_sample_offset + 1, event.message.clone());
            tracker.track_message(&event.message);
        }
    }
}
```

---

## 5. basedrop SharedCell lifecycle and the drop-thread pattern

The basedrop crate (by Micah Johnston, crates.io v0.1.3) solves the core real-time audio memory problem: **the audio thread must never deallocate**. basedrop's `Shared<T>` is like `Arc<T>` except when the reference count drops to zero, instead of immediately freeing, it pushes the allocation onto a wait-free MPSC linked-list queue. The queue node is **pre-allocated inline** alongside the data at `Shared::new()` time, so the drop operation involves zero allocator calls. A `Collector` on a separate thread periodically drains this queue and actually frees memory.

### The complete setup pattern

```rust
use basedrop::{Collector, Handle, Shared, SharedCell};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// The immutable state snapshot read by the audio thread.
struct EngineState {
    tracks: Vec<TrackData>,
    tempo_bpm: f64,
    // ... all clip data, warp maps, etc.
}

fn setup_audio_engine() {
    // 1. Create the garbage collector
    let collector = Collector::new();

    // 2. Create initial state wrapped in Shared
    let initial_state = Shared::new(
        &collector.handle(),
        EngineState {
            tracks: vec![],
            tempo_bpm: 120.0,
        },
    );

    // 3. Create the SharedCell — the atomic swap point
    //    Wrap in Arc because cpal's callback needs 'static ownership
    let cell = Arc::new(SharedCell::new(initial_state));

    // 4. Clone for audio thread
    let cell_audio = Arc::clone(&cell);

    // 5. Spawn the dedicated drop/GC thread
    let collector_handle = collector.handle();
    thread::Builder::new()
        .name("audio-gc".to_string())
        .spawn(move || {
            loop {
                // Collector::collect() is not exposed publicly;
                // dropping old Shared values happens via the MPSC queue.
                // The collector must be kept alive; its Drop impl
                // processes remaining items.
                thread::sleep(Duration::from_millis(50));
                // In practice, the collector auto-processes when
                // the handle creates new Shared values, or you hold
                // the collector on this thread and let basedrop's
                // internal queue drain.
            }
        })
        .unwrap();

    // 6. Build cpal output stream
    let host = cpal::default_host();
    let device = host.default_output_device().unwrap();
    let config = device.default_output_config().unwrap();

    let stream = device.build_output_stream(
        &config.into(),
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            // --- AUDIO THREAD: RT-safe reads only ---
            let state: Shared<EngineState> = cell_audio.get(); // lock-free
            render_audio(&state, data);
            // When `state` is dropped here, if refcount -> 0,
            // it's pushed to the collector queue (wait-free, no alloc)
        },
        |err| eprintln!("audio error: {err}"),
        None,
    ).unwrap();

    stream.play().unwrap();

    // 7. UI thread publishes updates via SharedCell::set()
    let cell_ui = Arc::clone(&cell);
    let handle = collector.handle(); // for allocating new Shared values
    // On user action (e.g., clip edit, warp marker change):
    // let new_state = Shared::new(&handle, updated_engine_state);
    // cell_ui.set(new_state);
    // The old state is dropped by the audio thread or GC thread — never blocking.
}
```

### How SharedCell works internally

`SharedCell::get()` (the reader/audio-thread path) does: `fetch_add` on a reader counter, load the atomic pointer, clone the `Shared` (incrementing its refcount), `fetch_sub` the reader counter. This is non-blocking for readers. `SharedCell::replace()` (the writer/UI-thread path) does: atomic pointer swap, then **spins** until the reader counter hits zero, then returns the old `Shared`. The spin is on the writer side (UI thread), which is acceptable — the audio thread's critical section (between `fetch_add` and `fetch_sub`) is nanoseconds.

### cpal callback ownership gotcha

cpal's `build_output_stream` requires `FnMut + Send + 'static`. The `Collector` itself cannot be moved into the callback — it must live on the GC thread. The `SharedCell` must be wrapped in `Arc` to share between the UI thread and the `move` closure. If cpal drops the stream (and thus the closure), any `Shared` values captured inside are dropped on whatever thread cpal uses for cleanup. Because basedrop defers deallocation to the collector queue, this is safe — the actual `free()` never happens on the audio thread even during teardown.

### Alternatives assessment

**arc-swap** (`ArcSwap<T>`): Lock-free reads, but dropping the old `Arc` can trigger deallocation on the audio thread — **not RT-safe** without an additional deferred-drop mechanism. Unsuitable without modification.

**triple_buffer**: Wait-free for both reader and writer. Excellent for fixed-size, frequently-updated state (e.g., a parameter snapshot struct). Cannot handle dynamically-sized data (clip audio, MIDI event lists) without boxing. Best used alongside basedrop for small, hot parameter state.

**llq** (by the same author): The spiritual successor to basedrop's internal queue, extracted as a standalone wait-free SPSC linked-list queue with recyclable nodes. More flexible than basedrop's opinionated API. Consider using llq directly if basedrop's `Shared`/`SharedCell` API is too rigid.

---

## 6. Recording launcher performances to the arrangement timeline

When a user records a Session performance into the Arrangement, the DAW must log every clip state change with sample-accurate arrangement positions and then "flatten" the log into arrangement clip references. Ableton's manual confirms: **no new audio data is created** — arrangement clips are references to the same underlying audio/MIDI data as Session clips, with a start offset. Follow Action randomness is recorded as its **deterministic outcome** (which clip actually played), not the intent. Bitwig goes further by preserving the random seed so the exact randomized result is reproducible.

### The event log data structure

```rust
/// Logged on the audio thread into a lock-free ring buffer (rtrb).
/// The UI thread drains this buffer and builds the arrangement.
#[derive(Clone, Debug)]
struct PerformanceEvent {
    /// Arrangement timeline position in beats (absolute, from project start)
    arrangement_beat: f64,
    /// Track this event occurred on
    track_id: TrackId,
    /// What happened
    kind: PerformanceEventKind,
}

#[derive(Clone, Debug)]
enum PerformanceEventKind {
    /// A clip started playing
    ClipStart {
        clip_id: ClipId,
        /// Offset into the clip's content (beats from clip start).
        /// Non-zero when clip was already mid-playback at recording start,
        /// or when launched in Legato mode.
        clip_offset_beats: f64,
        /// The clip's loop state at launch time
        looping: bool,
    },
    /// A clip stopped (explicit stop, or replaced by another clip)
    ClipStop {
        clip_id: ClipId,
    },
    /// Track went silent (no clip playing)
    TrackSilence,
}
```

### The flattening algorithm

```rust
struct ArrangementClipRef {
    track_id: TrackId,
    clip_id: ClipId,           // references the Session clip data
    arrangement_start: f64,     // beat position on the arrangement timeline
    arrangement_end: f64,       // beat position where this clip stops
    clip_content_offset: f64,   // where in the clip's content playback started
    looping: bool,
}

fn flatten_performance_log(
    events: &[PerformanceEvent],
    recording_start_beat: f64,
    recording_end_beat: f64,
) -> Vec<ArrangementClipRef> {
    let mut result = Vec::new();
    // Track the currently-playing clip per track
    let mut active: HashMap<TrackId, (ClipId, f64, f64, bool)> = HashMap::new();
    // (clip_id, arrangement_start, clip_offset, looping)

    for event in events {
        if event.arrangement_beat < recording_start_beat
            || event.arrangement_beat > recording_end_beat
        {
            continue;
        }

        match &event.kind {
            PerformanceEventKind::ClipStart {
                clip_id, clip_offset_beats, looping
            } => {
                // Close any previously active clip on this track
                if let Some((prev_id, start, offset, was_looping)) =
                    active.remove(&event.track_id)
                {
                    result.push(ArrangementClipRef {
                        track_id: event.track_id,
                        clip_id: prev_id,
                        arrangement_start: start,
                        arrangement_end: event.arrangement_beat,
                        clip_content_offset: offset,
                        looping: was_looping,
                    });
                }
                // Open new active clip
                active.insert(
                    event.track_id,
                    (*clip_id, event.arrangement_beat, *clip_offset_beats, *looping),
                );
            }

            PerformanceEventKind::ClipStop { .. }
            | PerformanceEventKind::TrackSilence => {
                // Close the active clip, leaving a gap
                if let Some((prev_id, start, offset, was_looping)) =
                    active.remove(&event.track_id)
                {
                    result.push(ArrangementClipRef {
                        track_id: event.track_id,
                        clip_id: prev_id,
                        arrangement_start: start,
                        arrangement_end: event.arrangement_beat,
                        clip_content_offset: offset,
                        looping: was_looping,
                    });
                }
            }
        }
    }

    // Close any clips still active at recording end
    for (track_id, (clip_id, start, offset, looping)) in active {
        result.push(ArrangementClipRef {
            track_id,
            clip_id,
            arrangement_start: start,
            arrangement_end: recording_end_beat,
            clip_content_offset: offset,
            looping,
        });
    }

    result
}
```

### Edge cases

**Clips playing before recording started**: When the user presses Arrangement Record, the engine must snapshot every currently-playing clip and emit a synthetic `ClipStart` event at `recording_start_beat` with the current clip offset. This is the `clip_offset_beats` field — it captures where in the clip's content the playback was at the moment recording began.

**Gaps**: When a track has no playing clip, no `ArrangementClipRef` is created for that time region. The arrangement simply has empty space on that track — silence.

**Overlapping launches on the same track**: Impossible by design. Only one clip plays per track at any time. A new launch closes the old clip first (via `ClipStop`) then opens the new one. The flattening algorithm handles this naturally because `active` only holds one entry per track.

**Follow Action randomness**: The audio thread resolves the random selection and logs the _actual clip that launched_. The arrangement contains deterministic clip references. Bitwig's seed-preservation approach can be added by storing the seed in the `PerformanceEvent`:

```rust
ClipStart {
    clip_id: ClipId,
    clip_offset_beats: f64,
    looping: bool,
    random_seed: Option<u64>, // Bitwig-style: preserves reproducibility
}
```

---

## 7. Cross-track scene launch coordination with per-clip quantization

When a scene is launched, **it fires individual clip launches on every track simultaneously — but each clip then quantizes independently to its own launch quantization setting.** Neither Ableton nor Bitwig provides a scene-level quantization override. This means clips in the same scene can start at different times if they have different per-clip quantization values. This is the intended behavior, confirmed across official documentation and user forums.

### The scheduler algorithm

```rust
struct ClipSlot {
    clip_id: Option<ClipId>,
    /// Per-clip launch quantization. None means "use global".
    launch_quantize: Option<QuantizeInterval>,
}

#[derive(Clone, Copy)]
enum QuantizeInterval {
    None,           // immediate launch
    Beat(f64),      // e.g., 0.25 = 1/16th note, 1.0 = 1 beat, 4.0 = 1 bar
    Global,         // inherit from global setting
}

struct PendingLaunch {
    track_id: TrackId,
    clip_id: ClipId,
    target_beat: f64,  // resolved quantization target on the timeline
    launch_mode: LaunchMode,
}

fn resolve_scene_launch(
    scene_index: usize,
    tracks: &[Track],
    current_beat: f64,
    global_quantize: QuantizeInterval,
    tempo_map: &TempoMap,
) -> Vec<PendingLaunch> {
    let mut launches = Vec::new();

    for track in tracks {
        let slot = &track.slots[scene_index];

        // Skip empty slots — they do NOT stop the track
        // (Ableton: empty slots in a scene do not stop that track)
        let clip_id = match slot.clip_id {
            Some(id) => id,
            None => continue,  // track continues whatever it was doing
        };

        // Resolve quantization
        let quantize = match slot.launch_quantize {
            Some(QuantizeInterval::Global) | None => global_quantize,
            Some(q) => q,
        };

        let target_beat = match quantize {
            QuantizeInterval::None => current_beat, // immediate
            QuantizeInterval::Beat(interval) => {
                // Next boundary: ceil(current_beat / interval) * interval
                let next = (current_beat / interval).ceil() * interval;
                // If we're exactly on a boundary, use the NEXT one
                // (prevents re-triggering on the current boundary)
                if (next - current_beat).abs() < 1e-9 {
                    next + interval
                } else {
                    next
                }
            }
            QuantizeInterval::Global => current_beat, // shouldn't reach here
        };

        launches.push(PendingLaunch {
            track_id: track.id,
            clip_id,
            target_beat,
            launch_mode: slot.launch_mode(),
        });
    }

    launches
}
```

### Handling "None" quantization clips in a scene

When some clips have `QuantizeInterval::None`, they launch immediately at `current_beat` while other clips in the same scene wait for their quantization boundary. This is Ableton's confirmed behavior. The scheduler converts each launch into a `PendingLaunch` with a different `target_beat`. In the audio callback's event pre-scan, pending launches whose `target_beat` falls within the current buffer are promoted to `ScheduledEvent`s with the appropriate `sample_offset`.

```rust
fn promote_pending_launches(
    pending: &mut Vec<PendingLaunch>,
    buffer_start_beat: f64,
    buffer_end_beat: f64,
    buffer_len: u32,
    tempo_map: &TempoMap,
) -> Vec<ScheduledEvent> {
    let mut events = Vec::new();
    pending.retain(|launch| {
        if launch.target_beat >= buffer_start_beat
            && launch.target_beat < buffer_end_beat
        {
            let sample_offset = tempo_map.beat_to_sample_offset(
                launch.target_beat, buffer_start_beat, buffer_len
            );
            events.push(ScheduledEvent {
                sample_offset,
                priority: EventPriority::ClipLaunch,
                payload: EventPayload::LaunchClip {
                    track_id: launch.track_id,
                    clip_id: launch.clip_id,
                    mode: launch.launch_mode,
                },
            });
            false // remove from pending
        } else {
            true // keep waiting
        }
    });
    events
}
```

### Empty slots in a scene launch

**Critical design choice**: Ableton's behavior is that empty slots in a scene launch **do nothing** — they don't stop the track. If you want a track to stop when a scene is launched, you must explicitly place a "Stop" button in that slot. Implement this by treating `clip_id: None` as a no-op in `resolve_scene_launch`, as shown above. Provide a separate `StopSlot` variant if the user explicitly marks a slot as a stop command:

```rust
enum SlotContent {
    Empty,                        // do nothing on scene launch
    Clip(ClipId),                 // launch this clip
    Stop,                         // stop the track (user-placed stop button)
}
```

---

## 8. Undo/redo with a live audio engine

When a user undoes a clip edit while that clip is playing, the audio engine must seamlessly swap to the previous clip data without glitching. DAWs universally treat undo as a **document-model operation** that produces a new state snapshot — the audio engine is not aware of "undo" per se; it simply receives a new state.

### The basedrop swap pattern for live clip replacement

The undo system lives on the UI thread. It maintains a stack of `EngineState` snapshots (or, more practically, a command-pattern stack that can reconstruct any state). On undo, the UI thread builds the restored state, wraps it in `Shared::new()`, and publishes it via `SharedCell::set()`. The audio thread picks it up on the next buffer boundary — typically within **~11 ms at 512 samples / 48 kHz**.

```rust
struct UndoStack {
    states: Vec<UndoCommand>,
    cursor: usize,
    handle: basedrop::Handle,
    cell: Arc<SharedCell<EngineState>>,
}

impl UndoStack {
    fn undo(&mut self) {
        if self.cursor == 0 { return; }
        self.cursor -= 1;

        // Reconstruct the state at this cursor position
        let restored_state = self.rebuild_state_at(self.cursor);

        // Publish to the audio thread via basedrop
        let new_shared = Shared::new(&self.handle, restored_state);
        self.cell.set(new_shared);
        // Old state is deferred-dropped via the collector — never on the audio thread
    }
}
```

### Rubber Band stretcher state on undo

When the undo changes warp markers, the time-stretch ratio changes. Two strategies:

**Strategy A: Reset the stretcher.** Call `rubberband_reset()`, re-prime, and continue from the current beat position with the new warp map. This produces a brief discontinuity (the re-priming silence/delay) but guarantees correct output. Suitable when warp marker changes are significant.

**Strategy B: Continue without reset.** Simply update the `WarpMap` pointer and call `rubberband_set_time_ratio()` with the new ratio on the next `process()` call. Rubber Band smoothly transitions to the new ratio. This avoids discontinuity but may produce artifacts if the ratio change is dramatic. Suitable for small warp marker adjustments.

The implementation should choose based on the magnitude of change:

```rust
fn hot_swap_clip_data(
    player: &mut WarpedClipPlayer,
    new_clip: &ClipData,
    new_warp_map: WarpMap,
) {
    let old_ratio = player.warp_map.local_time_ratio(
        player.current_beat, player.project_samples_per_beat
    );
    let new_ratio = new_warp_map.local_time_ratio(
        player.current_beat, player.project_samples_per_beat
    );

    player.source_audio = new_clip.audio.clone();
    player.warp_map = new_warp_map;

    let ratio_change = (new_ratio - old_ratio).abs() / old_ratio;

    if ratio_change > 0.2 {
        // Major change (>20% ratio shift): reset stretcher
        rubberband_reset(player.stretcher);
        player.primed = false;
        // prime() will be called on next render()
    } else {
        // Minor change: smoothly update ratio, no reset
        rubberband_set_time_ratio(player.stretcher, new_ratio);
    }
}
```

### Undo changes clip length while looping

If the clip was 8 bars and the undo restores it to 4 bars, but the current beat position is at bar 6, the engine must wrap: `current_beat = current_beat % new_loop_length`. This is handled in the hot-swap path:

```rust
fn handle_length_change(player: &mut WarpedClipPlayer, new_loop_length_beats: f64) {
    if player.current_beat >= new_loop_length_beats {
        if player.is_looping {
            player.current_beat = player.current_beat % new_loop_length_beats;
        } else {
            // Non-looping clip: we're past the end, stop playback
            player.state = PlayState::Stopped;
        }
    }
}
```

---

## 9. The degenerate timing edge cases

These edge cases are easy to miss during implementation but cause hard-to-reproduce bugs in production. Each is specified with the resolution rule and rationale.

### Follow Action fires at exact same beat as user scene launch

**Resolution: Scene launch wins.** The priority ordering in the buffer-splitting event system (Section 1) handles this — `SceneLaunch` has priority 1, `FollowAction` has priority 4. When both land on the same sample, the scene launch is applied first. The follow action's handler checks `last_event_priority` and skips itself if a higher-priority event already modified that track at the same sample. This matches Ableton's documented behavior: "Follow Actions in scenes always take precedence once they are triggered."

### User changes global quantization while a clip is queued

**Resolution: Re-quantize if the clip uses Global quantization; keep original target otherwise.** A clip whose `launch_quantize` is `QuantizeInterval::Global` holds a reference to the global setting, not a snapshot. The pending launch's `target_beat` must be recomputed on each audio callback:

```rust
fn update_pending_launches_on_quantize_change(
    pending: &mut Vec<PendingLaunch>,
    current_beat: f64,
    new_global_quantize: QuantizeInterval,
    track_slots: &[Track],
) {
    for launch in pending.iter_mut() {
        let slot = &track_slots[launch.track_id.0].slots[launch.slot_index];
        // Only re-quantize if the slot uses Global quantization
        if matches!(slot.launch_quantize, None | Some(QuantizeInterval::Global)) {
            let interval = match new_global_quantize {
                QuantizeInterval::Beat(b) => b,
                QuantizeInterval::None => {
                    launch.target_beat = current_beat; // now immediate
                    continue;
                }
                _ => continue,
            };
            // Recompute target to next boundary of the new interval
            let next = (current_beat / interval).ceil() * interval;
            launch.target_beat = if (next - current_beat).abs() < 1e-9 {
                next + interval
            } else {
                next
            };
        }
        // Per-clip quantization: target_beat is unchanged
    }
}
```

If the clip has a fixed per-clip quantization value (not Global), the `target_beat` is immutable — the clip keeps its original quantization target regardless of global changes.

### Transport stop during a quantization queue

**Resolution: Cancel all pending launches, stop all playing clips, send MIDI cleanup.** Ableton's behavior is more nuanced (clips enter an "armed" state and resume on play), but for implementation simplicity and user predictability, **clear the queue on stop**. If Ableton-compatible behavior is desired, preserve the pending launches and re-evaluate them when transport restarts:

```rust
fn handle_transport_stop(
    pending: &mut Vec<PendingLaunch>,
    tracks: &mut [TrackState],
    midi_tracker: &mut MidiStateTracker,
    midi_output: &mut MidiBuffer,
    sample_offset: u32,
    ableton_compat: bool,
) {
    if ableton_compat {
        // Ableton behavior: clips enter "armed" state, queued launches preserved
        for track in tracks.iter_mut() {
            if track.is_playing() {
                track.state = PlayState::Armed; // will resume on transport start
            }
        }
        // Pending launches are kept — they'll re-evaluate on transport start
    } else {
        // Simple behavior: clear everything
        pending.clear();
        for track in tracks.iter_mut() {
            track.stop();
        }
    }

    // Always: MIDI cleanup to prevent stuck notes
    let cleanup = midi_tracker.generate_cleanup_messages();
    for msg in cleanup {
        midi_output.push(sample_offset, msg);
    }
    midi_tracker.reset();
}
```

When transport restarts with armed clips (Ableton mode), note that **phase relationships are lost** — Ardour's documentation explicitly warns about this. If multiple clips were in sync before stop, they may not maintain relative phase on restart unless the engine recomputes their positions from the transport position.

### Follow Action "Next" but next slot is empty

**Resolution: Stop playback on that track.** In Ableton, an empty slot defines a group boundary. "Next" wraps to the first clip in the group (the group is the contiguous block of non-empty slots). If the Follow Action triggers "Next" on the last clip in a group, it wraps to the **first clip in that same group**. It never crosses an empty-slot boundary to reach another group.

```rust
fn resolve_follow_action_next(
    track: &Track,
    current_slot: usize,
) -> FollowActionResult {
    // Find group boundaries (contiguous non-empty slots)
    let group_start = (0..current_slot)
        .rev()
        .find(|&i| track.slots[i].is_empty())
        .map(|i| i + 1)
        .unwrap_or(0);

    let group_end = (current_slot + 1..track.slots.len())
        .find(|&i| track.slots[i].is_empty())
        .unwrap_or(track.slots.len());

    let next_slot = current_slot + 1;

    if next_slot >= group_end {
        // Wrap to first clip in group
        if group_start < group_end && !track.slots[group_start].is_empty() {
            FollowActionResult::Launch(group_start)
        } else {
            FollowActionResult::Stop
        }
    } else {
        FollowActionResult::Launch(next_slot)
    }
}

enum FollowActionResult {
    Launch(usize),  // slot index
    Stop,
}
```

For "Previous" on the first clip in a group, the same logic wraps to the **last** clip in the group.

### Recording into a slot that has a Follow Action

**Resolution: Follow Actions do not fire on the slot being recorded into.** A slot being recorded into is in a `Recording` state — it does not yet have follow action settings (the clip is still being created). Follow Actions from **other tracks' clips** continue to fire normally during recording. The Follow Action check in the audio callback simply skips slots in `Recording` state:

```rust
fn should_evaluate_follow_action(slot: &ClipSlot) -> bool {
    matches!(slot.play_state, PlayState::Playing)
        && !slot.is_recording
        && slot.follow_action.is_some()
}
```

Once recording stops and the clip is finalized, any Follow Actions configured on that slot become active for subsequent playbacks.

---

## Conclusion

The nine problems above share a common architectural thread: **the audio thread is the source of truth for timing, and all state changes must be expressible as sample-accurate events within the buffer-splitting framework from Section 1**. Every user action (scene launch, clip edit, undo, transport stop) is translated into a `ScheduledEvent` with a priority and a sample offset. The basedrop `SharedCell` pattern (Section 5) provides the mechanism for delivering new state snapshots to the audio thread without blocking, while the `MidiStateTracker` (Section 4) and `WarpMap` interpolation (Sections 2-3) provide the musical intelligence.

Three insights emerge that are non-obvious from the architectural overview: First, **Rubber Band's push/pull model means the clip player must maintain a feedback loop** between `getSamplesRequired()` and `available()` within each render call — the number of source samples consumed varies dynamically with the stretch ratio, making the warp map's `beat_to_source_sample` function the critical hot path. Second, **the legato position inheritance problem is fundamentally a coordinate-system transformation** between two piecewise-linear functions (warp maps), not a simple offset copy. Third, **the degenerate timing edge cases in Section 9 are not edge cases at all** — they are the steady-state behavior of any performance where Follow Actions, scene launches, and per-clip quantization coexist, and the priority-based event system must handle them on every buffer.
