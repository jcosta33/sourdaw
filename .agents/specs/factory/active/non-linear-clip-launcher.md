# Non-linear Clip Launcher

## Context

The non-linear clip launcher provides a session-view style performance and arrangement environment, enabling quantized clip triggering, scene-based organization, and probabilistic follow actions. This feature is a core pillar of modern DAWs (Ableton Live, Bitwig Studio) and allows for non-linear composition and live performance.

Reference research: `.agents/research/factory/active/non-linear-clip-launcher.md`

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
- **Follow Actions**: Automated triggers after a clip finishes or a duration elapses. Configurable at both **clip level** (two-slot A/B probability, Ableton-style) and **scene level** (one action per scene, Live 11+ style) to enable self-advancing song sections.
- **On-Release Actions** (Bitwig-style, separate from Gate mode): A clip may declare a distinct action to fire at the moment it is released (for performance-oriented press-and-hold gestures). Release actions are specified per-clip and are independent of the clip's ongoing Follow Action.
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

- **LauncherMatrix**: Global structure containing Tracks, Scenes, and Global Quantization settings, plus a global `follow_actions_enabled` kill-switch that disables the entire FA system at runtime (performance override, research § core struct).
- **Scene**: Optional `tempoOverride` and `timeSignatureOverride` for row-level tempo / time-signature changes when launching or holding that scene (research core `Scene` struct). Overrides apply on scene launch and revert when another scene without overrides is launched unless the transport explicitly holds them.
- **ClipSlot**:
    - `ClipId`, `hasStopButton`, `launchQuantize` override.
    - `PlayMode`: Trigger, Gate, Toggle, Retrigger, Repeat.
- **FollowActionConfig** (per clip):
    - Action set (full, covering Ableton + Bitwig vocabulary):
        - Navigation: `NoAction`, `Stop`, `Again`, `Previous`, `Next`, `First`, `Last`, `Any`, `Other`.
        - Clip Block (Bitwig-style, scoped to the current contiguous block of non-empty slots): `FirstInBlock`, `LastInBlock`, `RandomInBlock`, `OtherInBlock`, `FirstInNextBlock`, `FirstInPreviousBlock`.
        - Jump: `Jump(SceneIdx)`.
        - Transport: `ReturnToArrangement`.
    - `Next`/`Previous` wrap within the current Clip Block (contiguous non-empty slots). Clip-Block actions never cross a block boundary except `FirstInNextBlock`/`FirstInPreviousBlock`, which explicitly step across one empty-slot boundary.
    - Probabilities: A/B slot weights (0–100% each), independent.
    - `Linked`: Fires at clip end (with `loopCount` multiplier).
    - `Unlinked`: Fires after fixed `duration`.
- **SceneFollowActionConfig** (per scene, Live 11+ style):
    - Single action (no A/B split at scene level) drawn from: `NoAction`, `Stop`, `JumpScene(SceneIdx)`, `NextScene`, `PreviousScene`, `FirstScene`, `LastScene`, `AnyScene`, `OtherScene`.
    - `Linked`/`Unlinked` semantics identical to clip-level. Scene-level actions coordinate the whole row and do not replace per-clip Follow Actions on tracks in that scene — both can coexist.
- **OnReleaseActionConfig** (per clip, Bitwig-style):
    - Single action drawn from: `NoAction`, `Stop`, `Launch(SceneIdx)`, `ReturnToArrangement`.
    - Fires only when the user releases the clip (Gate or Momentary mode). Independent of the clip's ongoing `FollowActionConfig`; an in-flight `Linked` action is cancelled by a release.

### 2. Audio Engine (Rust)

- **Three-Thread Architecture**:
    - **Audio Thread**: Pure DSP, no alloc/lock. Processes `ScheduledEvent`s.
    - **Scheduler Thread**: Evaluates Follow Actions, resolves quantization to sample offsets, manages priority queue.
    - **UI/Tauri Thread**: IPC bridging.
