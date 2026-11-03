---
name: musical-time
description: >-
    Keep musical time exact across beats, seconds, sample frames and file ticks:
    the tempo map, bars, loop seams, same-beat tolerance, and the sample-rate
    boundary to the audio engines. ALWAYS apply when converting between beats,
    seconds, frames or ticks, reading or editing the tempo or time-signature map,
    placing a note, clip, controller or automation point on the timeline, handling
    a loop wrap, comparing two beats, or importing or exporting a MIDI file —
    even if it looks like a one-line `60 / tempo`. Skip real-time safety on the
    audio callback (native-audio-engine), the Web Audio graph and worklets
    (web-audio-engine), and pure layout math that never reaches playback.
---

## Purpose

Project truth is in beats; sound is in frames at the rate the device opened. Every audible bug in this area is a conversion done at the wrong place, with the wrong tempo, or compared with the wrong tolerance. This skill covers the units, the one path between them, loop seams, tolerances and accumulation. Transport invariants for specific edits (Insert Time, Delete Time, stored controllers) live in [src/modules/Transport/AGENTS.md](../../../src/modules/Transport/AGENTS.md); native frame placement is rule 7 of `native-audio-engine`.

## Core rules

### 1. Beats are project truth; seconds and frames are derived

A position, length, tempo change, meter change, loop bound or note start is a quarter-note beat held as a float (`TempoChange.beat` in `src/modules/Transport/models/TempoMap.ts`). Names containing `Ppq` (`startPpq`, `timePpq`, `projectPpqEndpoints`) are fractional beats, not integer ticks. A bar is `numerator * (4 / denominator)` beats. Never persist a second or a frame as the position of anything the tempo map can move.

**Why:** the map edits (a tempo change, Insert Time, Delete Time) move beats, and anything stored in another unit stops following the music.

**Enforced by:** review only.

### 2. Audio media is addressed in seconds, not beats

A position inside an audio file is physical: `audioOffsetSeconds` is the canonical signed source entry, and `audioOffsetBeats` is legacy that `resolveAudioSourceOffsetSeconds` (`src/utils/audioSourceTime.ts`) converts at the tempo at the clip start, never the project base tempo. Canonical zero is authoritative over a legacy figure. Every reader of one clip's source (waveform, analysis, playback, edit helpers) must go through the same resolver.

**Why:** a tempo change must not move which sample of a recording the clip plays; readers that disagree inspect different samples than playback.

**Enforced by:** `keeps canonical clip zero authoritative over legacy clip beats` and `prefers canonical zero over a nonzero legacy offset` (`src/utils/__tests__/audioSourceTime.spec.ts`); probes in [audio-source-time](../review-stances/audio-source-time.md).

### 3. Beats become seconds only through the tempo-map integrator

Use `secondsBetweenBeats` (`TempoMap.ts`), or `readSecondsAtBeat` from `src/modules/Transport/stores/` when a handler cannot reach the model. A flat `60 / tempo` is right only while the span holds no tempo change or ramp; a linear ramp integrates (a log term), it is never averaged between its endpoints. Negative spans are legal and antisymmetric.

**Why:** one tempo over a multi-segment span is wrong by the area between the curves, so a voice drifts against every path that integrates.

**Enforced by:** `charges each segment its own tempo across an instant change`, `integrates a linear ramp rather than averaging its endpoints` and `is antisymmetric, so a span behind the playhead reads negative` (`TempoMap.spec.ts`); `TempoMapIntegration.property.spec.ts`. Review only for a bare `60 / tempo` outside a proven-flat span; no lint rule catches it.

### 4. Seconds become frames once, at the edge that knows the rate

`beatToSamples(changes, beat, defaultTempo, sampleRate)` integrates from beat 0 and rounds once (`Math.round(seconds * sampleRate)`); the scheduler places an event with `placeSamplesOnClock` in `scheduleMidiNotes.ts`. The rate is the one of the clock the frames live on: the live context's, the offline plan's, or the native stream's. In Rust, `seconds_to_frames` (`crates/sourdaw-native/src/commands/graph.rs`) is the only seconds-to-frames door and refuses non-finite, negative and past-`2^64` input. Never round a beat or a second before the final conversion, and never hardcode 44100 or 48000 in a conversion.

