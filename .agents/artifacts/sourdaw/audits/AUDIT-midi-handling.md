---
type: audit
id: AUDIT-midi-handling
---

# Audit — MIDI handling vs. a first-class DAW standard

Audit only. No fixes applied. Diff is this artifact.

- Branch: `audit/midi-handling`  ·  base `origin/main` @ `3a99a84`
- Scope: MIDI scheduling, live Web MIDI input, MPE, tempo-map projection, groove
  determinism, live↔offline parity, note-off/hanging-note guarantees.
- Method: source + caller + engine-surface inspection, anchored to `file:line`.
  No behavioural repro was run; every dynamic claim below is grounded in read
  code paths and is labelled where a run would be needed to close it.

Paths are relative to repo root. All are under
`.agents/worktrees/audit-2/` in this worktree.

---

## Golden Standard (citations)

Properties expected of first-class MIDI in a browser+native DAW, with authorities.

1. **Lookahead scheduling against the audio clock.** Once a Web Audio event is
   scheduled it cannot be unscheduled, so a sequencer must run a short
   periodic lookahead (schedule a small window ahead, wake often, re-read
   tempo/transport each wake) synchronised to `AudioContext.currentTime`, not
   `Date.now()` or a bare `setInterval`. Chris Wilson, *A Tale of Two Clocks*
   — https://web.dev/articles/audio-scheduling
2. **Live input uses the event timestamp, not handler-run time.** The Web MIDI
   API delivers `MIDIMessageEvent.timeStamp` (a `DOMHighResTimeStamp` for when
   the message was received) and `MIDIOutput.send(data, timestamp)` for
   future-scheduling; using the timestamp is how you keep live jitter below the
   main-thread event-loop noise floor. W3C *Web MIDI API* —
   https://www.w3.org/TR/webmidi/
3. **Jitter budget for live/clock timing is sub-millisecond-class.** DAW MIDI
   jitter is audible because MIDI, audio and UI run on separate clocks; the
   target is tight, low-single-digit-millisecond-or-better and, crucially,
   *consistent* delivery. Ableton, *MIDI Fact Sheet* —
   https://www.ableton.com/en/manual/midi-fact-sheet/
4. **MPE is per-note expression across a channel zone.** A zone is one Master
   Channel + N Member Channels; each sounding note occupies its own member
   channel and carries continuous per-note Pitch Bend (±48 st member default),
   Timbre (CC74) and Pressure (Channel Pressure). A receiver must route these
   to the *individual* voice, continuously, for the note's lifetime. MMA,
   *MIDI Polyphonic Expression v1.0* —
   https://d30pueezughrda.cloudfront.net/campaigns/mpe/mpespec.pdf ·
   overview: https://midi.org/mpe-midi-polyphonic-expression
5. **Note-off / hanging-note guarantees.** Every note-on has a guaranteed
   note-off; transport stop, loop wrap, track/device change and panic must all
   emit All-Notes-Off so no voice sustains after the trigger context ends.
   (MPE spec §note-management; standard DAW practice, Ableton fact sheet.)
6. **Tempo-map projection must be analytically correct.** Beat↔time under a
   *linear* tempo ramp is the integral of 60/tempo over beats, i.e. a
   logarithmic time function, not a linear interpolation of durations; a step
   ("instant") change is a piecewise constant rate. (Standard result;
   cross-checks against the ramp math below.)

---

## Current-State Map