- **Global monotonic time base**: The engine MUST maintain a monotonically increasing **global sample counter** that is **never reset** by arrangement loops or transport restart, plus a derived `MonotonicBeat` via the tempo map. Beat-to-sample conversion integrates across tempo segments. Both arrangement playback and launcher scheduling reference this clock (research § Transport and beat position tracking). The arrangement playhead is a separate view on top of this monotonic time; wrapping the arrangement loop does not rewind the launcher clock.
- **Follow Action execution split**: The audio thread only detects the precise sample at which a clip reaches its Follow Action trigger point (clip end for `Linked`, elapsed-beat for `Unlinked`) and posts a minimal notification to the scheduler (`ClipReachedFollowAction { clip_id, at_sample }`). The **scheduler** runs the RNG, evaluates A/B probability, resolves the target slot against Clip-Block rules, quantizes the launch, and enqueues audio-thread commands (`StartClip` / `StopClip`). The audio thread does not walk Follow Action graphs or touch the RNG.
- **Buffer Splitting & Crossfading**:
    - Use an **ordered sub-block pass**: pre-collect all boundaries falling inside the current callback, sort by sample offset (tie-break on priority), and process segments iteratively. **Unbounded recursion on the audio thread is forbidden.** (Aligns with research advanced §1.)
    - Apply **32-64 sample micro-crossfade** at splice points.
    - Use **Equal-power crossfading** (`cos(t·π/2)` and `sin(t·π/2)`).
- **Priority System**: `TransportStop(0)` > `SceneLaunch(1)` > `ClipStop(2)` > `ClipLaunch(3)` > `FollowAction(4)` > `LoopBoundary(5)`.
- **IPC**:
    - **UI -> Scheduler**: `tokio::sync::mpsc`.
    - **Scheduler -> Audio**: `rtrb` (SPSC).
    - **Audio -> UI (Feedback)**: Tauri Channels (60Hz decimated).
    - **Audio -> UI (Metering)**: `triple_buffer`.
    - **Params**: `atomic_float`.
- **IPC latency budget**: UI→scheduler→audio command-path for small commands (single clip launch, single param change) MUST meet a target on the order of **~2 ms** end-to-end under nominal load (research IPC section). Validated in integration tests; budget excursions are a regression.
- **Audio-thread hygiene**: `assert_no_alloc` on the callback in debug builds; **`no_denormals`** (or equivalent platform intrinsic — FTZ / DAZ on x86, flush-to-zero bit on AArch64) enabled on the DSP thread to avoid denormal CPU spikes in the stretcher/mix chains (research § lock-free).

### 3. Warp & Legato

- **Time-Stretch Engine**: Push-input/pull-output model supporting generic variable-ratio processing.
- **Warp Map**: Piecewise linear interpolation between `(beat_pos, sample_pos)` markers.
- **Legato**: Inherit beat position, map through target warp map to new source sample offset.
- **Legato prerequisites (research § advanced-3 / "RAM mode")**:
    - Inheritance is in **beat time** via the target clip's warp map. If the incoming clip is **non-looping** and the inherited beat exceeds its warped length, the voice **stops deterministically** (does not silently hang).
    - **Warp-off clips**: fall-back policy is **sample-offset inheritance** (v1 normative); a per-clip flag may disallow legato entirely. No implicit tempo-matching.
    - Arbitrary warp seeks at the splice may require the **full clip in memory** ("RAM mode") or an advance prefetch to avoid disk-stream dropouts. The scheduler MUST track per-clip streaming state and refuse legato launches into clips that are not ready, falling back to a quantized re-launch at the inherited beat.

### 4. MIDI Handling