**Why:** a rounding step per intermediate hop accumulates, and a frame count means nothing without the rate it was counted at.

**Enforced by:** `keeps one monotonic sample timeline across multiple tempo changes` (`TempoMap.spec.ts`); `seconds_past_the_frame_range_refuse` and `seconds_at_the_exact_frame_range_boundary_refuse_and_just_below_still_convert` (`graph.rs`). Review only for TypeScript callers that pass a literal rate.

### 5. Invert with the map's own inverse

`samplesToBeat` and `beatAtSecondsFromAnchor` invert the integrator by bracketed bisection. To read a seconds figure as a beat without a device rate, call `samplesToBeat(..., 1)`, as `readNativeEngineCursorBeats.ts` does. Never invert by dividing by the local tempo.

**Why:** a local-tempo inverse oscillates across a short tempo excursion and lands on a different sample than the forward map.

**Enforced by:** `inverts exact tempo-boundary samples without changing boundary ownership` and `inverts ramp start, interior, and end coordinates within one sample` (`TempoMap.spec.ts`); the excursion probe in [audio-source-time](../review-stances/audio-source-time.md).

### 6. Two changes on one beat: arrive at the first, govern from the last

List order is what says so. A ramp that ends on a shared beat integrates to the first change's tempo; the governing tempo starts from the last. Every reader of the list must honour it: `getTempoAtBeat`, `secondsBetweenBeats`, `addTempoChange` and `projectEngineTransportMaps`.

**Why:** a reader that picks one change on a shared beat reads a different tempo from every other reader at the step.

**Enforced by:** the `a ramp that arrives on a beat shared by two changes` block (`TempoMap.spec.ts`); `opens one segment on a beat shared by an arrival and a governing change, stating the governing ramp` (`projectEngineTransportMaps.spec.ts`).

### 7. Sum with the compensated clock; keep position as an integer frame

Segment durations accumulate through `advanceClock` (`TempoMap.ts`), which carries each segment's rounding error into the next. `secondsBetweenBeats(a, b)` is not `seconds(b) - seconds(a)`; only the walk from beat 0 is tabled. The scheduler's running beat advances only through `beatAtSecondsFromAnchor(changes, accumulatedPosition, deltaSec, tempo)` on each tick's elapsed seconds, and a tick's span is never charged at its start tempo or added as `deltaSec * beatsPerSecond` (`startPlayheadScheduler.ts`). The native engine counts the playhead as an integer `playhead_frames` and reads beats from segment start beats computed once.

**Why:** a plain running sum lost a source frame (4799 for 4800) over three short tempo segments, and charging a tick at its start tempo mis-steps every tick that crosses a change.

**Enforced by:** `keeps the three-row signed-source clock on frame 4800 without sample rounding` (`TempoMap.spec.ts`); `startPlayheadSchedulerTempoChangePosition.spec.ts`; `beats_integrate_across_a_tempo_change_rather_than_scaling_the_last_tempo` (`crates/daw-engine/src/transport_map.rs`).

### 8. The engine takes seconds, flat segments and a rate-bound map

`projectEngineTransportMaps` sends seconds, never frames, because only the engine knows its device rate. A ramp becomes flat segments, each stating the mean tempo of its span (`60 * Δbeat / Δseconds`), so the engine's integral lands on the arrangement's beat at every boundary. Segments that round onto one frame keep the last (`last_per_frame`). `TempoMap::new` bakes the sample rate into its beat integral and `GraphCommand::SetTransportMaps` retires a map built for another rate unapplied; a device that opens at a new rate gets new maps.

**Why:** a segment stating its left endpoint leaves the engine permanently behind the arrangement, and a 44.1 kHz map read at 48 kHz puts every beat 8.8 percent off.

