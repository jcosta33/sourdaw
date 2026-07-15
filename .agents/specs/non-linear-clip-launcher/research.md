---
type: research
id: RESEARCH-non-linear-clip-launcher
title: Non-linear clip launcher architecture
status: open
owner: The Sourdaw team
sources:
  - "Question: how do production clip launchers schedule quantized triggering and follow actions in a Rust audio engine?"
---

# Research: Non-linear clip launcher architecture

## Question

How do the major clip launchers (Ableton, Bitwig, Logic) schedule quantized triggering,
scenes, and follow actions, and what RT-safe Rust architecture replicates that on a Tauri
v2 audio engine?

## Findings

### R-001 — Two sequencers, one transport, per-track multiplexer

- **Claim:** The launcher and arrangement are best modelled as two independent sequencers sharing one transport, with a per-track source multiplexer that defaults to arrangement and overrides to the launcher.
- **Evidence:** Ableton's global override vs Bitwig's per-track independence; the arrangement playhead never stops in either.
- **Confidence:** high
- **Bears on:** AC-002 (monotonic clock), source-mode state machine.

### R-002 — Three-thread split; follow actions on the scheduler

- **Claim:** Audio thread renders DSP only; a scheduler thread runs RNG, follow-action resolution and quantization; the Tauri/tokio thread bridges IPC. The audio thread posts a single notification and never touches the RNG.
- **Evidence:** Max/MSP scheduler model; ADC talks from Ableton/Tracktion engineers; sub-microsecond SPSC overhead.
- **Confidence:** high
- **Bears on:** AC-001, AC-005 (handoff contract).

### R-003 — Buffer splitting at quantization boundaries, no recursion

- **Claim:** Boundaries inside a callback are pre-scanned, sorted by sample offset (priority tie-break), and processed as ordered sub-slices with a 32–64-sample equal-power micro-crossfade; unbounded recursion is forbidden.
- **Evidence:** Ardour TriggerBox pre-scan; Tracktion/VST3 patterns; equal-power `cos/sin` crossfade.
- **Confidence:** high
- **Bears on:** AC-003, AC-004.

### R-004 — Follow Action vocabulary: Ableton A/B + Bitwig Clip Blocks

- **Claim:** Adopt Ableton's dual-probability A/B and scene-level follow actions wholesale; supplement with Bitwig's Clip Blocks and Return-to-Arrangement. `Next`/`Previous` wrap within the contiguous non-empty block.
- **Evidence:** Ableton Live 11/12 follow actions; Bitwig Next Action + Clip Blocks; Logic's absence shows the feature is non-negotiable.
- **Confidence:** high
- **Bears on:** AC-006.

### R-005 — Lock-free crate stack; basedrop for RT-visible handles

- **Claim:** `rtrb` for SPSC command/feedback queues, `triple_buffer` for metering, `atomic_float` for params, `basedrop::SharedCell` for swapping clip data under a playing voice without deallocating on the audio thread.
- **Evidence:** crate survey; `arc-swap` is not RT-safe (drops on audio thread); `assert_no_alloc` guards the callback.
- **Confidence:** high
- **Bears on:** AC-001 and the deallocation open question.

### R-006 — MIDI hard-cut at clip boundaries with CC chase

- **Claim:** Bitwig-style hard note cut (note-offs at the transition sample, note-ons at +1 sample) is deterministic and simpler; CC chase scans backward to emit the latest CC/pitch-bend before the first note.
- **Evidence:** Tracktion's documented note-on-eaten-by-note-off race; Ableton's lack of CC chase as a counter-example.
- **Confidence:** medium
- **Bears on:** AC-008.

## Open questions

- [ ] Q-001 — Canonical RT-safe deallocation primitive (`basedrop` for all handles vs `basedrop` + `triple_buffer` vs an `arc-swap` shim)? Blocks the scheduler↔audio handoff design.
- [ ] Q-002 — `OnReleaseAction` scope: does it apply to Toggle mode or only Gate/Momentary?
- [ ] Q-003 — Grid orientation: confirm Ableton-style tracks=columns / scenes=rows.

## Recommendation

Build the per-track multiplexer over a never-resetting monotonic clock (R-001), put all
musical intelligence on the scheduler thread (R-002), and resolve every boundary through
the sorted iterative buffer-splitter (R-003). Adopt Ableton A/B + scene actions plus
Bitwig Clip Blocks (R-004), the `rtrb`/`basedrop` stack (R-005), and Bitwig-style MIDI
hard-cut with CC chase (R-006). Resolve Q-001 before designing the handoff.

