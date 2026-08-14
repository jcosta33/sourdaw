---
type: spec
id: SPEC-non-linear-clip-launcher
title: Non-linear clip launcher
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Non-linear clip launcher

## Intent

Provide a session-view performance grid where clips trigger sample-accurately against a
monotonic clock, scenes launch whole rows, and probabilistic Follow Actions self-advance
song sections — a dual-mode (arrangement vs launcher) scheduler integrated with the Rust
audio engine.

## Non-goals

- Multi-clip editing within a single slot.
- Real-time audio recording into slots (v1).
- Complex MIDI MPE support in the launcher.
- GPL Rubber Band Library — the warp engine must be permissively licensed or clean-room.

## Requirements

### AC-001 — Allocation-free audio thread

The full launcher lifecycle (clip launch, scene launch, Follow Action, loop, transport
stop) must render with zero heap allocations on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-engine launcher_assert_no_alloc`

### AC-002 — Monotonic global clock

The engine must maintain a global sample counter that is never reset by arrangement loops
or transport restart, with beat positions derived through the tempo map.

Verify with: `pnpm cargo:test -- -p daw-engine monotonic_clock`

### AC-003 — Quantized launch with micro-crossfade

A launched clip must begin at its resolved next-boundary sample with a 32–64-sample
equal-power micro-crossfade at the splice.

Verify with: `pnpm cargo:test -- -p daw-engine quantized_launch`

### AC-004 — Ordered multi-boundary splitting

Multiple boundaries within one callback must be processed as a single sorted iterative
pass over sub-slices, never by recursive descent.

Verify with: `pnpm cargo:test -- -p daw-engine buffer_splitting`

### AC-005 — Follow Action handoff contract

The audio thread must emit at most one `ClipReachedFollowAction` notification per trigger.

Verify with: `pnpm cargo:test -- -p daw-engine follow_action_handoff`

### AC-006 — Block-aware `Next`

Follow Action `Next` must wrap to the first clip of the current Clip Block on the block's
last clip, and resolve to `Stop` on a single-clip block without `Again`.

Verify with: `pnpm cargo:test -- -p daw-engine resolve_follow_action_next`

### AC-007 — Heterogeneous scene launch

A scene launch must resolve each clip's quantization independently.

Verify with: `pnpm cargo:test -- -p daw-engine scene_launch`

### AC-008 — MIDI hard-cut at clip boundary

At a clip transition the engine must emit note-offs for tracked active notes at the
transition sample and incoming note-ons one sample later.

Verify with: `pnpm cargo:test -- -p daw-engine midi_clip_boundary`

### AC-009 — Arrangement capture round-trip

A recorded launcher performance must replay an identical `ClipStart`/`ClipStop` event
stream within one sample.

Verify with: `pnpm cargo:test -- -p daw-engine arrangement_capture`

### AC-010 — Grid frame rate under load

The launcher grid must hold a sustained average of ≥ 58 fps over a 30-second stress run
(16 tracks × 64 scenes, 4 scene launches per second).

Verify with: `manual` — run the grid stress harness and read the frame-time counter

### AC-011 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-012 — Scene-level tempo / time-signature override

A scene must carry optional `tempo_override` and `time_signature_override` that apply on
scene launch and revert when a scene without overrides is launched (unless the transport
explicitly holds them).

Verify with: `pnpm cargo:test -- -p daw-engine scene_tempo_override`

### AC-013 — On-release action fires once on release

`OnReleaseActionConfig` must fire exactly once on Gate/Momentary release, and not fire
when the clip ends naturally.

Verify with: `pnpm cargo:test -- -p daw-engine on_release_action`

### AC-014 — Scene-level Follow Actions coexist with per-clip

A scene must support a single `SceneFollowActionConfig`
(`NoAction`/`Stop`/`JumpScene`/`NextScene`/`PreviousScene`/`FirstScene`/`LastScene`/`AnyScene`/`OtherScene`,
Linked/Unlinked) that advances scenes per its configuration without pre-empting per-clip
Follow Actions on the same tick.

Verify with: `pnpm cargo:test -- -p daw-engine scene_follow_action`

### AC-015 — Warp Map piecewise-linear interpolation

The warp engine must drive a push-input/pull-output time-stretcher and map clip-local beat
position to source sample position by piecewise-linear interpolation between
`(beat_pos, sample_pos)` markers.

Verify with: `pnpm cargo:test -- -p daw-engine warp_map_interpolation`

### AC-016 — Legato beat-time inheritance with deterministic stop

A Legato launch must inherit beat position and map it through the incoming clip's warp map.

Verify with: `pnpm cargo:test -- -p daw-engine legato_launch`

### AC-017 — Live-engine clip-data swap with stretcher strategy

Replacing a playing clip's data via `basedrop::SharedCell::set` must be observed by the
audio thread within ≤ 2 callback periods.

Verify with: `pnpm cargo:test -- -p daw-engine live_engine_clip_swap`

### AC-018 — Global-quantization re-resolution

When global quantization changes while a clip is queued, only slots using `Global`
quantization must re-resolve their pending `target_beat` to the new grid; slots with a fixed
per-clip override keep their original target.

Verify with: `pnpm cargo:test -- -p daw-engine global_quantize_requantize`

### AC-019 — Transport-stop cancels the queue and flushes MIDI

A transport stop during an active quantization queue must cancel all pending launches,
cancel in-flight Linked/Unlinked Follow Actions, and flush all outstanding MIDI note-offs
at the sample of the stop event.

Verify with: `pnpm cargo:test -- -p daw-engine transport_stop_during_queue`

### AC-020 — Full Follow Action vocabulary and Clip-Block resolution

`FollowActionConfig` must support the full Navigation vocabulary
(`NoAction`/`Stop`/`Again`/`Previous`/`Next`/`First`/`Last`/`Any`/`Other`) plus Clip-Block
actions (`FirstInBlock`/`LastInBlock`/`RandomInBlock`/`OtherInBlock`/`FirstInNextBlock`/`FirstInPreviousBlock`)
and `Jump(SceneIdx)`/`ReturnToArrangement`, resolving each to the correct slot for a
fixture track with three blocks of lengths `[1, 3, 2]`.

Verify with: `pnpm cargo:test -- -p daw-engine resolve_clip_block_actions`

### AC-021 — Arrangement capture snapshot and seed reproducibility

Recording must snapshot all currently-playing clips as `ClipStart` events (with non-zero
`clip_content_offset` when mid-clip) flattened into `ArrangementClipRef`s.

Verify with: `pnpm cargo:test -- -p daw-engine arrangement_capture_seed`

### AC-022 — Trigger modes and PlayMode

A clip slot must support the `PlayMode` set (Trigger, Gate, Toggle, Momentary/Retrigger,
Repeat) plus the ALT Trigger modifier-key alternative launch behavior.

Verify with: `pnpm cargo:test -- -p daw-engine play_mode_transitions`

### AC-023 — Follow-action kill-switch

`LauncherMatrix` must expose a global `follow_actions_enabled` kill-switch that disables the
entire Follow Action system at runtime.

Verify with: `pnpm cargo:test -- -p daw-engine follow_actions_kill_switch`

### AC-024 — IPC latency budget

The UI→scheduler→audio command path for small commands (single clip launch, single param
change) must meet a ~2 ms end-to-end target under nominal load; budget excursions count as
a regression.

Verify with: `pnpm cargo:test -- -p daw-engine ipc_latency_budget`

### AC-025 — Denormal handling on the DSP thread

The DSP thread must enable flush-to-zero denormal handling (FTZ/DAZ on x86, flush-to-zero
on AArch64) to avoid denormal CPU spikes in the stretcher/mix chains.

Verify with: `pnpm cargo:test -- -p daw-engine dsp_denormal_handling`

### AC-026 — CC chase and active-note tracking

The engine must chase the latest CC/pitch-bend before the first note on a mid-clip launch
(fixture: `CC1=64`@0.5, `CC1=100`@1.5, launch at 2.0 emits `CC1=100` first), track active
notes in a 16ch×128-note bitfield, emit loop-boundary note-offs at `sample_offset` and
note-ons at `sample_offset + 1`, and send `CC 123` (All Notes Off) on transport stop and
track-source change.

Verify with: `pnpm cargo:test -- -p daw-engine midi_cc_chase`

### AC-027 — Smart Pickup, Dual View, and Back to Arrangement

The launcher must support Smart Pickup (late-triggered cells start at the correct relative
position), Dual View (launcher and arranger visible simultaneously), and a per-track Back to
Arrangement toggle where the arrangement playhead keeps advancing while a track is in
Launcher mode and resumes at the current transport position.

Verify with: `manual` — exercise Smart Pickup, Dual View, and per-track Back to Arrangement
in the launcher UI

### AC-028 — Follow Action A/B probability distribution

A clip's A/B Follow Action weights (0–100% each) must produce action selections whose
observed distribution matches the configured probabilities within tolerance over a large
sample.

Verify with: `pnpm cargo:test -- -p daw-engine follow_action_ab_distribution`

### AC-029 — Permissive warp-engine parity contract

The chosen permissively-licensed (non-GPL) warp engine must publish a per-mode group-delay
table, a documented warp-mode list, and a short-loop strategy (two-stretcher crossfade at
loop boundaries); these acceptance criteria apply to whichever engine is chosen.

Verify with: `manual` — confirm the warp engine ships its group-delay table, warp-mode
list, and short-loop strategy doc

### AC-030 — Scheduler resolves Follow Actions off the audio thread

The scheduler must run the RNG and resolution without calling back into the audio thread's
RNG.

Verify with: `pnpm cargo:test -- -p daw-engine follow_action_handoff`

### AC-031 — Empty target slots untouched by scene launch

A scene launch must not affect a track whose target slot is empty and has no stop button.

Verify with: `pnpm cargo:test -- -p daw-engine scene_launch`

### AC-032 — On-release cancels pending Linked Follow Action

An `OnReleaseActionConfig` firing must cancel any pending Linked Follow Action on the same
track.

Verify with: `pnpm cargo:test -- -p daw-engine on_release_action`

### AC-033 — Legato over-length non-looping clip stops deterministically

A non-looping incoming Legato clip whose inherited beat exceeds its warped length must stop
deterministically.

Verify with: `pnpm cargo:test -- -p daw-engine legato_launch`

### AC-036 — Warp-off Legato falls back to sample-offset inheritance

A warp-off clip launched Legato must fall back to sample-offset inheritance.

Verify with: `pnpm cargo:test -- -p daw-engine legato_launch`

### AC-034 — Live clip-swap stretcher strategy

On a live clip-data swap a >~20% ratio delta (or algorithm swap) must reset and re-prime
the stretcher with group-delay silence (Strategy A) while a small change on a
ratio-smoothing engine needs no reset (Strategy B), and a shorter restored clip length
wraps via `clip_content_offset mod L'`.