| Concern | Location |
| --- | --- |
| Scheduler clock (worker) | `src/modules/Transport/workers/schedulerWorker.ts` — `setInterval` in a Worker, min 10 ms |
| Lookahead loop / playhead | `src/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler.ts` — `SCHEDULE_AHEAD_SECONDS = 0.1`, grain default 10 ms (`models/TransportState.ts:38`) |
| Session mutables + re-entrancy guard | `.../playheadScheduler/schedulerSession.ts` |
| Stop / teardown | `.../playheadScheduler/stopPlayheadScheduler.ts` |
| MIDI note dispatch | `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts` |
| Swing projection | `src/utils/toasterSwingProjection.ts` (Toaster), groove via MIDI projections |
| Tempo-map math (beat↔sample, ramp integral) | `src/modules/Transport/models/TempoMap.ts` |
| PPQ endpoint projection | `src/modules/Transport/useCases/projectPpqEndpoints.ts` |
| Probability (deterministic) | `src/modules/MIDI/useCases/shouldPlayMidiEvent.ts` |
| Groove commit projection | `src/modules/MIDI/useCases/grooveTemplates/projectCommittedGroove.ts`, `projectClipMidiEvents.ts` |
| Live Web MIDI entry / parse | `src/modules/MIDI/useCases/webMidiInput/handleWebMidiMessage.ts`, `repositories/webMidi/messageHandlers.ts` |
| Live note on/off | `.../webMidiInput/handleWebMidiNoteOn.ts`, `handleWebMidiNoteOff.ts` |
| Live MPE expression | `.../webMidiInput/handleWebMidiPitchBend.ts`, `handleWebMidiChannelPressure.ts`, `handleWebMidiCC.ts` |
| Realtime Yeast bridge | `src/modules/MIDI/repositories/webMidi/processRealtimeMidiInput.ts` |
| Live state / reset panic | `.../repositories/webMidi/lifecycle/resetMidiState.ts`, `destroyWebMidi.ts`, `routeYeastNoteOff.ts` |
| Engine All-Notes-Off surfaces | `src/modules/AudioEngine/engine/{FermenterNode,GrandBouleNode,LevainNode,ToasterNode}.ts` |
| Stop → engine note release | `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:1049` `stopAllScheduled` |
| Offline MIDI render (freeze/bounce) | `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts`, consumed by `freezeTrack.ts:63`, `bounceTrack.ts:52`, `bounceSelection.ts` |
| Offline Yeast note projection | `src/modules/AudioEngine/useCases/offlineRender/projectOfflineYeastTrackNotes.ts` |
| MIDI file export | `src/modules/MIDI/useCases/exportMidiFile.ts` |

### Strengths verified (recorded so they are not re-flagged)

- **Sample-accurate scheduled playback.** Notes carry `sampleFrame`/absolute
  `time` into worklet/faust/drum dispatch (`scheduleMidiNotes.ts` per-note
  block); timing is sample-resolved at the audio thread, not quantised to the
  10 ms grain.
- **Note release on transport stop is handled.** `stopAllScheduled`
  (`createWebAudioEngine.ts:1070-1092`) fans one `allNotesOff` worklet message
  to every Fermenter/Toaster and calls `grandBouleControls.allNotesOff()` /
  `levainControls.allNotesOff()`; stopped scheduled notes do not hang.
- **Tempo-ramp math is analytically correct.** `secondsAcrossSortedTempoRange`
  (`TempoMap.ts`) integrates a beat-linear ramp with the exact closed form
  `((Δbeat·60)/startTempo)·ln(1+r)/r` (`Math.log1p`), and treats `instant`
  changes as piecewise-constant. Matches golden-standard §6.
- **Deterministic, seeded probability, shared live↔offline.**
  `shouldPlayMidiEvent` (FNV-1a mix + avalanche over seed+clipId+eventId+
  occurrence) is pure and is the same function wired as
  `selectMidiEventProbability` for offline render (`app/bootstrap.ts:171`), so
  probability is reproducible and parity-correct.
- **Worker-thread clock** dodges background-tab `setInterval` throttling
  (`schedulerWorker.ts` header); async ticks are guarded by `tickInFlight` +
  `generation` + `discontinuityEpoch` against overlap and stale resumption.

---

## Findings

Severity: Blocker / Major / Minor / Polish. Remediation effort S/M/L.
Counts: 2 Blocker · 2 Major · 3 Minor · 1 Polish.