---

# Restored research (co-located doc)

The sections below restore depth-research findings that were dropped when the original
`research/factory/active/non-linear-clip-launcher.md` blueprint and its advanced
implementation guide were condensed into R-001..R-006. They are kept verbatim where
practical so the spec's claims about content "in research.md" are true. Each section names
the original problem/finding it carries.

## Restored R-A — Event-priority hierarchy (advanced §1, restores item 6 / 23)

> When a follow-action and a scene launch land on sample 200, **priority ordering
> determines which is applied first**. The audio sub-block between the two events has zero
> length, so no audio is rendered — only state changes. This is safe: `render_audio` with
> `sub_len == 0` should be a no-op. The priority enum above encodes Ableton's observed
> hierarchy: transport stop > scene launch > clip stop > clip launch > follow action >
> loop boundary.
>
> **Critical rule**: when a scene launch and a follow action collide on the same sample,
> the scene launch wins because it is processed first (lower priority value). The follow
> action's `apply_event` implementation must check whether the track already received a
> launch command at this sample and skip itself if so.

```rust
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
```

The same-sample tie-break is implemented in `apply_event` via a `last_event_sample` /
`last_event_priority` skip rule on each track:

```rust
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
```

Boundaries are discovered ahead of the render loop by a two-phase **pre-scan** (Ardour's
`TriggerBox::run()` calculates transition points before entering the render loop), not by
recursion — "the cleanest approach is **not** recursion but a two-phase model". This avoids
unbounded stack depth even when rendering a sub-block discovers a new loop boundary inside
it.

## Restored R-B — Warp / time-stretch with Rubber Band (advanced §2, restores item 1 / 12 / 26)

> Rubber Band Library uses a **push-input / pull-output** model: you call `process()` to
> feed source samples, query `available()` to check output readiness, and call
> `retrieve()` to pull stretched frames. It is **not** a same-call in/out API. The
> `getSamplesRequired()` method tells you how many input frames to supply to guarantee
> some output becomes available. This entire flow is RT-safe in real-time mode
> (`OptionProcessRealTime`) with `OptionThreadingNever` — no allocation, no locking, no
> blocking after initialization.

### Latency characteristics

> Rubber Band introduces a fixed start delay queryable via `getStartDelay()` (the
> deprecated `getLatency()` is an alias). **This delay is constant for a given
> engine/window/sample-rate configuration and does not vary with time ratio.** Typical
> values at 48 kHz: R2 default window = **1024 samples** (~21 ms), R2 short window =
> **512 samples** (~11 ms), R3 default window = **2048 samples** (~43 ms), R3 short window
> = **1280 samples** (~27 ms). Before first use, feed `getPreferredStartPad()` silent
> frames to prime internal buffers, then discard `getStartDelay()` frames from the output
> to achieve correct time alignment.

### Warp mode mappings to Rubber Band options

| Warp Mode       | Rubber Band Configuration                                                       |
| --------------- | ------------------------------------------------------------------------------- |
| **Beats**       | R2 + `TransientsCrisp` + `DetectorPercussive` + `WindowShort`                   |
| **Tones**       | R2 + `TransientsMixed` + `DetectorCompound` + `PhaseLaminar` + `WindowStandard` |
| **Texture**     | R2 + `TransientsSmooth` + `DetectorSoft` + `PhaseIndependent` + `WindowLong`    |
| **Complex**     | R3 + `ChannelsTogether` + `WindowStandard`                                      |
| **Complex Pro** | R3 + `ChannelsTogether` + `WindowShort` (draft/fast R3 mode)                    |

> SoundTouch uses time-domain WSOLA (overlap-add) rather than a phase vocoder. It runs at
> roughly **3× less CPU** than Rubber Band R2 but has no transient detection — drums are
> doubled or smeared. It accepts interleaved samples via `putSamples()`/`receiveSamples()`.
> For a DAW, SoundTouch is appropriate only as a "Re-Pitch"-adjacent lightweight mode;
> Rubber Band is required for production-quality stretching.

### Warp Map = piecewise-linear interpolation (design decision, restores item 26)