**Enforced by:** `reaches beat 4 at the second the arrangement reaches beat 4 after a 120 → 240 ramp` (`projectEngineTransportMapsRampBeatCount.spec.ts`); `a_projected_ramp_counts_beats_exactly_when_each_segment_states_its_span_mean` (`transport_map.rs`); `a_map_built_for_another_sample_rate_is_retired_unapplied` (`crates/daw-engine/src/scheduler.rs`); `tempo_segments_under_one_frame_apart_install_as_the_later_one` (`crates/sourdaw-native/src/commands/engine_transport.rs`).

### 9. MIDI windows are half-open, audio windows are inclusive, and the loop end belongs to the next pass

MIDI note and controller windows are `[fromBeat, toBeat)` (`scheduleMidiNotes.ts`): the beat that ends one window opens the next, so nothing posts twice or never. Audio clips are inclusive at `toBeat` (`scheduleAudioClips.ts` admits `clip.startBeat == toBeat`) and are deduplicated through `scheduledAudioClipsSet`, so the seam path passes `passUpTo - BEAT_EPSILON` to keep a clip sitting on `loopEnd` out of the dying pass. At a loop seam the frame at `loopEnd` is not rendered; the playhead wraps to `loopStart` when `next >= end` (`advance_playhead`), and a playhead already at or past the end plays straight through. A region shorter than `MIN_LOOP_FRAMES` is held but inert. A stored pedal lift on a clip's closing line is the one documented exception (see Transport `AGENTS.md`).

**Why:** a closed MIDI end double-fires the event on the seam and an open start drops it, while an audio clip is started once by its set and must not start early on the dying pass.

**Enforced by:** `a_loop_wraps_on_the_region_boundary_without_dropping_or_doubling_a_frame` and `a_loop_region_shorter_than_one_callback_is_held_but_not_honoured` (`scheduler.rs`, `transport_map.rs`); `schedules the note sitting exactly on the loop start once per loop pass` (`startPlayheadSchedulerSeamNotes.spec.ts`) and `never schedules material after loopEnd while the loop is on` (`startPlayheadSchedulerLoopSeamTiming.spec.ts`). The audio-clip contract is review only: no spec drives a clip exactly on `loopEnd`.

### 10. A browser seam is timed in audio seconds through the map

`projectLoopSeamWindow` hands a pass over one look-ahead early, and only for a region longer than the look-ahead; a shorter region, or a main-thread stall, takes the late wrap. The late wrap measures its overshoot in audio time from the seam, charges each extra pass the loop's own integrated span (`secondsBetweenBeats(loopStart, loopEnd)`), and re-enters the loop through `beatAtSecondsFromAnchor`, so a tempo change past `loopEnd` is never charged to the wrapped pass.

**Why:** converting the overshoot at one tempo lands the next pass off its downbeat whenever the map changes near the seam.

**Enforced by:** `lands a stall that crosses several loop seams on the pass the audio clock is in` (`startPlayheadSchedulerStall.spec.ts`), which runs a 120 to 60 BPM map with the drop past `loopEnd` and so is the case that fails on a single-tempo overshoot conversion. `requests the loop-start downbeat of every wrapped pass at or after the audio clock`, `counts the wraps the published cursor has crossed since the roll began` and `hands a late-wrapped pass over at its own loop end instead of scheduling past it` (`startPlayheadSchedulerLoopSeamTiming.spec.ts`) run on an empty tempo map and cover seam handover only.

### 11. Compare beats by their domain's tolerance, and never invent a literal

`SAME_BEAT_TOLERANCE` (1e-9, `src/modules/MIDI/models/SameBeatTolerance.ts`) makes two beats one instant for notes, controllers and spans; `src/utils` restates it as `CLIP_LOOP_WINDOW_BEAT_TOLERANCE` because utils cannot import modules. `BEAT_EPSILON` (1e-6, `TempoMap.ts`) is the tempo-map scale: the "is there a tempo or meter change at this beat" decision, Delete Time span classification, the scheduler window margins (the groove-slack floor in `scheduleMidiNotes.ts` and the `passUpTo - BEAT_EPSILON` audio window in `startPlayheadScheduler.ts`), and merging engine segments a float step apart in `projectEngineTransportMaps`. `GRID_EPSILON` (1e-9, `TimeSignatureMap.ts`) is only for bar-grid membership. A tolerance classifies; it never moves a user's bound. Delete Time classifies against its exact span with `BEAT_EPSILON`, Insert Time with none, and both go through `prepareTimelineMapTimeOperation`.