> **PR #693 review adjudication (both open questions closed):** MD-2 and MD-4
> are escalated to **Blocker**. MPE is user-facing (PianoRoll toolbar + GrandBoule
> panels), so a non-sounding MPE feature ships a visible dead control. And
> `renderTrackOffline` output is **deliverable audio** — `freezeTrack.ts:63` and
> `bounceTrack.ts:52` consume it, the frozen buffer plays live and bounced
> buffers are cached as clips (`bounceTrack.ts:64-70`) that enter exports — so
> the triangle-oscillator stub corrupts shipped audio, not just a preview.

### MD-2 — MPE per-note expression never reaches any real instrument — Blocker (fix L)

Per-note expression is captured but not sounded, and the feature is
**user-facing** — exposed through the PianoRoll toolbar and GrandBoule panels —
so an MPE-enabled session presents live controls that make no sound.

- Pitch Bend (`handleWebMidiPitchBend.ts`) applies only to `noteData.osc`
  (the fallback oscillator). Fermenter/GrandBoule/Levain/Toaster notes set
  `noteData.fermenterDeviceId` etc. and have **no `osc`**, so bend is a no-op
  for them.
- Channel Pressure (`handleWebMidiChannelPressure.ts`) and CC74 slide
  (`handleWebMidiCC.ts`, `MPE_SLIDE_CC`) only **store** `noteData.pressure` /
  `noteData.slide` for later recording — they are never sent to any live synth.
- The flagship synth's control surface has no per-note expression input:
  `FermenterNode` exposes `noteOn(note, velocity, sampleFrame)`, `noteOff`,
  `allNotesOff`, `setParam`, `setPatch` (`FermenterNode.ts:104-155`) — no
  pitch-bend/pressure/timbre-per-note entry point.
- In scheduled playback, `scheduleMidiNotes.ts` builds `mpe = {pressure, slide,
  pitchBend}` but passes it **only** to the fallback `scheduleNote(...)`
  branch; the worklet-synth branch calls
  `workletSynthControls.noteOn(pitch, vel, sampleFrame)` and drops it. Recorded
  MPE data also never plays back through Fermenter.
- Even on the fallback path, MPE values are a single static per-note number,
  not the continuous per-note streams MPE requires (golden-standard §4).

Failure mode: `setMpeEnabled` / zone tracking (`channelToNote`) exist and route
note-stealing correctly, but expression is inaudible on every shipping
instrument. MPE reads as present (visible toolbar/panel controls) yet does
nothing musical. Blast radius: all MPE controllers and every user who toggles
the visible MPE controls.

### MD-4 — Offline freeze/bounce renders every MIDI instrument as a triangle oscillator, into deliverable audio — Blocker (fix L)

`renderTrackOffline` (`freezeBounce/renderOffline.ts`) is the sole offline
render for freeze, bounce-track and bounce-selection, and its output is
**shipped audio**, not a preview:

- `freezeTrack.ts:63` renders the track offline and installs the buffer as the
  track's frozen source — the frozen buffer plays back live in place of the
  instrument.
- `bounceTrack.ts:52` renders offline, then caches the buffer as a real clip
  (`bounceTrack.ts:64-70`, `cacheAudioBuffer` → `bouncedClip`); bounced clips
  are project material that flows into exports.

Its MIDI branch synthesises every scheduled note with a fixed placeholder voice
(`renderOffline.ts:289-303`): `osc.type = 'triangle'`, a hard-coded
5 ms/10 ms AD envelope, `velocity/127*0.3` gain — regardless of the track's
actual device. No `createFermenterNode`/WASM instrument is instantiated in the
offline path (confirmed: `OfflineAudioContext` there only drives oscillators
and buffer sources).

- Note *timing/pitch/probability* parity is good — offline reuses
  `projectPpqEndpoints`, `projectOfflineYeastTrackNotes`,
  `selectMidiEventProbability`, `projectPitch` (`renderOffline.ts:181-276`).
- But *timbre* parity is absent: a frozen/bounced Fermenter/GrandBoule/Levain/
  Grinder/Toaster track sounds nothing like live playback.