> A `WarpMap` is a sorted list of `(beat_position, source_sample_position)` pairs. Between
> any two adjacent markers, the mapping is **piecewise linear**: for beat `t` in
> `[beat_a, beat_b]`, `source_sample = sample_a + (t - beat_a) * (sample_b - sample_a) /
> (beat_b - beat_a)`. The local stretch ratio at any point is
> `(sample_b - sample_a) / (beat_b - beat_a) / samples_per_beat_at_project_tempo`.

The clip player drives Rubber Band on the audio thread via a `getSamplesRequired()` /
`available()` feedback loop, updating `set_time_ratio()` from `local_time_ratio()` at the
current warp-map position on each push. Rationale for piecewise-linear: industry standard
for predictable time-stretching and a simple beat-to-sample mapping.

### Loop boundary handling

> **Calling `reset()` at loop points is recommended** but has a cost: the stretcher must
> be re-primed with `getPreferredStartPad()` silent frames and `getStartDelay()` output
> frames must be discarded again. For short loops (< 1 bar), this overhead is audible. The
> practical solution is a **crossfade at the loop boundary**: maintain two stretcher
> instances, fade out the ending instance over ~5 ms, and fade in the new instance
> starting from the loop start.

## Restored R-C — Legato position inheritance across tempo-warped clips (advanced §3, restores item 2 / 12)

> Ableton's Legato mode inherits position in **beat time, not sample time**. When clip B
> launches in Legato mode while clip A is playing, the engine reads clip A's current beat
> position, then maps that beat position through clip B's warp map to find the correct
> source sample offset. This is critical: two clips with different warp maps will map the
> same beat position to completely different source samples.

The algorithm: read the outgoing clip's `current_beat`; for a looping incoming clip wrap
with `current_beat % incoming_length_beats`, for a non-looping clip clamp to
`incoming_length_beats`; map `target_beat` through the incoming clip's warp map
(`beat_to_source_sample`); reset the stretcher and re-prime from the new position.

### Edge cases in legato inheritance

> **Non-looping incoming clip shorter than current position**: If the outgoing clip has
> been playing for 16 beats and the incoming clip is only 8 beats long (non-looping), the
> incoming clip is at beat 16 — past its end. Ableton effectively stops the clip
> immediately. The implementation should detect `target_beat >= incoming_length_beats` for
> non-looping clips and either stop or clamp to the last sample.
>
> **RAM mode requirement**: Legato with warped clips jumps to an arbitrary source sample
> position. If audio is streamed from disk, this position has not been pre-fetched. Ableton
> warns users to enable "Clip RAM Mode" to avoid dropouts. The Tauri DAW should either load
> entire clips into memory (practical for clips < 100 MB) or implement a pre-fetch ring
> buffer with a fallback silence strategy when the read head jumps unpredictably.
>
> **Warp must be enabled**: Legato requires a beat-time coordinate system. Without warp,
> there is no beat-to-sample mapping, and the engine should fall back to raw sample
> position inheritance or refuse the legato launch.

## Restored R-D — basedrop SharedCell lifecycle, no_denormals and llq (advanced §5, restores item 3 / 7)

> The basedrop crate (by Micah Johnston, crates.io v0.1.3) solves the core real-time audio
> memory problem: **the audio thread must never deallocate**. basedrop's `Shared<T>` is
> like `Arc<T>` except when the reference count drops to zero, instead of immediately
> freeing, it pushes the allocation onto a wait-free MPSC linked-list queue. The queue node
> is **pre-allocated inline** alongside the data at `Shared::new()` time, so the drop
> operation involves zero allocator calls. A `Collector` on a separate thread periodically
> drains this queue and actually frees memory.

The undo/redo path treats undo as a **document-model new-state-snapshot** the engine
consumes: the UI/undo thread rebuilds the restored `EngineState`, wraps it in
`Shared::new()`, and publishes it via `SharedCell::set()`. The audio thread picks it up on
the next buffer boundary (~11 ms at 512 samples / 48 kHz); the old state is deferred-dropped
on the collector thread, never on the audio thread.

### Stretcher state on undo — two strategies