**Why:** non-dyadic grids miss exact values by about 1e-16 per beat, so a raw `===` or floor flips a pass or drops a note, and a tolerance wider than a musician can place moves material.

**Enforced by:** `loop 1.1 trimmed by 16.5 — exactly 15 loops — counts 15 occurrences` (`src/modules/AudioEngine/useCases/offlineRender/__tests__/getSourceOccurrenceOffset.spec.ts`); `excludes the loop-end note that drifts to one ulp below the ceiling` (`src/utils/__tests__/clipLoopOrigin.spec.ts`); `strikes a third-of-a-beat kick that ends on the loop end once per pass, with no wrapped tail` (`projectClipMidiEventsFloatResidue.spec.ts`); the Insert and Delete Time laws in `insertTimeLaw.property.spec.ts` and `deleteTimeLaw.property.spec.ts`. Review only for a new tolerance literal.

### 12. A bar number becomes a beat only through `getBarStartBeat`

It is the exact inverse of `getBarBeatAtPosition` at bar starts, and it counts bars the way that function does, so a bar a mid-bar meter change shortens shares its number with the bar the change opens. A flat `numerator * 4 / denominator` per bar is wrong after any meter change.

**Why:** bar snapping, the metronome accent and count-in all read the same grid; a second bar formula puts them on different beats.

**Enforced by:** `is the exact inverse of getBarBeatAtPosition at every bar start` (`src/modules/Transport/models/__tests__/TimeSignatureMap.spec.ts`).

### 13. Ticks exist only at the MIDI file boundary

Import divides `tick / ticksPerBeat` for any division and rejects SMPTE timing and a zero division (`src/modules/MIDI/workers/midiImportWorker.ts`); a same-tick note gets the minimum length 0.01 beats. Export writes 480 ticks per beat: `beatToTick` snaps to the `SAME_BEAT_TOLERANCE` grid before rounding, so beats a float apart share a tick, and orders one tick by `SAME_FRAME_EVENT_ORDER` (`src/utils/sameFrameEventOrder.ts`: release, controller, strike, expression), the table live scheduling and the offline render share, never by float beat. The `tick` in `getBarBeatAtPosition` is a display remainder; `SEQUENCER_TICK_BEATS` (1/960) is an editing resolution. Neither is a storage unit.

**Why:** rounding at both ends of an import or export, or storing ticks, makes a round trip move notes.

**Enforced by:** `rejects SMPTE-encoded timing instead of reading the division as PPQN`, `rejects a zero division rather than emitting Infinity beats` and `computes startBeat and duration from note-on / note-off ticks at 480 ppq` (`midiImportWorker.spec.ts`); `sorts the four kinds sharing one time release, controller, note-on, expression` (`src/modules/AudioEngine/useCases/offlineRender/__tests__/comparePendingWorkletEvents.spec.ts`); `encodes note start/end ticks relative to clipStartBeat, not beat 0`, `writes no note for a stored span of float-noise length` and `orders one tick as note-off, controller, note-on whatever order the rows were given in` (`exportMidiFile.spec.ts`).

## References

- [src/modules/Transport/AGENTS.md](../../../src/modules/Transport/AGENTS.md) — tempo-map invariants, Insert and Delete Time, stored-controller placement.
- [crates/daw-engine/AGENTS.md](../../../crates/daw-engine/AGENTS.md) — frame-accurate placement and the transport maps.
- [native-audio-engine](../native-audio-engine/SKILL.md) — rule 7, time as absolute frames.
- [audio-source-time](../review-stances/audio-source-time.md) and [moving-coordinate-inverses](../review-stances/moving-coordinate-inverses.md) — standing probes for source clocks and restored coordinates.