- **Active Note Tracker**: 16 channels x 128 notes bitfield.
- **CC Chase**: Scan backwards before start beat to emit latest CC/PitchBend.
- **Loop Boundary Race Prevention**: Note-Offs at `sample_offset`, Note-Ons at `sample_offset + 1`.
- **Clip-to-clip MIDI policy (normative for v1)**: **Hard note cut at clip boundary** — emit `Note-Off` for every tracked active note on the outgoing clip at the transition sample, then `Note-On`s from the incoming clip at `sample + 1`. Additionally emit **`CC 123` (All Notes Off)** on transport stop and on track-source changes as a safety net (research contrasts Bitwig hard-cut vs Ableton tracking + CC 123; v1 picks the Bitwig-style hard cut as deterministic and simpler to debug).

### 5. Recording & Arrangement

- **Snapshot**: On "Record", snapshot all playing clips as `ClipStart` events at the start beat.
- **Flattening**: Log `PerformanceEvent`s and flatten into `ArrangementClipRef` (preserving deterministic outcomes, optionally preserving seeds).

### 6. Multi-event buffer splitting (research § advanced-1)

Within a single audio-render buffer multiple scheduling boundaries may collide — e.g. a loop wrap at sample 200, a scene launch at 350, and a Follow Action at 500 within a 512-sample callback. The scheduler MUST:

- Pre-collect all boundaries falling inside the callback, **sort by sample offset** (tie-break on priority), and process the buffer as an **ordered sequence of sub-slices** in a single iterative pass. Unbounded recursion on the audio thread is forbidden; the implementation is a loop or explicit stack with bounded depth.
- For each splice, apply the 32–64-sample equal-power micro-crossfade specified in Requirement 2. When two boundaries are within one crossfade window, the window is truncated to the inter-boundary distance (no overlapping crossfades — a later crossfade fully overrides an earlier one in its region).
- When two events share the same sample offset, resolve by the priority table in Requirement 2 (`TransportStop(0)` wins); event(s) of lower priority at the same sample are silently dropped for that tick, logged for diagnostics, and do not queue to the next sample.

### 7. Scene launch with heterogeneous quantization (research § advanced-7)

A scene launch may contain clips with different per-clip `launchQuantize` overrides (including `None`). The engine MUST:

- **Resolve per-clip target beats independently** against the current global quantization AND each clip's override. Clips with `None` launch immediately within the current audio buffer; clips with explicit quantization launch at their respective next-boundary beat.
- **Skip empty slots** on the target row: a scene launch that hits an empty slot on track T MUST NOT affect track T unless the empty slot has a Stop Button (in which case the track is stopped at its own next boundary).
- **Apply scene-level Follow Action once per scene**, not per track, per the acceptance criterion already listed.

### 8. Undo/redo with a live audio engine (research § advanced-8)

The editor MAY replace clip content (audio buffer, warp map, note list) while that clip is playing. The engine MUST:

- **Swap clip data** via the `basedrop::SharedCell` pattern: the UI/undo thread writes a new `Shared<ClipData>` into the cell; the audio thread observes the new handle on its next pull; the previous handle is released into the drop queue and freed on the GC thread.
- **Stretcher state on content / warp change (implementation-agnostic)**: when a clip's warp map or time-stretch algorithm changes under a playing voice, the scheduler chooses one of two strategies per research § advanced-8:
    - **Strategy A (reset + re-prime)** — required when the algorithm is replaced, when the warp-map delta at the current play position is "large" (product-tunable threshold, default ~20 % ratio change), or when the stretch engine cannot update its ratio without artefacts. The stretcher is reset at the current `clip_content_offset` and primed with silence equal to its reported **group delay** so the splice is silent.
    - **Strategy B (smooth ratio update)** — permitted when the change is small (below threshold) AND the engine exposes glitch-free ratio updates. No reset; the engine's smoothing absorbs the change.
    Strategy A is the safe default; Strategy B is opt-in per engine. No reference to the GPL Rubber Band Library — this requirement is implementation-agnostic and compatible with the permissive-license scope (§ Scope).