Failure mode: freeze and bounce corrupt shipped audio for any MIDI instrument
track — the deliverable is a triangle-oscillator caricature of the real synth.
Blast radius: every freeze/bounce of a non-drum MIDI instrument track, and any
export that includes bounced/frozen material.

### MD-1 — Live input ignores the MIDI event timestamp; notes fire at handler-run time — Major (fix M)

`parseWebMidiMessage` (`repositories/webMidi/messageHandlers.ts:39-84`) reads
only `event.data` and **discards `event.timeStamp`**. Every live handler then
reads `engine.context.currentTime` at the moment it runs
(`handleWebMidiNoteOn.ts`: `const now = engine.context.currentTime`) and
dispatches the voice immediately (non-Yeast Fermenter path:
`fermenterControls.noteOn(note, velocity)` with no sampleFrame → "now").

- Failure mode: live-note onset jitter equals main-thread event-loop + GC +
  render jitter, not the sub-ms-class of golden-standard §2/§3. The high-res
  arrival time the browser already provides is thrown away.
- Firing condition: every live note, always; worst under UI load.
- Blast radius: all live keyboard/controller performance and (via
  `handleWebMidiNoteOff` wall-clock duration) recorded note lengths.

### MD-3 — Expression events race ahead of the async note-event tail; initial MPE expression is dropped — Major (fix M)

`handleWebMidiMessage` routes `noteOn`/`noteOff` through `dispatchMidiHandler`,
an **async serial promise tail** (`midiInputTail`), while `cc`,
`channelPressure` and `pitchBend` are dispatched **synchronously, off the
tail**.

- Ordering inversion: a note-on is queued behind the tail (a Yeast track's
  handler `await`s a Worker round-trip via `processRealtimeMidiInput`), but a
  pitch-bend/pressure/CC74 that a controller sends together with (or just
  after) that note-on runs first. The expression handler looks up
  `channelToNote.get(channel)` — not yet set, because the note-on handler
  hasn't run — and returns early. The note's opening bend/pressure/timbre is
  silently lost. MPE controllers routinely send an initial per-note bend at
  note-on, so this bites the common case.
- Backpressure: under a fast passage on a Yeast track, per-note `await`s make
  the tail grow, adding cumulative, variable latency to subsequent live notes
  (compounds MD-1).

Failure mode: dropped opening expression + variable added latency. Firing
condition: any MPE controller, or any Yeast-track live input under load.
(Closing this to a measured number would need a controller/emulated-input run.)

### MD-5 — Mid-playback tempo/loop edit cuts in-window MIDI notes without re-emitting them — Minor (fix M)

On a live tempo-map or loop-region change, `runTick`
(`startPlayheadScheduler.ts`) clears the *audio-clip* dedup sets and calls
`stopAllScheduled()` (→ `allNotesOff` to synths) + `stopActiveSources()`, so
audio clips re-align at the new rate. MIDI notes have **no dedup set**; they are
gated by the monotonic high-water mark `lastScheduledBeat`, which is **not
reset** here. Any MIDI note already emitted into the current ~100 ms lookahead
is silenced by `allNotesOff` and then blocked from re-emission
(`unswungStartBeat <= lastScheduledBeat`).

Failure mode: notes sounding/queued at the instant of a tempo or loop edit are
cut and never replayed — an audible dropout inconsistent with the audio-clip
path. Blast radius: bounded to one lookahead window per edit; edit-heavy
sessions only.

### MD-6 — No mid-session MIDI panic for a stuck live note — Minor (fix S)

Live All-Notes-Off / `activeNotes.clear()` fires only on device reset/teardown
(`resetMidiState.ts:24`, `destroyWebMidi.ts:41`). Transport stop
(`stopPlayheadScheduler.ts`) does not touch the live `activeNotes` map. There is
no user-triggered panic to recover a live voice whose hardware note-off was
lost (cable pull, buffer drop, MPE channel churn).