Verify with: `pnpm cargo:test -- -p daw-engine live_engine_clip_swap`

### AC-035 — Captured arrangement reproduces from preserved RNG seed

A captured arrangement that preserves the RNG seed must render bit-identical output across
two consecutive renders.

Verify with: `pnpm cargo:test -- -p daw-engine arrangement_capture_seed`

### AC-037 — `NoAction` permanently disarms further Follow-Action evaluation

A clip whose resolved Follow Action is `NoAction` must permanently stop further Follow
Action evaluation for that clip instance (no re-evaluation on subsequent loops); the only
way to re-arm is a fresh launch of the slot.

Verify with: `pnpm cargo:test -- -p daw-engine follow_action_no_action_terminal`

## Open questions

- [ ] Q-001 — [CRITICAL] Canonical RT-safe deallocation primitive for clip data swapped
  while playing (`basedrop::SharedCell` vs alternatives). Blocks the audio engine.
- [ ] Q-002 — [CRITICAL] Does `OnReleaseAction` apply to Toggle mode or only Gate/Momentary?
- [ ] Q-003 — (non-blocking) Confirm Ableton-style grid orientation (tracks = columns).
- [ ] Q-004 — [MINOR] (restored detail) Should scene-level Follow Actions (AC-014) respect
  per-track "immune" settings — tracks whose stop button is removed, per AC-031 — or override
  them? Proposed: yes, respect immunity, for consistency with Ableton scene-launch semantics.