- **Clip length change while looping**: if the new clip length L' is less than the current `clip_content_offset`, the voice immediately wraps using `clip_content_offset mod L'`; if L' is greater, the voice continues from the current offset (no seek).

### 9. Timing edge-case contracts (research § advanced-9)

The scheduler MUST handle the following degenerate cases with documented, deterministic behavior:

- **User scene launch at the same beat as an in-flight clip Follow Action**: scene launch wins (`EventPriority::SceneLaunch(1)` < `FollowAction(4)`); the pre-empted Follow Action is skipped and not re-queued.
- **User changes global quantization while a clip is queued**: slots whose `launchQuantize` is **`Global`** (or inherit-global) MUST **re-resolve** their pending `target_beat` against the new global grid on each scheduler tick until the clip actually launches (research § advanced-9). Slots with a **fixed per-clip** quantization override MUST keep the previously resolved `target_beat` — the override wins over the grid change. This matches Ableton's documented behavior.
- **Transport stop during an active quantization queue**: all queued launches are cancelled; any in-flight `Linked`/`Unlinked` Follow Actions on playing clips are cancelled; MIDI active-note tracker flushes all outstanding note-offs at the sample of the transport stop.
- **Follow Action `Next` but next slot is empty**: the action falls through per the block-aware resolver — `Next` skips empty slots within the current Clip Block and wraps; a single-clip block with `Next` resolves to `Stop` unless `Again` is explicitly configured.
- **Recording into a slot that has a Follow Action**: recording takes precedence over the Follow Action; the clip's recording end-time becomes its new length and the Follow Action is disarmed for the duration of the recording pass (re-enabled on next launch).

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

- [ ] Audio thread renders with zero heap allocations under the full lifecycle (clip launch, scene launch, Follow Action, loop boundary, transport stop), verified by `assert_no_alloc` wrapping the cpal callback in a debug build of the engine integration test.
- [ ] Micro-crossfades are applied at every quantization boundary. Measured by a deterministic offline render test: feed a DC-offset (constant 0.5) "clip A" and constant -0.5 "clip B", launch B at a bar boundary, and assert the absolute peak sample delta between any two consecutive output samples in the 128-sample window centered on the splice is **≤ 0.05** (i.e. equal-power crossfade monotonic, no unit-amplitude step). The same test run without the crossfade must fail.
- [ ] Follow Action `Next` wraps to the first clip of the current Clip Block when invoked on the last clip of that block, and to `Stop` when the block contains a single clip with no `Again`. Verified by unit tests on `resolve_follow_action_next` with at least three block layouts (single-clip block, multi-clip block, multi-block track).
- [ ] Clip Block actions (`FirstInBlock`, `RandomInBlock`, `OtherInBlock`, `FirstInNextBlock`, `FirstInPreviousBlock`) each resolve to the correct slot index for a fixture track with three blocks of lengths `[1, 3, 2]`. `FirstInNextBlock` from the last block wraps to the first block; `FirstInPreviousBlock` from the first block wraps to the last.
- [ ] Scene-level Follow Actions advance scenes per their configuration without pre-empting per-clip Follow Actions on the same tick. When a scene action and a clip action both fire at the same sample, the scene action is applied first (per `EventPriority::SceneLaunch` < `EventPriority::FollowAction`) and the clip action is skipped for tracks whose slot was overwritten by the scene launch.
- [ ] `OnReleaseActionConfig` fires exactly once on Gate/Momentary release, cancels any pending `Linked` Follow Action on the same track, and does not fire when the clip ends naturally (non-release stop).
- [ ] CC values are chased correctly when launching mid-clip. Verified by a MIDI fixture clip containing `CC1 = 64` at beat 0.5 and `CC1 = 100` at beat 1.5; launching the clip at beat 2.0 must emit `CC1 = 100` before the first note-on of the post-launch region, within the same audio buffer as the launch.
- [ ] Recording launcher performance into the arrangement produces an `ArrangementClipRef` list that, when played back through the arrangement scheduler, emits the **identical sequence** of `ClipStart`/`ClipStop` events — same `clip_id`, same `track_id`, and same `arrangement_beat` within a tolerance of `1` sample at the project sample rate — as the recorded performance log. Including the case where recording begins mid-clip (non-zero `clip_content_offset`).
- [ ] Randomized Follow Action outcomes are reproducible on playback when the recorded arrangement preserves the RNG seed (Bitwig-style): two consecutive renders of the captured arrangement produce bit-identical output.
- [ ] UI grid rendering holds a sustained average of ≥ 58 fps and 99th-percentile ≥ 50 fps over a 30-second synthetic stress run (16 tracks × 64 scenes, 4 scene-launches per second, all clips playing with progress readout). Measured by an instrumented frame-time counter in the grid's top-level view component and asserted in a Playwright + Chrome DevTools Protocol test using `Performance.getMetrics`.
- [ ] Ordered multi-boundary buffer splitting: an offline render test feeds a 512-sample callback carrying three boundaries at samples 100, 256, and 400. The rendered output must contain exactly three equal-power splices with no allocations on the audio thread (`assert_no_alloc`), and the per-splice crossfade must fit the inter-boundary distance when it is less than the default 64-sample window. The implementation must be iterative (no recursive descent into the callback) — verified by static analysis of the scheduler's boundary-processing function.
- [ ] Heterogeneous scene launch: launching a scene containing one `None`-quantized clip, one 1-bar-quantized clip, and one empty slot with a stop button produces (a) the `None` clip starting within the current buffer, (b) the bar-quantized clip launching at the next bar, and (c) the track at the empty-slot column stopping at its own next boundary. Verified by an engine integration test asserting each track's event stream.
- [ ] Live-engine undo: replacing a clip's audio buffer while that clip is playing via `SharedCell::set` is observed by the audio thread within ≤ 2 callback periods (≤ 5.8 ms at 48 kHz / 128 frames). For a **large** warp-map change (>20 % ratio delta or algorithm swap), the stretcher is reset and re-primed with silence matching its reported group delay; for a **small** change on a ratio-smoothing-capable engine, no reset is required. `assert_no_alloc` reports zero allocations on the audio thread during the swap.
- [ ] Global-quantization re-resolution: with a `Global`-quantized clip queued against a 1-bar grid, switching global quantization to 1/2-bar before the original target beat MUST advance the clip's launch to the next 1/2-bar boundary. A sibling clip with an explicit per-clip `1-bar` override MUST keep its original bar-aligned target. Verified by a scheduler unit test with mocked transport time.
- [ ] Follow Action handoff contract: the audio thread emits at most one `ClipReachedFollowAction` notification per clip per trigger; the scheduler runs the RNG, resolves the action, and enqueues `StartClip`/`StopClip` commands without calling back into the audio thread's RNG or Follow Action tables. Verified by instrumenting the RNG call sites and asserting they are reached only from the scheduler thread.
- [ ] Transport-stop-during-queue: starting transport, queuing a scene launch at a future beat, and pressing stop before that beat cancels the launch (no clip transitions to "playing") and flushes all outstanding MIDI note-offs at the sample of the stop event.

---

## Test plan

- [ ] **Automated**: `FollowAction` distribution tests (A/B probability accuracy).
- [ ] **Automated**: Clip Block resolver tests (`FirstInBlock`, `RandomInBlock`, `OtherInBlock`, `FirstInNextBlock`, `FirstInPreviousBlock`) against a fixture track with three blocks of lengths `[1, 3, 2]`.
- [ ] **Automated**: Scene-level Follow Action scheduler test — verify that a scene action firing at the same sample as a clip Follow Action is applied first and that the per-track clip action is skipped for overwritten slots.
- [ ] **Automated**: `OnReleaseActionConfig` cancels an in-flight `Linked` Follow Action; does not fire on natural clip end.
- [ ] **Automated**: Arrangement capture round-trip — render the recorded arrangement and diff its event stream against the recorded `PerformanceEvent` log within 1-sample tolerance.
- [ ] **Automated**: `WarpMap` linear interpolation edge case tests.
- [ ] **Manual**: Verify "Back to Arrangement" resumes correctly at current transport position.
- [ ] **Manual**: Test "ALT Trigger" (Bitwig-style) with modifier keys.
- [ ] **Manual**: Verify scene-level Follow Actions produce self-advancing song sections across at least four scenes.

---

## Open questions

- [ ] **[CRITICAL]** RT-safe deallocation strategy for clip data replaced while playing. The research names `basedrop::Shared` + `SharedCell` as the recommended primitive (wait-free MPSC drop queue, pre-allocated inline drop node, dedicated GC thread draining the queue; see research § 5). Product decision required on: (a) adopt `basedrop` as the canonical pattern for every Audio-thread-visible handle (clip audio, warp maps, `LauncherMatrix` snapshot); (b) adopt `triple_buffer` for small fixed-size hot state alongside `basedrop` for variable-size data; or (c) accept an alternative (e.g. `arc-swap`) with an explicit deferred-drop shim. Pending this decision, the scheduler ↔ audio handoff cannot be designed. Blocking implementation of §§ 2 (Audio Engine) and 5 (Recording & Arrangement).
- [ ] **[CRITICAL]** Scope of `OnReleaseActionConfig`: does it apply to Toggle mode (click-to-stop counts as "release") or only to Gate/Momentary? Affects state-machine transitions in the scheduler.
- [ ] **[MINOR]** Should "Clip Blocks" be exposed as explicit visual groupings in the UI, or remain purely logical boundaries derived from empty slots? (Proposed: purely logical for V1; visual indicator only.)
- [ ] **[MINOR]** Should scene-level Follow Actions respect per-track "immune" settings (tracks with their stop button removed)? Proposed: yes, for consistency with Ableton scene-launch semantics.
- [ ] **[MINOR]** Transport-stop semantics on an armed queue: v1 cancels all queued launches and flushes MIDI at the stop sample (normative above, Requirement 9). Research § advanced-9 documents an optional **Ableton-compat "armed" mode** where the queue survives transport stop and re-arms on the next start. Decide whether a user-facing compatibility toggle is worth v1 complexity or defers to a follow-up spec.
- [ ] **[MINOR]** Grid orientation alignment: v1 fixes **Tracks = columns / Scenes = rows** (Ableton layout). Bitwig's described layout uses rows for tracks. Confirm the Ableton orientation is the product decision and note the divergence so it is not treated as a research gap later.
- [ ] **[MINOR]** RT safety primitives: should `basedrop` coexist with **`llq`** (lock-free linked queue) for specific drop-queue use cases called out in research § 5, or is `basedrop`'s built-in drop queue sufficient for v1? Minor because either resolves the correctness requirement; affects only implementation detail.

---

## Tradeoffs and risks

- **Time-stretch Latency**: Algorithmic group delay (e.g., FFT frame latency in phase vocoders) must be compensated for by priming with silence. Large warp-map changes under a playing voice may produce an audible re-prime silence of up to ~20 ms on FFT-based engines — the ~20 % threshold for Strategy B (§8) is the mitigation; engines without smooth ratio update simply always pay this cost.
- **IPC Latency**: Tauri command serialization overhead. Mitigation: Keep payloads minimal. Budget: **~2 ms** end-to-end for small commands (research IPC section) — regression-gated.
- **Legato under disk streaming**: Arbitrary beat-time seeks at a legato splice may land in a region not yet streamed from disk. Mitigation: full-clip RAM mode for legato-eligible clips, or refuse legato and fall back to quantized re-launch until the clip is fully resident.
- **Permissive warp engine parity with Rubber Band**: The Scope forbids GPL Rubber Band. A permissive-license engine (Phase Vocoder + WSOLA hybrid, Signalsmith Stretch if license-compatible, or a clean-room implementation) MUST publish a **group-delay table** per mode, a documented **warp-mode list** (Beats / Tones / Re-Pitch / Complex equivalents), and a **short-loop strategy** (two-stretcher crossfade at loop boundaries per research §2). The spec's acceptance criteria apply to whichever engine is chosen; Rubber Band is a benchmark reference only.