Failure mode: a dropped note-off leaves a hanging live voice with no recovery
control short of switching MIDI devices. Blast radius: live performance edge
cases; low frequency, high annoyance. (A dedicated panic is standard DAW kit.)

### MD-7 — CC input is 7-bit only; no 14-bit high-resolution CC — Minor (fix M)

`handleWebMidiCC` / `parseWebMidiMessage` treat every CC as a 7-bit value
(`value: data[2]`). No MSB/LSB pairing (CC 0-31 with 32-63) is assembled, so
high-resolution controllers collapse to 128 steps. Pitch Bend *is* correctly
14-bit (`(msb << 7) | lsb`), and MPE Timbre (CC74) is 7-bit by spec, so MPE
itself is unaffected; the gap is general high-res CC and automation capture.

### MD-8 — Pitch-bend ranges are hard-coded and ignore controller sensitivity — Polish (fix S)

`handleWebMidiPitchBend.ts` fixes MPE member bend at ±48 st
(`MPE_BEND_RANGE_CENTS = 48*100`) and non-MPE bend at ±2 st
(`STANDARD_BEND_RANGE_CENTS = 200`). These match MPE defaults but are not
configurable and ignore RPN 0 (Pitch Bend Sensitivity) / the MPE Configuration
Message a controller may send. A controller set to a non-default range detunes
incorrectly.

---

## Remediation Roadmap

Ordered by musical impact — the two Blockers lead. (Roadmap only — no changes
made.)

1. **MD-2 / MD-4 — first-class real-synth voice path (L, Blockers).** Root cause
   is shared: the real synth voice is not addressable per-note off the audio
   thread, and the offline path never instantiates it.
   - Give the worklet instruments a per-note expression surface (member-channel
     bend/pressure/CC74 → voice) and route both live (`handleWebMidi*`) and
     scheduled (`scheduleMidiNotes` mpe branch) through it — fixes MD-2.
   - **Converge freeze/bounce onto the real-synth graph**, targeting
     `AudioEngine/useCases/renderOffline.ts` (render through the actual
     instrument nodes in an `OfflineAudioContext`) rather than improving the
     `Arrangement/.../freezeBounce/renderOffline.ts` triangle stub — fixes MD-4.
     Do not invest in the stub; replace it.
2. **MD-1 / MD-3 — live-timing correctness (M).** Thread `event.timeStamp` into
   a short output-side schedule-ahead; put note and expression events on **one**
   ordered queue (drop the split sync/async dispatch) so per-note expression
   cannot overtake its note-on.
3. **MD-5 (M).** Give MIDI the same re-emit-on-edit treatment as audio clips
   (rewind `lastScheduledBeat` to the current position on tempo/loop change).
4. **MD-6 (S), MD-7 (M), MD-8 (S).** Panic command over the live map; 14-bit CC
   pairing; honour RPN 0 / MPE Configuration for bend range.

### Proposed regression tests (not added)

- `scheduleMidiNotes`: a note with `pitchBend/pressure/slide` on a Fermenter
  track asserts the value reaches the worklet control (fails today — MD-2).
- `handleWebMidiMessage`: pitch-bend delivered immediately after a Yeast-track
  note-on asserts the bend is applied to that note (fails today — MD-3).
- `renderTrackOffline` / new `AudioEngine/.../renderOffline`: a Fermenter MIDI
  track asserts the offline graph instantiates the Fermenter node, not a bare
  oscillator (fails today — MD-4).
- `startPlayheadScheduler`: tempo edit mid-lookahead asserts a note in the
  window still sounds at the new rate (fails today — MD-5).

---

## Open Questions

Both prior open questions were adjudicated in PR #693 review and folded in
(MD-2 and MD-4 escalated to Blocker). Remaining:

- MD-1/MD-3 severity in real jitter terms needs a controller-in-the-loop or
  emulated-`MIDIMessageEvent` run; this audit did not execute one.
- Whether the intended `AudioEngine/useCases/renderOffline.ts` convergence
  target already has partial real-instrument offline scaffolding to build on, or
  is net-new.
