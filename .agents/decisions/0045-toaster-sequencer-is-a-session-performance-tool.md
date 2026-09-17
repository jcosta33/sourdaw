---
type: adr
id: 0045
title: The Toaster step sequencer is a session performance tool, not an arrangement source
status: accepted
date: 2026-09-17
owner: The Sourdaw team
sources:
    - src/modules/Toaster/useCases/sequencerPlayback.ts
    - src/modules/Toaster/useCases/startSequencer.ts
    - src/modules/Toaster/useCases/exportPatternToTimeline.ts
    - src/modules/Toaster/useCases/prepareOfflineToaster.ts
    - src/modules/AudioEngine/useCases/livePlayback/projectLiveMidiProgramme.ts
    - https://github.com/jcosta33/sourdaw/issues/4181
---

# 0045 - The Toaster step sequencer is a session performance tool, not an arrangement source

## Context

`startSequencer` → `sequencerPlayback.ts` is free-running: `runSequencerTick` starts from step 0 at
the moment Play is clicked (`startSequencer.ts` seeds `currentStep: 0` and `nextTickTime` from the
live audio clock), follows the transport tempo (`transportStore.value?.tempo`) but never reads or
waits on the arrangement playhead, and resolves per-step probability, `fill`/`first` conditions,
sound locks, and param locks at the moment each step schedules
(`schedulePatternStep` in `sequencerPlayback.ts`). Two clicks of Play on the same pattern can play
different hits, because probability and `fill`/`not-fill` conditions are rolled and evaluated live
against `loopIndex`, not stored.

A free-running, click-time-seeded instrument has no arrangement position: there is no beat at which
"the pattern" sits, only a beat at which Play happened to be pressed. Both offline export
(`prepareOfflineToaster.ts` renders instrument devices from clips on the timeline) and the native
live session (`projectLiveMidiProgramme.ts` projects MIDI notes from track clips) render what is
_on the timeline_. Neither can render "the hits the browser session sounds," because that set is not
a function of arrangement time — it depends on when Play was pressed and what the RNG rolled that
time. The only arrangement-anchored, reproducible truth the Toaster pattern has is what
**To timeline** (`exportPatternToTimeline.ts`) bakes onto the Toaster's child tracks: ordinary MIDI
clips that export and native playback already know how to render.

That bake is deliberately lossy. `exportPatternToTimeline.ts` (lines 13-33) is faithful to every
dimension a plain MIDI note can carry — start time (including micro-timing and swing), duration,
velocity (including the retrigger decay curve), and clip length derived from the pattern's own step
grid — but intentionally drops per-step sound locks and param locks (no per-note engine/parameter
override exists on a MIDI note) and per-step `probability` and runtime `condition`s (`fill`,
`not-fill`, `first`, `not-first`), which depend on play-time loop state and cannot be frozen into a
static clip without widening `addMidiNote`'s surface. A note in the clip is a note; a `probability:
0.5` step is not "there half the time" in the export.

Established DAW convention treats this split the same way. Logic Pro's Step Sequencer plays a pattern
region placed on the timeline — arrangement-anchored, because the whole point of a pattern _region_
is that it occupies a span of the timeline like any other clip. FL Studio's Channel Rack pattern
similarly becomes arrangement truth only once placed as a block in the Playlist; auditioning it from
the Channel Rack step grid is a preview. A hardware drum machine's internal sequencer, or Native
Instruments Maschine's pattern-preview transport, is a performance surface: pressing its own Play
plays the pattern from the machine's own clock, unconnected to a host arrangement position, and
nothing downstream treats that performance as a bounce source. Toaster's `startSequencer` is this
second kind of control, not the first.

## Decision

The Toaster step sequencer stays a session-only performance and sketch tool. No projector is built to
make it arrangement-aware, and no attempt is made to make offline export or native live playback
render live sequencer state directly. The arrangement truth of a Toaster pattern is exactly what
**To timeline** has baked onto the Toaster's tracks — nothing more, nothing less — and export and
native playback continue to render only that.

The product says this rather than leaving it to be discovered as a silent gap:

- The Toaster panel's Transport card carries an inline hint next to Play / To timeline stating that
  Play sounds the pattern live only, and To timeline is what reaches export and native playback.
- The export dialog warns, per Toaster device, when an active pattern exists that has never been
  baked to a clip — naming the device and its track — without blocking the export. Export already
  renders whatever _is_ baked; the warning exists so a musician who only ever hit Play never gets a
  silent bounce.

This resolves the open question in `exportPatternToTimeline.ts`'s own docstring and in
`.agents/decisions/open-decision-docket.md` ("Is `exportPatternToTimeline` meant to be lossy or
full-fidelity?"): lossy by design, because the fields it drops have no static representation, not
because fidelity was left unfinished.

## Consequences

A musician who never presses To timeline gets a session that sounds right while Play is held down
and an export/native session that is silently missing that instrument — mitigated, not eliminated, by
the panel hint and the export advisory. The advisory is heuristic in one direction: it flags an active
pattern with no baked notes on its own or child tracks, but it cannot tell a deliberately un-exported
sketch from an oversight, so it is a warning, never a gate.

The bake stays permanently lossy. Widening it to carry probability, conditions, or locks would mean
widening `addMidiNote` and every consumer of a MIDI note's shape for a feature that only this one
instrument uses — out of scope for this decision and not undertaken here.

A future arrangement-anchored pattern region — a clip type that stores step data and re-resolves it
against timeline position the way Logic's Step Sequencer regions or FL's Playlist patterns do — would
be a new feature warranting its own ADR. It is not an extension of the free-running sequencer this
ADR describes; it would be a different playback model with its own scheduling rules, sitting beside
today's Play button rather than replacing it.