> **Strategy A: Reset the stretcher.** Call `rubberband_reset()`, re-prime, and continue
> from the current beat position with the new warp map. This produces a brief discontinuity
> (the re-priming silence/delay) but guarantees correct output. Suitable when warp marker
> changes are significant.
>
> **Strategy B: Continue without reset.** Simply update the `WarpMap` pointer and call
> `rubberband_set_time_ratio()` with the new ratio on the next `process()` call. Rubber
> Band smoothly transitions to the new ratio. This avoids discontinuity but may produce
> artifacts if the ratio change is dramatic. Suitable for small warp marker adjustments.

The implementation chooses by magnitude: a `ratio_change > 0.2` (~20% ratio shift) resets
the stretcher; otherwise it smoothly updates the ratio with no reset. Clip-length changes
while looping wrap via `current_beat = current_beat % new_loop_length`; a non-looping clip
past its new end transitions to `Stopped`.

### Alternatives assessment

> **arc-swap** (`ArcSwap<T>`): Lock-free reads, but dropping the old `Arc` can trigger
> deallocation on the audio thread — **not RT-safe** without an additional deferred-drop
> mechanism. Unsuitable without modification.
>
> **triple_buffer**: Wait-free for both reader and writer. Excellent for fixed-size,
> frequently-updated state. Cannot handle dynamically-sized data without boxing.
>
> **llq** (by the same author): The spiritual successor to basedrop's internal queue,
> extracted as a standalone wait-free SPSC linked-list queue with recyclable nodes. More
> flexible than basedrop's opinionated API. Consider using llq directly if basedrop's
> `Shared`/`SharedCell` API is too rigid.

Audio-thread hygiene: the **`assert_no_alloc`** crate wraps the entire audio callback
during development to catch accidental heap allocations; the **`no_denormals`** crate
prevents CPU slowdowns from denormalized floating-point values in DSP chains.

## Restored R-E — Recording launcher performances to the arrangement (advanced §6, restores item 4 / 16)

> When a user records a Session performance into the Arrangement, the DAW must log every
> clip state change with sample-accurate arrangement positions and then "flatten" the log
> into arrangement clip references. Ableton's manual confirms: **no new audio data is
> created** — arrangement clips are references to the same underlying audio/MIDI data as
> Session clips, with a start offset. Follow Action randomness is recorded as its
> **deterministic outcome** (which clip actually played), not the intent. Bitwig goes
> further by preserving the random seed so the exact randomized result is reproducible.

The log entry is a `PerformanceEvent { arrangement_beat, track_id, kind }` where `kind` is
`ClipStart { clip_id, clip_offset_beats, looping }`, `ClipStop { clip_id }`, or
`TrackSilence`. The flattening algorithm closes the active clip per track on each
`ClipStart`/`ClipStop`/`TrackSilence` and emits an `ArrangementClipRef { track_id, clip_id,
arrangement_start, arrangement_end, clip_content_offset, looping }`.

### Edge cases

> **Clips playing before recording started**: When the user presses Arrangement Record, the
> engine must snapshot every currently-playing clip and emit a synthetic `ClipStart` event
> at `recording_start_beat` with the current clip offset. This is the `clip_offset_beats`
> field — it captures where in the clip's content the playback was at the moment recording
> began.
>
> **Gaps**: When a track has no playing clip, no `ArrangementClipRef` is created for that
> time region. The arrangement simply has empty space on that track — silence.
>
> **Overlapping launches on the same track**: Impossible by design. Only one clip plays per
> track at any time. A new launch closes the old clip first (via `ClipStop`) then opens the
> new one.
>
> **Follow Action randomness**: The audio thread resolves the random selection and logs the
> _actual clip that launched_. The arrangement contains deterministic clip references.
> Bitwig's seed-preservation approach can be added by storing the seed in the
> `PerformanceEvent` (`random_seed: Option<u64>`).

## Restored R-F — Degenerate timing edge cases (advanced §9, restores item 5 / 14)

These are the steady-state behaviors of any performance where Follow Actions, scene
launches, and per-clip quantization coexist, each with its resolution rule:

- **Follow Action fires at exact same beat as user scene launch — scene launch wins.**
  `SceneLaunch` has priority 1, `FollowAction` has priority 4; the scene launch is applied
  first and the follow action's handler checks `last_event_priority` and skips itself.
  Matches Ableton: "Follow Actions in scenes always take precedence once they are
  triggered."