## Affected areas

- the Rust audio engine (`daw-engine`): scheduler thread, audio thread, `LauncherMatrix`
- a permissively-licensed time-stretch engine (warp map, group-delay priming)
- `src/modules/Arrangement/` for recording launcher performance into the arrangement
- the Tauri command + channel surface (UI → scheduler → audio)

## Dropped from sources

- Multi-clip-per-slot editing and real-time recording into slots — explicit v1 non-goals.
- GPL Rubber Band Library — license-incompatible; benchmark reference only.
- Ableton-compat "armed" transport-stop mode — optional toggle deferred to a follow-up.
- Visual Clip Block groupings — logical boundaries only in v1.

## Recorded from sources (tradeoffs, risks, and test plan)

The original `specs/missing/non-linear-clip-launcher.md` carried a "Tradeoffs and risks"
section and a "Test plan" section. The verifiable behaviors they implied are now normative
ACs above (AC-024 IPC budget, AC-029 warp-engine parity, AC-015/016 warp+legato,
AC-020/028 follow-action vocabulary and distribution, AC-021 capture round-trip, AC-027
manual back-to-arrangement / AC-022 ALT Trigger). The remaining design context is recorded
here so it is not lost:

- **Time-stretch latency** — algorithmic group delay (FFT frame latency in phase vocoders)
  must be compensated by priming with silence; large warp-map changes under a playing voice
  may produce an audible re-prime silence up to ~20 ms on FFT-based engines (mitigated by
  the ~20% Strategy-B threshold in AC-017; engines without smooth ratio update always pay
  the cost).
