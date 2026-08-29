---
type: adr
id: 0039
title: Transport features follow the fed-back playhead rather than moving native
status: accepted
date: 2026-08-29
owner: The Sourdaw team
sources:
    - crates/daw-engine/src/transport_map.rs
    - crates/daw-engine/src/scheduler.rs
    - crates/sourdaw-native/src/commands/engine_transport.rs
    - src/modules/AudioEngine/useCases/livePlayback/nativeEnginePlayheadFeedState.ts
    - src/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler.ts
    - src/modules/Transport/useCases/tempoMap/projectEngineTransportMaps.ts
---

# 0039 - Transport features follow the fed-back playhead rather than moving native

## Context

The native engine now carries a tempo map, a time-signature map and a loop region of its own, and
publishes where its transport actually is. That raises a question for every feature that today
derives its timing from the JavaScript scheduler's own integration of the tempo map: metronome,
count-in, pre-roll, punch, and follow actions. Each either keeps deriving its timing JS-side — now
from a playhead the engine reports rather than one the renderer guesses — or moves into the engine.

Established practice draws the line at the same place. In REAPER, Ableton Live and Cubase the
engine owns the sample clock, the loop wrap and the tempo map, because those decide _which sample
comes next_. Everything that merely _reacts to a musical position_ — the click, the count-in bars,
the pre-roll offset, the punch window, a clip's follow action — is arrangement policy evaluated
against that clock. None of those three exposes the click or the punch window as a real-time DSP
concern the user can place inside the audio graph; all three treat them as transport state that
scheduling reads.

The distinction that matters for correctness is _audible timing precision_, not _where the code
lives_. A feature whose output is a scheduled sound (the click, a punch-armed record start) needs a
sample-accurate anchor. A feature whose output is a decision about the arrangement (which bar to
start from, which clip to launch next) needs only a musically-correct position at UI rate.

## Decision

All five features stay JS-side, evaluated against the fed-back playhead. None moves native in this
slice, and none loses function.

**Metronome** — stays JS-side. `useCases/scheduling/scheduleMetronome.ts` already reads the tempo
and meter maps and schedules clicks onto the audio clock with lookahead, so its clicks are already
sample-accurate against the graph that renders them; it is not sensitive to the renderer's frame
rate. Moving it native would duplicate the meter map in two places and split the click's gain,
sound selection and accent policy across the IPC seam for no timing gain. This matches REAPER and
Cubase, where the click is a transport-driven scheduled voice rather than an engine primitive.

**Count-in** — stays JS-side, at `useCases/transportControls/toggleRecording.ts`. Its clicks already go
onto the audio clock. Its _recording start_, however, is armed on a wall-clock `setTimeout`, which
is a real drift seam independent of this decision and remains one: the fed-back playhead does not
fix it, because nothing yet reads the playhead to decide when the count-in has elapsed. That is a
defect to fix on its own, not a reason to move the feature native.

**Pre-roll** — stays JS-side, at `useCases/transportControls/startPlayback.ts`. It is purely a
start-position offset computed before the transport rolls: it picks an earlier bar and starts
there. It has no per-block behaviour at all, so there is nothing for the engine to own.

**Punch** — stays JS-side, inside the scheduler tick at
`useCases/playheadScheduler/startPlayheadScheduler.ts`. Punch decides when a record-arm window
opens and closes against a musical position; every DAW surveyed evaluates it against the transport
position rather than in the audio callback. Its accuracy ceiling is the accuracy of the position it
reads, which is exactly what the fed-back playhead improves.

**Follow actions** — stay JS-side, at `useCases/evaluateFollowActions.ts`, driven from the same
scheduler tick. A follow action is an arrangement decision — which clip plays next — and Ableton,
which originated the feature, evaluates it at clip-boundary granularity against the transport, not
per audio block.

The playhead the JS side reads is fed back from the engine over a dedicated command
(`engine_transport_position`) polled on the existing animation frame, never per audio block, and
never through the command-admission ledger's `GraphProgressSnapshot`, whose `playhead_frame` is
release evidence rather than a cursor. Adoption is gated on the live session's topology actually
carrying audio: while the native graph renders silence, Web Audio is the audible transport and its
own integration is the correct cursor.

## Consequences

- The engine owns the sample clock, the tempo and meter maps, and the loop wrap. The renderer owns
  every feature that reacts to a musical position.
- Each of the five features has exactly one implementation, and the fed-back playhead makes them
  more accurate without being rewritten.
- The count-in's wall-clock recording start is a named, separately-tracked defect; this ADR
  deliberately does not launder it as a consequence of the JS-side disposition.
- A later slice that makes the native engine the audible path inherits these dispositions unchanged:
  the features already read a position, and that position simply becomes the engine's.