- **User changes global quantization while a clip is queued — re-quantize only Global
  slots.** A clip whose `launch_quantize` is `Global` holds a reference to the global
  setting, not a snapshot; its `target_beat` is recomputed each callback to the next
  boundary of the new interval. A clip with a fixed per-clip quantization keeps its
  original `target_beat` — the override is immutable.
- **Transport stop during a quantization queue — cancel all pending launches, stop all
  playing clips, send MIDI cleanup.** Ableton's behavior is more nuanced (clips enter an
  "armed" state and resume on play); v1 simplicity clears the queue on stop. The optional
  Ableton-compat path preserves the pending launches and re-evaluates them on restart —
  but **phase relationships are lost** (Ardour explicitly warns) unless positions are
  recomputed from transport position.
- **Follow Action "Next" but next slot is empty — wrap within the contiguous non-empty
  block.** An empty slot defines a group boundary; "Next" on the last clip of a group wraps
  to the **first** clip of that **same** group and never crosses an empty-slot boundary.
  "Previous" on the first clip wraps to the **last** clip in the group. A single-clip block
  resolves to `Stop`.
- **Recording into a slot that has a Follow Action — Follow Actions do not fire on the slot
  being recorded into.** A recording slot is in a `Recording` state with no finalized
  follow-action settings; other tracks' Follow Actions continue to fire. Once recording
  stops and the clip is finalized, its configured Follow Actions become active for
  subsequent playbacks.

## Restored R-G — Per-DAW UX specifics (blueprint UX analysis, restores item 8)

These per-DAW observations were distilled into the R-001..R-006 evidence one-liners; the
specifics are restored here verbatim.

> ### Ableton Live: the 20-year reference implementation
>
> Each clip slot exists in one of six states: empty-with-stop-button,
> empty-without-stop-button, filled/stopped, queued (flashing green), playing (solid green
> with pie-chart progress), or recording (red). Launching a scene triggers every clip in
> that row simultaneously — critically, **empty slots that retain their stop buttons send a
> stop command to their track**, silencing whatever was playing there. Removing stop
> buttons (Ctrl+E) is the only way to make a track "immune" to scene launches.
>
> **Follow Actions** (substantially overhauled in Live 11/12) offer 10 action types: No
> Action, Stop, Again, Previous, Next, First, Last, Any, Other, and Jump (to specific
> slot). Each clip carries two action slots (A and B) with independent probability
> percentages. The Linked/Unlinked switch determines whether actions fire at clip end (with
> a loop-count multiplier) or after an absolute time duration. Scene-level Follow Actions
> (Live 11+) enable self-playing arrangements.

> ### Bitwig Studio: per-track independence as an architectural advantage
>
> Bitwig's launcher is oriented horizontally (tracks as rows, scenes as columns) and embeds
> directly alongside the Arranger Timeline — both views visible simultaneously. Each track
> independently determines whether it reads from the launcher or arranger; a track returns
> to the arranger only when its dedicated "Switch Playback to Arranger" button is pressed.
> Bitwig offers a built-in "Return to Arrangement" Next Action. Next Action supports a
> single action per clip plus a suite of **Clip Block** actions (First in Block, Random in
> Block, First in Next Block, etc.). Unique features: the **Main + ALT trigger system**
> (two complete launch behaviors per clip via modifier key), **On-Release actions** (Bitwig
> 5+), and **seed value preservation** when recording launcher performances. Bitwig
> **lacks scene-level Follow Actions** and **has no probability weighting** between two
> alternatives.

> ### Logic Pro Live Loops: accessible but incomplete
>
> Logic's Live Loops uses the same track × scene grid with three trigger modes per cell —
> Start/Stop, Momentary (press-and-hold), and Retrigger. **Smart Pickup** allows
> late-triggered cells to start at the "correct" position. Logic Remote on iOS provides
> multi-touch cell triggering, and **Remix FX** (DJ-style filter/stutter/scratch effects
> with X/Y pad) adds a performance dimension. **However, Logic Pro has no Follow Action
> equivalent whatsoever** — the single most-cited missing feature.

> ### IPC latency budget
>
> The path from a user click to sample-accurate clip playback traverses four stages with a
> total latency budget under **2 ms** for the command path (well within perceptual
> thresholds). Tauri v2 commands offer ~0.5 ms round-trip latency for small payloads; async
> commands execute on the tokio thread pool. Feedback (audio→UI) flows back via Tauri
> Channels at 60 Hz, decimated from the audio callback rate.