- **IPC latency** — Tauri command serialization overhead; mitigation is minimal payloads
  against the ~2 ms budget (AC-024).
- **Legato under disk streaming** — arbitrary beat-time seeks at a legato splice may land in
  an unstreamed region; mitigation is full-clip RAM mode for legato-eligible clips, or
  refuse legato and fall back to quantized re-launch until the clip is fully resident
  (reflected in AC-016 and research R-C).
- **Permissive warp-engine parity with Rubber Band** — the permissive engine must publish a
  group-delay table, warp-mode list, and short-loop strategy (AC-029); Rubber Band is a
  benchmark reference only.
- **Test plan** — automated FA distribution/A-B accuracy, clip-block resolver, scene-FA
  scheduler, OnRelease-cancel, capture round-trip diff, and WarpMap interpolation edge-case
  tests, plus manual Back-to-Arrangement, ALT Trigger, and four-scene self-advancing checks
  — these map onto the Verify lines of AC-013/014/016/020/021/022/027/028.
- **How performers actually use Follow Actions** (motivating UX behind the FA vocabulary) —
  three workflows justify the vocabulary, not just its individual actions: (1) *sequential
  cycling* (all clips set to `Next` @100% chains single-bar clips into multi-bar phrases,
  e.g. four 1-bar drum clips into a 4-bar phrase with a fill on the 4th); (2) *generative
  ambient* via `Any`/`Other` across same-key clips, replicating Brian Eno's tape-loop
  technique with different-length loops per track that continuously recombine; (3) *DJ-style
  transitions* combining Legato with Follow Actions so clips switch without resetting
  playback position. These motivate AC-016/020/028 and the `Any`/`Other`/`Next` actions.
- **Capture loses generative behavior** (motivating UX behind AC-021/035) — the universal
  pain point in capturing launcher performances to the arrangement is that the arrangement
  records a *static snapshot* of one outcome; the Follow Action logic itself is not preserved,
  so each recording produces a different result. AC-021 captures the mechanical round-trip and
  AC-035 the seed-preserved reproducibility; this is the observation those ACs answer.
- **Competitor launcher pain points** (research-survey of the problems the design choices
  solve, reported across forums) — (a) Session and Arrangement Views hold *independent* clip
  instances, so edits in one view do not sync to the other; (b) Follow Actions coordinate only
  *within a single track* — no cross-track coordination without Max for Live (informs the
  cross-track scene-FA design behind AC-014); (c) the "No Action" Follow Action permanently
  stops further Follow Action evaluation for that clip instance (now made normative as AC-037);
  (d) the "Back to Arrangement" button's behavior is a persistent source of new-user confusion
  (the behavior is specified in AC-027; this notes the confusion the spec must avoid recreating);
  (e) the Ableton empty-slot / Ctrl+E stop-button "immunity" workaround is a top beginner
  frustration (the `immune` slot state survives in research R-G and Q-004, but the documented
  beginner-frustration observation that motivates an explicit, discoverable per-track immunity
  toggle is recorded here).
