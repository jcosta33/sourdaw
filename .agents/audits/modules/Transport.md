# Transport module audit

## Scope

This audit covers `src/modules/Transport/` in full — all use cases, handlers,
repositories, services, models, stores, presentations, workers, errors, and
their tests. It includes the playhead scheduler, scheduling sub-pipeline
(`scheduleAudioClips`, `scheduleMidiNotes`, `scheduleMetronome`, automation
application), tempo & time-signature maps, loop region & loop-station, punch
recording, setlist, and the various transport controls (play/stop/record/seek/
pre-roll/count-in).

It explicitly excludes: deep behavioural review of the upstream `Command`
module, the `Arrangement`/`AudioEngine`/`Automation`/`MIDI`/`Synth` modules
this code calls into, and the React-host shell — except where Transport
directly imports from those modules.

It is an adversarial review: tempo/time-signature change correctness,
loop-region edge handling, play/stop/record state-machine races, position
jitter, metronome scheduling, samples↔beats↔seconds conversions,
audio-thread allocation rules, bus-architectural drift, and lazy tests.

Related spec: none on disk.

---

## Goal

A correctness-first transport surface for the DAW:

- The scheduler advances `playheadPosition` from a **single, monotonic source
  of truth** (the audio-clock-derived `accumulatedPosition`), drives all
  per-tick scheduling deterministically, and recovers from tempo /
  time-signature / loop / seek / record-state changes without dropped or
  duplicate events.
- **Tempo, time-signature, and loop changes are atomic from the user's
  perspective.** Mid-playback changes do not double-schedule a beat, drop a
  metronome click, or desync the engine's transport-info SAB.
- **Play / stop / record state transitions are sequenced.** Two rapid
  toggles, or a "stop while count-in is running", or a "stop while a
  punch-region is being committed" never leave the system in a halfway
  state (recording active but transport stopped, scheduler running but
  isPlaying false, etc.).
- **No blocking, locking, or per-tick allocation** in the scheduler tick
  hot path. Per-tick `Map`/`Set` rebuilds, slice/reduce calls, and
  unbounded JS objects are forbidden.
- **Beats↔seconds↔samples conversions** are derived from the same
  `getTempoAtBeat` source, in one place per quantity. No "use
  `transport.tempo`" shortcut paths that ignore the tempo map.
- **The metronome and the scheduler never disagree** on which beat is
  "current" after a loop wrap, a tempo change, or a count-in completion.
- AGENTS.md hard rules: one function per `useCases/`/`repositories/` file,
  cross-module imports only via the destination's root barrel, no `any`
  / `as unknown as ...`, no `useMemo`/`useCallback`/`React.memo`, no
  `forwardRef`, models stay private, tests assert real contracts.

---

## Relevant code paths

- `src/modules/Transport/useCases/playheadScheduler.ts` (the tick loop)
- `src/modules/Transport/workers/schedulerWorker.ts` (~10 ms timer)
- `src/modules/Transport/useCases/scheduling/scheduleMetronome.ts`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`
- `src/modules/Transport/useCases/scheduling/applyAutomation/*`
- `src/modules/Transport/useCases/transportControls/*` (playback / record / seek / loop / count-in)
- `src/modules/Transport/useCases/loopStation/*` (live-looping)
- `src/modules/Transport/useCases/punchRecording/*`
- `src/modules/Transport/useCases/setlist/*`
- `src/modules/Transport/useCases/tempoMap/*` and `tempoMapping/operations/*`
- `src/modules/Transport/useCases/timeSignatureChanges/*`
- `src/modules/Transport/useCases/transportQueries/*`
- `src/modules/Transport/useCases/evaluateFollowActions.ts`
- `src/modules/Transport/handlers/transport/*`
- `src/modules/Transport/models/TempoMap.ts`,
  `models/TimeSignatureMap.ts`, `models/TransportState.ts`,
  `models/TempoMappingTypes.ts`, `models/loopStationHelpers.ts`,
  `models/punchRecordingHelpers.ts`, `models/setlistItemHelpers.ts`
- `src/modules/Transport/stores/transportStore.ts`,
  `stores/tempoMapStore.ts`, `stores/timeSignatureMapStore.ts`,
  `stores/playheadPositionRef.ts`, `stores/loopStationStore.ts`,
  `stores/punchRecordingStore.ts`, `stores/setlistStore.ts`
- `src/modules/Transport/presentations/views/SetlistPanel.tsx`,
  `LoopStationPanel.tsx`, `PunchRecordingControls.tsx`

---

## Current behavior

**Scheduler core.** `playheadScheduler.ts:83-280` boots a `Worker`
running a 10-ms `setInterval` (`workers/schedulerWorker.ts:22`). On every
tick the main thread reads `ctx.currentTime`, computes a `deltaSec`,
multiplies by `(currentTempo / 60)` to get `deltaBeats`, and advances
`schedulerSession.accumulatedPosition`. It then evaluates loop wrap,
follow-actions, syncs `audioEngine.setTransportInfo(...)`, optionally
flips into a punch-recording branch, and finally schedules metronome,
MIDI, audio clips, automation, and adjustment layers up to
`SCHEDULE_AHEAD_SECONDS = 0.1` seconds ahead.

**Scheduler session state.** A module-level
`schedulerSession` object (`playheadScheduler.ts:56-66`) holds the
`Worker`, `lastTickTime`, `accumulatedPosition`, `lastScheduledBeat`,
two scheduled-clip `Set`s, an `activeAudioSources` array, a
`punchRecordingActive` boolean, and a `onStopRequested` callback. There
is no per-session id; calls to `startPlayheadScheduler` mutate the
singleton in place.

**Transport controls.** `transportControls/*` are one-function-per-file
shims that read `transportStore` and dispatch `updateTransportState(...)`.
Most do not touch the engine; the heavyweight ones (`startPlayback`,
`stopPlayback`, `pausePlayback`, `seekPlayhead`, `toggleRecording`)
orchestrate the scheduler and `AudioEngine`/`Arrangement` use cases.

**Tempo map.** `models/TempoMap.ts:17-42` resolves the tempo at a beat
by sorting on every call, then linearly interpolating between the prev
and next change for `'linear'` curves; `'instant'` returns the prev
value. `tempoMapStore` is an Automerge-backed CRDT with `{ changes:
TempoChange[] }`.

**Time-signature map.** `models/TimeSignatureMap.ts:17-72` mirrors the
shape — sort, scan, last-before-beat wins. `getBarBeatAtPosition`
walks segments to compute `(bar, beat, tick)` from a beat position;
`tick` is hard-coded to a 480-PPQ resolution.

**Metronome scheduling.** `scheduleMetronome.ts:9` keeps a
module-level `_lastMetronomeBeat`, advances by integer beats from
`Math.ceil(fromBeat)` to `Math.floor(toBeat)`, queries
`getTempoAtBeat` per beat, and accents on `beat % numerator === 0`
(numerator from time-signature at that beat).

**Loop wrap.** `playheadScheduler.ts:116-145` triggers when
`newPosition >= current.loopEnd && current.loopEnd > current.loopStart`.
On wrap it (a) (if recording) creates a take, (b) wraps via
`loopStart + ((newPosition - loopStart) % loopLength)`, (c) resets
`lastScheduledBeat`, (d) calls `resetMetronomeBeat`, (e) calls
`stopAllScheduled` and `stopActiveSources`, and clears the two scheduled-set
caches.

**Punch recording.** `playheadScheduler.ts:184-229` arms a punch
recording when `punchInEnabled && newPosition >= punchInBeat`,
auto-creates a recording clip via `startRecording()`, and
de-arms when `newPosition >= punchOutBeat`.

**Tempo detection.** `tempoMapping/operations/detectProjectTempo.ts`
runs a histogram over inter-onset intervals (binWidth = 2 BPM), picks
the largest bin, smooths via 5-point window, and writes the resulting
average into `transportStore.tempo` only if `confidence > 0.5`. The
`estimateOnsetsFromClips` helper is a stub: it generates one onset per
beat for every MIDI clip — not actual onsets.

**Loop-station.** `loopStation/*` use cases mutate a separate
`loopStationStore` (no CRDT storage). State machine per slot: `empty
→ recording → playing → overdubbing → playing → ...`. There is no
audio capture wired through; layers are placeholder records with
volume/muted/recordedAt only.

**Tests.** Every public file has a spec; spec count is high
(`__tests__` folders for stores, useCases sub-folders, handlers).

---

## Findings

> **Adversarial review pass (2026-04-28)** — every numbered open issue
> below was re-verified against the current source. Items that were
> validated as still-broken are marked `[VERIFIED]`; items refined or
> downgraded carry an inline note. New issues uncovered in this pass
> sit at #71+ in this Findings section and as new sections in
> `## Open issues` (#41+). Severity bumps are spelled out under
> `## Priorities` with a one-line rationale.

1. **The scheduler has no monotonicity guard.** `playheadScheduler.ts:107`
   computes `deltaSec = now - lastTickTime` from `audioContext.currentTime`,
   which can stall (audio context suspended) or jump (after `resume()`).
   A long `deltaSec` after tab-throttling is then multiplied by
   `currentTempo/60` to advance `accumulatedPosition` in one giant
   leap, which **skips past every beat in the gap** (metronome misses,
   MIDI noteOn skipped, audio clips never `start()`). The scheduler is
   driven by a Worker `setInterval`, so the gap effect is real even
   though the Worker itself is exempt from background-tab throttling —
   if the audio context suspended, `ctx.currentTime` froze.

2. **Tempo at beat is computed from `accumulatedPosition` _at_ the
   last position, not integrated across the tick.** `playheadScheduler.ts:111`
   reads `currentTempo = getTempoAtBeat(changes, accumulatedPosition,
   …)` and applies it to the entire `deltaSec` interval. If a tempo
   change lies **inside** the tick window, the entire interval is
   advanced at the prev-tempo, producing a "tempo step" delay equal
   to (deltaSec × tempo-ratio) at the tempo change beat. With a 10 ms
   grain that's tens of milliseconds of position error every time you
   cross a tempo change.

3. **`tempo` is captured once per tick but `scheduleMidiNotes`,
   `scheduleAudioClips`, `scheduleMetronome` re-resolve `getTempoAtBeat`
   per-event.** This means the position bookkeeping uses one tempo and
   the audio-time placement uses another. For a `'linear'` tempo
   curve, the per-event re-resolution will not equal the integrated
   `accumulatedPosition`, drifting the audio relative to the playhead
   readout.

4. **Scheduling in `scheduleAudioClips` mixes `currentTempo` and
   per-clip `clipTempo`.** `scheduleAudioClips.ts:132` resolves the
   clip's tempo at `clip.startBeat`, then computes `iterStartTime =
   getCurrentTime() + beatOffset / (currentTempo / 60)`
   (`scheduleAudioClips.ts:182`) using the **scheduler's** tempo, but
   the duration `iterDurationSeconds = iterDurationBeats /
   clipBeatsPerSecond` (`scheduleAudioClips.ts:147`) uses the
   **clip's** tempo. With any tempo curve at all, the clip's audible
   duration drifts from its visual duration.

5. **`stopAllScheduled()` + `stopActiveSources()` are called on loop
   wrap, but the `scheduledAudioClips` and `scheduledFrozenTracks`
   `Set`s are cleared _after_.** `playheadScheduler.ts:141-144`. If a
   clip's `regionStartBeat:regionEndBeat` is the same key on the next
   wrap (which it always is — they don't include the iteration index),
   the clip will be re-scheduled correctly. But the audio sources for
   the previous loop pass have already been told to `stop(now + 0.005)`
   while their `onended` handlers will _later_ run
   `activeAudioSources.splice(...)` — racing the next tick that just
   pushed new sources onto `activeAudioSources`. Result: occasional
   "ghost" stops of newly-scheduled sources because the array index
   resolved to a different source.

6. **Loop wrap only recovers when `newPosition >= loopEnd`.** If the
   user changes `loopEnd` to a beat `< accumulatedPosition` while
   playing (an edit during loop), the next tick computes `newPosition
   < loopEnd` (false) — but
   `accumulatedPosition` is past the new `loopEnd`, so the wrap never
   fires. The playhead "escapes" the loop. There is no "playhead is
   outside loop region; clamp" branch.

7. **`loopEnd <= loopStart` silently disables looping.**
   `playheadScheduler.ts:116`: `current.loopEnd > current.loopStart` is
   the guard. But `setLoopRegion(start, end)` accepts `end < start`
   (no validation in `transportControls/setLoopRegion.ts:4-10`). The
   user sees `isLooping: true`, and the loop UI shows a region — but
   playback simply ignores it.

8. **`seekPlayhead` accepts arbitrarily large beats with no
   project-end clamp.** `transportControls/seekPlayhead.ts:8-29`
   clamps below at 0 only. If the user seeks to beat 99,999, playback
   continues indefinitely, scheduling against future track clips that
   never trigger. There is no `getProjectEndBeat()` cap.

9. **`scheduleMetronome` uses module-level mutable state for
   `_lastMetronomeBeat`.** `scheduleMetronome.ts:9` stores the last
   scheduled beat globally. If two scheduler sessions ran (e.g. a
   buggy double-`startPlayheadScheduler`), they would corrupt each
   other's metronome state. More directly: `resetMetronomeBeat(0)` is
   called from `stopPlayheadScheduler` (`playheadScheduler.ts:297`),
   but `getLastMetronomeBeat` is never read — the state is
   write-only-from-outside, and the module reset happens only on the
   transport-stop path. A fast pause→play (without stop) leaves the
   `_lastMetronomeBeat` at the wrap point — playing from a different
   position will skip every metronome click whose beat ≤ the stale
   value.

10. **`scheduleMetronome` ignores tempo curves between integer
    beats.** `scheduleMetronome.ts:42`: `time = getCurrentTime() +
beatOffset / (beatTempo / 60)` uses the tempo **at** the click beat,
    but the path between `accumulatedPosition` and `beat` may contain
    a tempo change. The click is placed at the position you'd get if
    the entire span were at `beatTempo`, drifting from where the
    audio clips & MIDI notes are actually placed.

11. **`scheduleMidiNotes` discards velocity in the
    `transformedNotes[0]!` spread.** `scheduleMidiNotes.ts:296`:
    `{ ...notes[0]!, pitch: evtNote, velocity: evtVel, startBeat,
duration: endBeat - startBeat }` — when there are zero original notes
    (which can happen if the Yeast worklet produces output with no
    matching input note), `notes[0]!` throws on the non-null
    assertion. Also `notes[0]!` carries arbitrary fields (probability,
    pressure, slide, pitchBend) from a single source note onto **every**
    transformed note, regardless of which input note produced it.

12. **`scheduleMidiNotes.scheduleFrozenTrack` schedules the frozen
    buffer at "beat 0" relative to the playhead, not at the track's
    project start.** `scheduleMidiNotes.ts:136`: `const beatOffset = 0
- accumulatedPosition`. The frozen render is treated as if it begins
    at beat 0 of the song; there is no offset to where the source
    clips actually start. If the user freezes a track whose only clip
    starts at beat 32, playing from beat 0 will play the freeze
    immediately and the engine will hear silence at beat 32 (because
    the "frozen track" branch short-circuits the per-clip path).

13. **`scheduleMidiNotes` uses `note.startBeat` clamp incorrectly.**
    `scheduleMidiNotes.ts:387`: `if (noteStartBeat >= clip.endBeat ||
noteStartBeat < clip.startBeat + iterOffset) continue;` — the
    `noteStartBeat < clip.startBeat + iterOffset` check rejects **any**
    note whose groove-offset moved it earlier than the iteration's
    start. A negative groove offset on a note at `note.startBeat = 0`
    is silently dropped instead of clamped or warned.

14. **Yeast block-processing bypasses tempo curves entirely.**
    `scheduleMidiNotes.ts:211`: `const spb = transport.tempo / 60` —
    uses the **flat** transport tempo, ignoring `tempoMapStore`. So
    the time-samples computed for noteOn / noteOff in the Yeast worklet
    are wrong as soon as a tempo change exists. Block boundaries (`fromBeat
    * yeastSr / spb`, `toBeat * yeastSr / spb`,
    `scheduleMidiNotes.ts:245-246`) suffer the same flat-tempo bug.

15. **Yeast `endBeat` derivation has a hard-coded 0.25-beat fallback.**
    `scheduleMidiNotes.ts:294`: when no matching noteOff is found,
    `endBeat = startBeat + 0.25`. There is no comment justifying 0.25,
    no constant, and no relationship to the source note's duration. A
    note with `duration = 4` will be truncated to a quarter beat after
    a Yeast pass.

16. **`scheduleMidiNotes` allocates a fresh `Map<number, number[]>`,
    a `Map<number, number>` cursor, plus an array of transformed notes
    per Yeast clip per tick.** `scheduleMidiNotes.ts:259-272`. With a
    100-Hz tick and a track with Yeast enabled, that's 100 Map+arrays
    per second of GC pressure on the **main thread**, which is also
    the audio scheduler thread.

17. **`scheduleAudioClips` allocates a fresh `${clip.id}:${start}:${end}`
    string key per clip per tick.** `scheduleAudioClips.ts:102`. With
    100 audio clips per project and 100 Hz tick, that's 10k strings/s
    of GC churn — the dedup-set is the only consumer, and the dedup
    only matters across ticks of the same playback session.

18. **`scheduleAudioClips` throws away clip dedup state on loop wrap
    AND on follow-action jumps, but not on a tempo change or a loop
    region edit.** `playheadScheduler.ts:143-144` clears the sets on
    `loop-wrap` and `jump`. If the user adds a tempo change at a beat
    inside a clip's already-scheduled range, the clip's
    `iterStartTime` was computed with the old tempo — the clip
    continues playing under the new audio-clock position with the wrong
    rate alignment, but the dedup-set says "already scheduled, skip",
    so re-scheduling never happens.

19. **`scheduleAudioClips.bufferOffset` underflow guard is wrong for
    stretched clips.** `scheduleAudioClips.ts:194-204`: `bufferOffset =
elapsed * stretchRatio + clipAudioOffsetSeconds`. The
    `playDuration * stretchRatio + clipAudioOffsetSeconds - bufferOffset`
    duration argument can be negative if `bufferOffset` (computed from
    `elapsed`) exceeds the available slice — the explicit
    `if (bufferOffset < buffer.duration && bufferOffset < playDuration *
stretchRatio + clipAudioOffsetSeconds)` guard catches one case
    but not when `playDuration * stretchRatio` itself is < 0 (which
    happens for `stretchMode === 'time-stretch'` with a negative
    `stretchRatio`, currently unenforced).

20. **`scheduleAudioClips.gainNodePool` never shrinks.**
    `scheduleAudioClips.ts:37`. Every fade-in/fade-out adds to the
    pool, releases push to the pool — but if a long session creates
    many concurrent clips and then releases them, the pool grows
    monotonically. It is never trimmed, and the pool itself holds
    references to GainNodes that survive across HMR.

21. **Loop wrap data-loss on recording.** `playheadScheduler.ts:117-135`:
    on loop wrap during recording, the scheduler creates a new take per
    armed track but **does not stop and restart the underlying audio
    recording** (which is per-track, started at the punch-in / record
    start). The next take starts at `current.loopStart`, but the audio
    being captured continues writing to the previous take's buffer.
    The new take's `audioBufferId` will be set later when the **single**
    `MediaRecorder` finishes — overwriting whichever take won the
    last write.

22. **Punch recording arm/disarm double-recording bug.**
    `playheadScheduler.ts:184-229`: armed-on-tick `>=
punchInBeat` calls `startRecording()` which creates clips, and
    `startAudioRecording(track.id, …)` per armed track. If the user
    has both `punchInEnabled` AND `isRecording: true` already (e.g.
    they hit Record and then enabled punch), both branches arm — one
    via `toggleRecording` (immediate), one via the punch tick (when
    `newPosition >= punchInBeat`). The second `startAudioRecording`
    overwrites the in-flight `MediaRecorder` for the same track
    (depending on `AudioEngine` semantics).

23. **`startPlayback` does not reset `lastScheduledBeat` when
    pre-roll is active.** `transportControls/startPlayback.ts:18-24`:
    `startPosition = startPosition - preRollBeats`, then
    `updateTransportState({ playheadPosition: startPosition })`. The
    scheduler reads `state.playheadPosition`
    (`playheadScheduler.ts:93-95`) and seeds `accumulatedPosition` /
    `lastScheduledBeat` from the rolled-back position — but
    `playheadPositionRef.current` is also updated. There is no
    "playback only begins committing audio at the original position"
    branch — pre-roll is **silent** because clips before the original
    position don't exist, but the metronome / scheduler do tick. This
    isn't a bug per se; it is undocumented and unverifiable from the
    code.

24. **`pausePlayback` does not clear `playheadPositionRef.current`.**
    `transportControls/pausePlayback.ts:7-17`. After pause, the ref
    holds the last-seen position; subsequently `updateTransportState`
    modifies `transportStore.value.playheadPosition` (via, e.g., a
    seek). For one frame, the ref is stale — UI components reading
    the ref see the pre-pause position, then jump to the new one.
    `stopPlayback` does sync the ref (`stopPlayback.ts:40`); pause is
    inconsistent.

25. **`stopPlayback`'s "double-stop = jump to 0" logic compares
    `state.playheadPosition === state.loopStart`.**
    `transportControls/stopPlayback.ts:34`. Float equality across the
    `playheadPositionRef` / `transportStore` boundary is fragile — a
    rounding error on the loop wrap means the second stop press
    silently fails to jump to 0.

26. **`toggleRecording` count-in path keeps the count-in ticking
    even if the user toggles recording off mid-count.**
    `transportControls/toggleRecording.ts:97-105`: the `setTimeout`
    schedules `beginActualRecording()` after `countInDurationSec * 1000`
    ms. `recordingLifecycle.stopActiveRecording()` clears the timer,
    but the user can also call `togglePlayback`/`stopPlayback`
    instead — those don't touch `countInTimerId`. Result: the timer
    fires, `beginActualRecording()` arms, and recording starts even
    though the user pressed stop.

27. **`toggleRecording` count-in dispatches metronome clicks via
    `scheduleClick` directly on `audioContext.currentTime`, bypassing
    `_lastMetronomeBeat`.** `toggleRecording.ts:91-95`. After the
    count-in completes and `beginActualRecording`/`startPlayback` runs,
    the scheduler resets metronome via `resetMetronomeBeat(start)`.
    But during the count-in, metronome clicks land at fixed times
    independent of the tempo map — with a tempo change inside the
    pre-roll bars, they're misaligned.

28. **Count-in math ignores time-signature changes.**
    `toggleRecording.ts:84-95`: `beatsPerBar = state.timeSignatureNumerator`
    and `countInBeats = state.countInBars * beatsPerBar`. If the user
    has a time-signature change at the playhead (e.g. recording at
    bar 3 of a 4/4 → 7/8 change), the count-in assumes the **flat**
    transport numerator. So the count-in mis-counts bars relative to
    the project's actual meter at that beat.

29. **`audioEngine.setTransportInfo` is called every tick with all
    six positional args.** `playheadScheduler.ts:174-181`. Even when
    nothing has changed (tempo/loopStart/loopEnd/isLooping/isPlaying),
    the call goes through. There is no "dirty" check. This is an
    audio-thread-adjacent concern: writing the SAB on every tick is
    cheap, but the function call is positional — six unwrapped numbers
    — and any future signature change will break silently.

30. **`schedulerSession.lastScheduledBeat` initialization uses
    `state.playheadPosition - 0.0001`** (`playheadScheduler.ts:95`)
    and `newPosition - 0.0001` after a wrap. The 0.0001 epsilon is a
    magic number. At very fast tempos (300 BPM = 5 beats/sec, 200 µs
    / beat-fraction…) this can land on the same integer beat twice;
    at very slow tempos (20 BPM) it's a tenth of a beat, missing a
    real onset.

31. **`evaluateFollowActions` has "last-writer-wins" semantics
    across tracks.** `evaluateFollowActions.ts:46-48` (the `NOTE`
    comment acknowledges this) — multiple clips' follow-actions in a
    single tick result in only one `jumpToPosition` taking effect.
    With a 10 ms tick that's almost never observable, but it is a
    correctness corner case for tightly-aligned follow-actions across
    tracks.

32. **`evaluateFollowActions.play_random` uses `Math.floor(rand *
count)`** (`evaluateFollowActions.ts:111`). When `rand × count`
    equals exactly `count` (only at `rand === 1.0` which the seeded
    PRNG can't produce, but…), the `target === 0` exit on the first
    eligible clip is fine. The function does not guard against
    `count === 0` correctly though: `if (count > 0)` gates it; OK.

33. **Worker `setInterval` uses 10 ms but the worker has no
    drift correction.** `workers/schedulerWorker.ts:22`. Browser
    `setInterval` drifts (callback runtime + timer queue) — over a
    few minutes, ticks fall behind. `playheadScheduler.tick` uses
    `audioContext.currentTime`, so position is anchored to audio
    clock, but per-tick **scheduling latency** grows: by the time the
    main thread ticks, the schedule-ahead window may have shrunk
    below 10 ms, causing missed events.

34. **`detectProjectTempo` and `estimateOnsetsFromClips` are
    fundamentally fake.** `tempoMapping/operations/detectProjectTempo.ts:93-118`:
    `estimateOnsetsFromClips` enumerates **every beat** of every
    MIDI clip as an "onset", then `detectTempoFromOnsets` infers the
    tempo from those — which by construction equals
    `current transport tempo`. This is an O(beats × tracks)
    closed loop that re-detects the input tempo and then writes it
    back. UX-misleading — the user is told "we detected your tempo"
    but the function is a pure no-op.

35. **`detectTempoFromOnsets` allocates per-frame.**
    `tempoMapping/operations/detectProjectTempo.ts:62-66`:
    `bpmEstimates.slice(...)` is called **per frame** inside a for
    loop, allocating a sub-array each time. Same `slice + reduce`
    anti-pattern called out in the AudioAnalysis audit (issue #5).

36. **`adjustTempoPoint` keys by `param.beat === beat`.**
    `tempoMapping/operations/adjustTempoPoint.ts:7`. Float equality
    on a beat number, used to find a matching tempo point — a
    rounding error in the caller (e.g. user dragged a tempo curve and
    rendered a beat as 7.999999 vs 8.0) means the function silently
    no-ops. Should match by point id.

37. **`addTempoChange` and `addTimeSignatureChange` collide on
    float-equal beat keys.** `useCases/tempoMap/addTempoChange.ts:10`,
    `useCases/timeSignatureChanges/addTimeSignatureChange.ts:10`. They
    treat "existing change at this beat" as "matching `beat ===
beat`". User adds a tempo at `1.5`, exports/re-imports rounds it
    to `1.4999999`, then adds another at `1.5` — both coexist with
    near-identical beat values; `getTempoAtBeat` will pick whichever
    `Array.prototype.sort` happens to leave at the end of the
    near-tie group. Also: `addTempoChange` sorts on every insert
    (`O(n log n)` per call) when an `O(log n)` insert at the right
    place would do.

38. **`updateTempoChange` enforces `Math.max(20, Math.min(999, …))`
    but `setTempo` in the transport store enforces `20..300`.**
    `useCases/tempoMap/updateTempoChange.ts:10`,
    `useCases/setTempo.ts:6`. A user can construct a tempo curve at
    700 BPM via `addTempoChange`/`updateTempoChange`, but cannot set
    `transport.tempo` to 700. The audio engine (and metronome) will
    happily process 700 BPM — which is unstable.

39. **`createTempoChange` enforces `20..999`; `setTempo` enforces
    `20..300`; `InvalidTempoError` gates only `setTempo`.**
    `models/TempoMap.ts:12`, `useCases/setTempo.ts:6-8`,
    `errors/InvalidTempoError.ts`. The validation is split across
    three files with three different ceilings (300 vs 999 vs no
    upper bound at all in `addTempoChange`). One canonical
    `MIN_BPM`/`MAX_BPM` constant pair is missing.

40. **`scheduleMetronome` uses `_currentTempo` parameter that is
    unused.** `scheduleMetronome.ts:24`. Per-beat tempo is
    re-resolved from the tempo map (line 40); the parameter is
    underscore-prefixed but kept for signature compat with the
    scheduler's call. AGENTS.md function-signature rule: this
    function takes 5 positional args, should be a single object.

41. **`scheduleAudioClips`, `scheduleMidiNotes`, and
    `scheduleFrozenTrack` all violate the
    "single-object-param" rule.** Six, seven, four positional args
    respectively. These are hot-path functions; refactoring is more
    invasive but the violation is real.

42. **`time-signature change` does not retroactively re-bar already-scheduled
    metronome beats.** `scheduleMetronome.ts:43-49`: accent =
    `beat % ts.numerator === 0`. When the user adds a time-signature
    change between `lastScheduledBeat` and `newPosition`, the click
    that just queued is using the **old** numerator. If the new
    numerator differs, the click that should be the "1" of the new
    bar plays as a regular beat. Same for `getBarBeatAtPosition`'s
    visual readout, which is computed elsewhere (in `Arrangement` UI).

43. **Pre-roll has no countdown click.**
    `transportControls/startPlayback.ts:18-24`: pre-roll just
    rolls back the start position. No metronome flash, no visual
    indication, no audio cue. The metronome scheduler will hear
    those beats only if `metronomeEnabled` is set on the transport.

44. **`countInEnabled` and `preRollEnabled` are independent flags,
    but pre-roll is silent (just rewinds) and count-in is loud (the
    `scheduleClick` calls).** `transportControls/toggleRecording.ts:83-105`
    vs `startPlayback.ts:18-24`. There's no shared "lead-in"
    abstraction — and the user's mental model of "pre-roll vs
    count-in" is unclear from the code.

45. **`toggleRecording` count-in only fires on the recording path,
    not on `startPlayback` directly.** A user expecting "count-in
    before play (not just record)" finds it doesn't trigger from
    spacebar. Likely intentional but undocumented.

46. **`punchRecordingActive` flag in `schedulerSession` is
    not synchronized with `transportStore.isRecording`.**
    `playheadScheduler.ts:64`, `:184-228`. The scheduler's local
    `punchRecordingActive` boolean and the persisted
    `transport.isRecording` are kept in lockstep manually
    (`transportStore.set({ ...transportStore.value!,
isRecording: true })` at `:194`). If a remote CRDT update flips
    `isRecording` mid-tick, the two diverge.

47. **`transportStore.set({ ...transportStore.value! })` everywhere.**
    `playheadScheduler.ts:194`, `:228`, plus several
    `recordingLifecycle.ts` call paths. Direct store-mutation from
    inside the scheduler bypasses the `useCases/transportControls/*`
    surface — including any future validation, undo recording, or
    side-effects (e.g. notifying the engine). Cross-module imports
    rule: `playheadScheduler.ts` imports from
    `#/modules/Arrangement/...`, `#/modules/AudioEngine/...`,
    `#/modules/Automation/...` (lines 1-17) — all root-barrel,
    fine. But the direct mutation of an own-module store is an
    architecture smell.

48. **`getTempoAtBeat` sorts on every call.**
    `models/TempoMap.ts:22`. With a tempo map of 50 changes called
    per beat per scheduler tick across N MIDI notes and audio
    clips, that's N × 50 × 100Hz = `O(NM log M)` per second of
    sort work for state that mutates only on user edits. Same
    issue in `models/TimeSignatureMap.ts:27`. The map is always
    pre-sortable on insert.

49. **`getTempoAtBeat`/`getTimeSignatureAtBeat` re-allocate
    `before`/`after` arrays per call.** `models/TempoMap.ts:23-24`,
    `models/TimeSignatureMap.ts:28`. `filter()` is unnecessary —
    a single linear scan with two pointers is allocation-free.

50. **`getBarBeatAtPosition` uses the same per-call `[...changes].sort(...)`
    O(n log n) cost.** `models/TimeSignatureMap.ts:44`.

51. **`getBarBeatAtPosition` has an off-by-one at exact bar boundaries.**
    `models/TimeSignatureMap.ts:51`: `if (change.beat >= position)
break;`. At a time-signature change exactly at `position`, the
    pre-change numerator/denominator is used for the segment, not
    the new one. A position landing precisely at the change beat
    will report the "old" bar/beat for one frame.

52. **`getBarBeatAtPosition` tick computation truncates.**
    `models/TimeSignatureMap.ts:69`: `Math.floor((quartersIntoBeat
/ beatUnit) * 480)`. PPQ 480 is a magic constant; for a position
    that is a perfect 1/8th note (`quartersIntoBeat = 0.5,
beatUnit = 1`), tick = `Math.floor(240) = 240` — fine. But for
    a `quartersIntoBeat = 0.5, beatUnit = 0.25` (16-th note time),
    tick = `Math.floor(2 × 480) = 960` — overflow into the next
    beat, but the function still reports it as part of the
    current beat.

53. **`stopPlayback`'s ordering is `stopActiveRecording()` →
    `stopPlayheadScheduler` → `stopAllScheduled` → `resetMidiState`.**
    `transportControls/stopPlayback.ts:21-27`. But
    `stopPlayheadScheduler` itself runs `stopAudioRecording` again
    if `punchRecordingActive` is true (`playheadScheduler.ts:289-292`).
    So `stopAudioRecording` may be invoked twice in a single stop
    — at minimum, idempotency rests on `AudioEngine`'s
    `stopAudioRecording` being safe to call twice.

54. **`transportQueries/helpers.ts` re-exports `TransportState`,
    `TempoChange`, `TimeSignatureChange` types**, and
    `useCases/index.ts` re-exports them on lines 69. AGENTS.md:
    "Use-case types stay private — Do not `export type` from
    `useCases/` for other modules". This is a direct violation.

55. **`useCases/index.ts` also re-exports
    `defaultTransportState`** (line 70). This is fine per AGENTS.md
    "runtime values OK", but the re-export of the **type**
    `TransportState` next to it (line 69) muddies the contract:
    callers will see the type at the same module-path and depend on
    it.

56. **`scheduling/scheduleMidiNotes.ts` exports `resolveDrumKit`,
    `resolveDrumKitDef`, and `scheduleFrozenTrack` but only
    `scheduleMidiNotes` is consumed externally.**
    `scheduleMidiNotes.ts:87-160`. The first two are intra-module
    helpers; the third is invoked by `scheduleAudioClips.ts:84`. So
    `scheduleAudioClips` reaches into `scheduleMidiNotes`'s exports
    via `import { scheduleFrozenTrack } from
'./scheduleMidiNotes'`. That's fine architecturally (relative
    intra-module import), but it means `scheduleMidiNotes` has 4
    exports where AGENTS.md asks for one-function-per-useCase.

57. **`stores/transportStore.ts` `toCrdt` projection drops
    `playheadPosition`, `isPlaying`, `isRecording`, `overdubEnabled`
    and `scheduleGrainMs`** (`transportStore.ts:11-47`). Comment
    is missing — these are runtime fields that should not persist
    via CRDT, but it isn't documented. A future field added to
    `TransportState` will silently fail to persist unless the
    developer also adds it to `toCrdt`.

58. **`punchRecordingStore` and `loopStationStore` and
    `setlistStore` are NOT Automerge-backed.**
    `stores/punchRecordingStore.ts:55-63`,
    `stores/loopStationStore.ts:62-71`,
    `stores/setlistStore.ts:48-57`. They live in-memory only.
    Project save/load will lose all setlist contents, loop-station
    layer state, and punch regions. Either intentional (transient)
    or a serialization bug — not documented.

59. **Setlist and Loop-station stores have no transport-loop
    coordination.** A user in "live setlist" mode hitting `play`
    on the transport does not advance the setlist, and the
    setlist's `currentIndex` is never read by the playhead
    scheduler. The setlist exists purely as UI state with no
    runtime hookup.

60. **`evaluateFollowActions` is O(N×M) per tick** where N =
    track count, M = clips per track — and it iterates every
    track, every clip on every tick whether or not any clip's
    `followAction` is set. A `tracks.flatMap(t =>
t.clips.filter(c => c.followAction))` precompute, kept up-to-date
    on store change, would let the per-tick cost be O(F) where F =
    follow-clips.

61. **`triggerSlot`/`triggerScene`/`toggleRecord` mutate
    `loopStationStore` with `state.slots.map(...)` but no audio
    pipeline.** The state machine is a UI-only mock — there is no
    actual audio capture, scheduled playback, or layer mixdown. The
    feature appears to be wired but produces no sound.
    `loopStation/__tests__/triggerSlot.spec.ts` etc. validate only
    state transitions.

62. **`playheadPositionRef` is a plain object (`{ current: 0 }`)
    with no observability.** `stores/playheadPositionRef.ts:13`.
    The doc comment explains the design intent — bypass React for
    high-frequency reads — but a debug consumer (test, devtools)
    has no way to observe writes without polling. No
    "subscribers" Set, no `Symbol.dispose`. Acceptable for the
    intended use, but the file admits it is "not a reactive
    store" and offers no alternative for tests that want to
    snapshot per-tick.

63. **`stopPlayback` resets to position 0 if no loop is active**
    (`transportControls/stopPlayback.ts:29`). Pro-DAW behavior is:
    first stop → return to play start; second stop → return to 0.
    The current code is partially that: `loopEnd > loopStart` →
    one toggle (loop start vs 0); otherwise → 0 always. There is
    no "remember the position where the user pressed play" anchor.

64. **`schedulerSession.activeAudioSources` is a flat `Array<AudioBufferSourceNode>`
    with linear `indexOf`/`splice` removal.**
    `playheadScheduler.ts:33-49`,
    `scheduleAudioClips.ts:252-254`,
    `scheduleMidiNotes.ts:152-156`. With many concurrent sources
    (loop wraps + many clips), each `onended` is O(N). For 100
    sources that's 10^4 operations per loop wrap — irrelevant in
    practice but a smell.

65. **`schedulerSession.scheduledAudioClips` and
    `scheduledFrozenTracks` are `Set<string>` with no eviction.**
    `playheadScheduler.ts:61-62`. They are cleared on loop wrap
    and follow-action jump, but not on tempo / time-sig / clip
    edit. A long playback session adds entries per clip per loop
    wrap forever. Mostly fine because they reset on every wrap,
    but with no looping, the sets grow until `stopPlayback`.

66. **`models/loopStationHelpers.ts`, `setlistItemHelpers.ts`,
    `punchRecordingHelpers.ts` are not in this audit's read set
    but are referenced from many use cases.** Spot review needed.

67. **Tests: spec count is high; depth is shallow on the
    scheduler.** No spec for `playheadScheduler.ts` exercises:
    (a) tempo change crossing a tick boundary, (b) loop wrap with
    in-flight audio sources, (c) loop region edited mid-playback,
    (d) seek while recording, (e) very-long delta (suspended
    audio context). The existing test
    (`__tests__/playheadScheduler.spec.ts`) was not read in
    detail in this pass, but the **scheduler tick** is the
    riskiest single function in the module and I would expect
    >50% of test surface to live there.

68. **`scheduleMetronome.spec.ts` exists but `scheduleMetronome`
    has module-level `_lastMetronomeBeat`** that the spec must
    reset between tests, or test isolation breaks. Did not
    verify in this pass.

69. **`transportStore.set({ ...transportStore.value!, … })` in
    `playheadScheduler.ts:194,228`** — the non-null assertion on
    `.value` is justified because `current` was checked at
    `:101-103`, but it's a fragile pattern. If the store
    ever rebuilds (HMR, project switch), the spread of stale
    `value` re-creates a stale state.

70. **`getCurrentTime()` is called multiple times per scheduling
    block.** `scheduleAudioClips.ts:182,183,193,237`,
    `scheduleMidiNotes.ts:137,138,407`. Each call queries the
    audio context. Within a single tick the time should be a
    snapshot, not re-read — the scheduler is committing a
    schedule for "this tick", not for "wall clock at every
    statement". The 1–10 µs drift across `getCurrentTime()` calls
    in the same tick produces sub-sample-frame jitter in the
    scheduled times, which is exactly the kind of error a
    "sample-accurate" claim should avoid.

71. **No accessibility on `LoopStationPanel`, `SetlistPanel`,
    `PunchRecordingControls`.** Did not read in detail in this
    pass; presentations were de-prioritised in favour of the tick
    and state machine. Spot check needed for `aria-live` on
    transport state changes (recording, looping).

### Findings — adversarial pass (2026-04-28)

72. **The Transport module has NO root `index.ts`.** AGENTS.md is
    explicit: "Cross-module imports MUST only target the destination
    module's root `index.ts`." Verified by `ls
    src/modules/Transport/` — no `index.ts` at the module root.
    Every cross-module import of Transport is therefore a deep
    import into `useCases/`, `stores/`, `models/`, or
    `presentations/views/`. Examples surveyed:
    - `src/app/bootstrap.ts:55` — `from '#/modules/Transport/useCases'`
    - `src/modules/Workspace/.../AppShell.tsx:30` —
      `from '#/modules/Transport/presentations/views'`
    - `src/modules/Arrangement/.../BeatRulerBar.tsx:5` —
      `import { type TransportState, seekPlayhead, setLoopRegion,
      disableLooping } from '#/modules/Transport/useCases'`
    - `src/modules/Arrangement/.../buildTimelineRenderModel.ts:3-4`
      — imports both stores AND useCases
    - `src/modules/Arrangement/useCases/recording/__tests__/stopRecording.spec.ts:6`
      — `import type { TransportState } from
      '#/modules/Transport/stores/transportStore'` (a model type
      reached through stores _and_ a deep store-file path)
    This is the largest single architectural violation in the
    module. Without the root barrel, the "curated public surface"
    rule cannot be enforced and additions silently leak.

73. **`stores/index.ts` re-exports MODEL types as part of its
    public store contract.** `stores/index.ts:13`: `export type {
    TransportState } from './transportStore'`; `transportStore.ts:6`
    re-exports `defaultTransportState, type TransportState` from
    `models/TransportState.ts`. AGENTS.md model-isolation rule:
    "Models are strictly private to their owning module and must
    never be exported or re-exported across module boundaries —
    not even through `useCases/`." Same issue compounds with #18
    in the Open issues section (use cases re-export). Verified at:
    - `stores/index.ts:13` — `TransportState` (a model)
    - `stores/index.ts:16,19` — `SetlistItem`, `SetlistState`,
      `LoopSlot`, `LoopSlotState`, `LoopLayer`, `LoopStationState`
      (all defined in stores files but consumed cross-module by
      `LoopStationPanel.tsx` / `SetlistPanel.tsx` are presentations
      _within_ Transport, so the cross-module concern is
      `LoopStationState` — leaking via `stores/index.ts`).
    Cross-module callers using these types (e.g. tests in
    Arrangement importing `TransportState`) confirm the leak is
    real, not merely declared.

74. **`models/index.ts` is a forbidden barrel.** `models/index.ts`
    does `export * from './TransportState'; export * from
    './TempoMap'; export * from './TimeSignatureMap'; export *
    from './TempoMappingTypes';`. AGENTS.md: "Do not add `index.ts`
    barrels … _except_ each module's **root** `index.ts`." A barrel
    inside `models/` is doubly wrong: it's a barrel that isn't the
    module root, and it lives in a folder whose contents are
    supposed to be private. (No external consumer was found
    importing this barrel directly, but it exists and invites
    sloppy imports.)

75. **`removeTimeSignatureChange` keys by float `beat ===
    beat`.** `useCases/timeSignatureChanges/removeTimeSignatureChange.ts:11`:
    `state.changes.filter((context) => context.beat !== beat)`.
    Same float-equality anti-pattern as `addTempoChange` /
    `addTimeSignatureChange` / `adjustTempoPoint` (Open issue
    #12). User adds a TS change at beat `5.0`, exports/re-imports
    rounding to `4.9999999`, then `removeTimeSignatureChange(5)`
    silently no-ops. Should match by stable `id`. Note that
    `removeTempoChange` already does match by id (`tempoMap/removeTempoChange.ts`),
    so the pattern is inconsistent within the module itself.

76. **`setPunchIn` / `setPunchOut` admit inverted regions.**
    `transportControls/setPunchIn.ts:9` clamps below at 0 only;
    `setPunchOut.ts:9` likewise. There is no `punchOut > punchIn`
    cross-validation. The scheduler defends with
    `current.punchInBeat < current.punchOutBeat` at
    `playheadScheduler.ts:189`, so an inverted region "silently
    disables punch", same shape as the loop-region issue in #5/#7.
    Also: there is no project-end clamp on either, so
    `setPunchOut(99999)` is silently accepted. Tests at
    `__tests__/setPunchIn.spec.ts:36`, `setPunchOut.spec.ts:36`
    only assert the lower-bound clamp.

77. **`seekPlayhead` while playing destroys automation recording
    continuity.** `transportControls/seekPlayhead.ts:17-28` —
    when `wasPlaying`, it calls `stopPlayheadScheduler()` then
    `startPlayheadScheduler()`. `stopPlayheadScheduler` calls
    `stopAutomationRecording()` (`playheadScheduler.ts:283`);
    `startPlayheadScheduler` calls `startAutomationRecording()`
    (`playheadScheduler.ts:89`). Every seek therefore tears down
    and re-arms automation recording, splitting any in-progress
    automation lane in two and dropping any pending
    write-buffered automation events. There is no "preserve
    automation lane across seek" branch.

78. **`seekPlayhead` does not commit an in-progress audio
    recording.** `transportControls/seekPlayhead.ts` does not call
    `stopActiveRecording()`. If `transport.isRecording === true`
    (count-in completed and the user is recording) and the user
    seeks, the underlying `MediaRecorder` keeps capturing while
    the playhead jumps. The clip's `audioBufferId` is filled in
    later from the entire recording — and since
    `recordingLifecycle.beginActualRecording` ties `recClip.startBeat`
    to the position at record-start (not the seek), the clip's
    audio and the timeline diverge. Compare to `stopPlayback`,
    which does commit the recording first (`stopPlayback.ts:21-23`).

79. **`stopPlayheadScheduler` resets `accumulatedPosition` to 0
    unconditionally** (`playheadScheduler.ts:295`). `seekPlayhead`
    relies on `startPlayheadScheduler` re-reading
    `state.playheadPosition`, but `stopPlayheadScheduler` is also
    called from `pausePlayback`, `stopPlayback`, and
    follow-action-stop. After `pausePlayback`, the scheduler's
    in-memory position is wiped; only the `transportStore.value
    .playheadPosition` survives. This is fine because every
    `startPlayheadScheduler` re-seeds from the store — but the
    coupling is fragile. A refactor that moves seed responsibility
    out of `startPlayheadScheduler` would silently leave the
    scheduler at beat 0 after every pause.

80. **In-flight `tick()` racing `worker.terminate()`.**
    `playheadScheduler.ts:284-288`: `worker.postMessage({ type:
    'stop' }); worker.terminate();`. The `onmessage` handler at
    `:273-277` queues a `void tick()` per tick message. After
    `terminate()`, no further messages fire, but a tick already
    queued in the microtask queue is not cancelled. The
    `current?.isPlaying` guard at `:102` is the only thing
    preventing post-stop tick side effects; if a state update
    that flips `isPlaying: false` lags behind the terminate (e.g.
    `pausePlayback`'s `updateTransportState` at line 16 vs
    `stopPlayheadScheduler` at line 13 — the order is `stop, then
    update`), the in-flight tick can fire AFTER the worker is
    terminated but BEFORE `isPlaying` flips, computing one extra
    `audioEngine.setTransportInfo`, scheduling one extra metronome
    click, and pushing one extra `activeAudioSources` entry.
    `pausePlayback` ordering: `stopPlayheadScheduler` is called
    BEFORE `updateTransportState({ isPlaying: false })` — so the
    race window is real.

81. **`punchRecording/*` use cases are mostly dead code.**
    `startBackgroundCapture`, `definePunchRegion`,
    `updateCapturePosition`, `commitPunchRegion`, `discardCapture`,
    `setPreRoll`, `setPostRoll`, `stopBackgroundCapture` —
    none are imported by anything outside
    `src/modules/Transport/punchRecording/`. The only wired
    function is `togglePunchRecording`, which flips the
    `enabled` boolean. The scheduler does **not** read
    `punchRecordingStore` — it reads the unrelated `transport
    .punchInBeat / .punchOutBeat / .punchInEnabled` fields. So
    there are TWO parallel "punch" systems: one inside
    `transportStore` (wired to `playheadScheduler`), and another
    in `punchRecordingStore` (with a UI panel and a richer
    region/capture model, but no runtime hookup). The richer
    feature is shipped as panel + handlers + use cases + tests,
    but produces no behaviour.

82. **`models/loopStationHelpers.ts`, `setlistItemHelpers.ts`,
    `punchRecordingHelpers.ts` are deprecated empty files.**
    Each contains `export {};` and a `@deprecated` doc comment
    citing `repositories/<name>IdCounter.ts`. They are
    "awaiting explicit deletion approval" (file-comment text,
    e.g. `loopStationHelpers.ts:1-7`). This is dead source the
    `models/` folder is carrying.

83. **`schedulerSession` is a module-level singleton that
    survives HMR.** `playheadScheduler.ts:56-66`. There is no
    `dispose()`/`Symbol.dispose` path, no HMR boundary marker,
    no project-switch reset hook (other than
    `stopPlayheadScheduler` which is called only on user-driven
    transitions). Project-switch (e.g. open a different file in
    Collaboration mode) leaves the scheduler holding stale
    `activeAudioSources`, stale `scheduledAudioClips` keys, and
    a stale `onStopRequested` callback bound to the previous
    project's `stopPlayback`.

84. **`scheduleAudioClips.sessionState.requestedAssets` never
    resets.** `scheduleAudioClips.ts:29`: `Set<string>` keyed by
    asset hash, populated to dedupe peer-asset requests. There
    is no clear-on-stop, clear-on-project-switch, or
    clear-on-`leave-session`. A user that opens a session,
    requests an asset (which the peer never serves), then
    leaves and re-joins the session, will not re-request the
    asset because the dedup-set still has the hash. Effectively
    a one-shot-per-session leak with cross-session retention if
    the page is not reloaded.

85. **`startPlayheadScheduler` reads `state.scheduleGrainMs`
    once and ignores changes.** `playheadScheduler.ts:98` reads
    `grainMs` once, posts `{ type: 'start', interval: grainMs }`
    to the worker, and never updates it. If the user toggles
    `scheduleGrainMs` mid-playback (e.g. via a settings UI) the
    worker continues at the old interval. There is no scheduler
    use case for "re-arm worker with new interval".
    `scheduleGrainMs` is in `RUNTIME_ONLY_KEYS` (per
    `transportStore.toCrdt`'s implicit list — see #57) which
    suggests it's intended to be a hot-tunable value. Without a
    re-arm path, it's a deploy-time constant in disguise.

86. **`scheduleMidiNotes` makes the **Yeast** pass synchronous
    on the await of `getYeastWorkletNodeAsync`.**
    `scheduleMidiNotes.ts:248-251`: each tick, per-Yeast-clip,
    `await getYeastWorkletNodeAsync(ctx)` and then
    `await workletNode.processBlock(...)`. With multiple
    Yeast-armed clips and a 100 Hz tick, the per-tick wallclock
    for `scheduleMidiNotes` is gated on the worklet's roundtrip
    time. The scheduler `tick()` is `async` and the await
    serializes the rest of the tick (audio clips + automation +
    setTransportInfo) behind it. If any worklet stalls,
    `audioEngine.setTransportInfo` runs late — the SAB drives DSP
    and stale transport info skews automation by however long the
    await took.

87. **`scheduleMetronome` `Math.floor(toBeat)` excludes the upper
    boundary.** `scheduleMetronome.ts:30-31`:
    `startBeatInt = Math.ceil(fromBeat); endBeatInt = Math.floor(
    toBeat); for (let beat = startBeatInt; beat <= endBeatInt;
    beat++)`. When `toBeat` is exactly an integer (e.g.
    `lookAheadBeats` lands the scheduler at `toBeat = 4.0`), the
    loop includes beat 4 — fine. But the **next** tick re-computes
    `fromBeat = lastScheduledBeat = scheduleUpTo` (which was
    `4.0`). `startBeatInt = Math.ceil(4.0) = 4`. The
    `if (beat <= _lastMetronomeBeat)` guard at `:35` then skips
    beat 4 — correct. But if `_lastMetronomeBeat` is reset
    (e.g. by a loop wrap or `resetMetronomeBeat(position)` with
    `position` mid-beat), the guard's exact boundary semantics
    are tied to `Math.floor(position) - 1`
    (`scheduleMetronome.ts:16`) which itself is an off-by-one
    for `position` exactly on an integer beat — `floor(4.0) - 1
    = 3`, so beat 4 would re-fire on the next pass. Net: the
    metronome can DOUBLE-fire on a beat that lies exactly on a
    loop-wrap or reset point. Did not write the unit test in
    this pass; the math is consistent with this hazard.

88. **`scheduleMidiNotes` Yeast path uses `fromBeat` and
    `toBeat` to define the worklet block, but block boundaries
    do not align with note start times.**
    `scheduleMidiNotes.ts:230`: `if (noteStartBeat < fromBeat ||
    noteStartBeat >= toBeat) continue;` excludes notes outside
    the block. But `transformedNotes` (the worklet output) is
    consumed at `:304` as the new `notes` array, which then
    feeds the **non-Yeast scheduling pass** at `:375`-`:476`.
    That second pass uses `iter * loopLen` and `clip.startBeat
    + iter * loopLen + (note.startBeat - midiOffset)` — so a
    Yeast-transformed note at `startBeat = 0.5` (relative to
    clip) is replayed at `clip.startBeat + 0.5` per iteration.
    For Yeast clips that loop, the worklet sees one block of
    input notes per tick but the second pass re-iterates them
    with the loop. This only works if the worklet output is
    independent of iteration — which the worklet has no way to
    know (the `transport.barIndex` / `beatInBar` are computed
    from `fromBeat`, not from the iteration's effective beat).
    So loop-iterated Yeast clips re-run the worklet's transform
    on the same input each iteration with the same metadata,
    producing identical patterns instead of bar-aware variation.

89. **`scheduleMetronome.spec.ts` tests share module-level
    `_lastMetronomeBeat` state across tests.** Verified:
    `scheduling/__tests__/scheduleMetronome.spec.ts` has only
    one `it()` block (`'does not schedule clicks when the
    metronome is off'`) that calls `scheduleMetronome(0, 4, 0,
    {...defaultTransportState, metronomeEnabled: false}, 120)`.
    The early-return path (`metronomeEnabled: false`) does not
    touch `_lastMetronomeBeat`, so the spec coincidentally does
    not surface the cross-test pollution. The test file does
    not import `resetMetronomeBeat` or call it in `beforeEach`.
    Adding any second test case that exercises the
    metronome-on path will fail-or-flake depending on prior
    state.

90. **`detectProjectTempo` writes `transportStore.tempo` even
    though the result is by-construction equal to it.**
    Verified: `tempoMapping/operations/detectProjectTempo.ts:138-140`
    calls `applyTempoMap(result)` if `confidence > 0.5`, and
    `applyTempoMap` (`:120-129`) calls
    `updateTransportState({ tempo: Math.round(result.averageBpm) })`.
    Because `estimateOnsetsFromClips` (`:93-118`) generates
    `onsets[i] = clipStartSec + i * (60/currentTempo)`, the
    inter-onset intervals are exactly `60/currentTempo`,
    giving `bpm = 60 / interval = currentTempo`. Average = current.
    `Math.round(currentTempo) === currentTempo` (transport.tempo
    is integer in `setTempo`). Net: a no-op that pushes to
    Automerge CRDT (firing collab broadcasts and undo entries).
    Open issue #13 captures this; verified the math.

91. **`evaluateFollowActions` skips clips whose
    `loopEnabled` is true.** `evaluateFollowActions.ts:51`:
    `if (clip.followAction && !clip.loopEnabled && …)`. A
    clip with both `loopEnabled` and `followAction === 'stop'`
    will NEVER fire its follow-action — which is consistent
    with "looping clip never ends". But this is undocumented;
    a user setting both might expect the loop to terminate
    when its play range ends. The test at `:62-66` confirms
    "skips clips that have loopEnabled" — but does not
    interrogate whether this is the desired UX.

92. **`schedulerSession.lastScheduledBeat` is initialized to
    `-1` in the holder declaration but seeded to
    `state.playheadPosition - 0.0001` on
    `startPlayheadScheduler`.** `playheadScheduler.ts:60` vs
    `:95`. After `stopPlayheadScheduler` it is reset to `-1`
    (`:296`). If a tick fires AFTER `stopPlayheadScheduler`
    has reset to `-1` but BEFORE the worker terminate has
    drained (the race in #80), `scheduleMetronome` sees
    `fromBeat = -1` and floors `endBeatInt` against
    `lookAheadBeats` of a stale tempo — schedules
    metronome clicks for beats `Math.ceil(-1)..floor(toBeat)`
    = `[-1, … toBeat]`, including beat 0 and beat 1 in a
    look-ahead window that no longer corresponds to playback.
    Worse: `audioEngine.setTransportInfo(newPosition,
    currentTempo, current.isPlaying, …)` writes the post-stop
    isPlaying value but the just-reset `accumulatedPosition`
    is `0` (from line 295) — so the SAB momentarily shows
    "playing at 0" if the in-flight tick wins.

93. **`transportStore.set({ ...transportStore.value!,
    isRecording: true })` at `playheadScheduler.ts:194,228`
    bypasses the recording lifecycle.** The punch-arming branch
    inside the tick directly mutates `isRecording` rather than
    going through `recordingLifecycle.stopActiveRecording` /
    `beginActualRecording`. Consequence: the `countInTimerId`
    is never cleared on punch-arm, even if the user had
    pressed record (with count-in enabled) and then enabled
    punch and the punch-in beat hits before the count-in
    expires. Two recordings can race: the count-in's
    `beginActualRecording` at `t = countInDurationSec` and the
    punch-arm's `startRecording` at `tick when newPosition >=
    punchInBeat`. (Builds on Open issue #8 with a concrete
    interleaving.)

94. **`scheduleAudioClips.gainNodePool` is module-level and
    shared across HMR.** `scheduleAudioClips.ts:37` declares
    `const gainNodePool: GainNode[] = []`. Module-level state
    survives HMR re-mount of the calling React tree. After many
    HMR reloads in dev, the pool retains references to GainNodes
    created against the previous AudioContext (the audio
    context typically does NOT get re-created on HMR, so the
    nodes themselves remain valid — but the pool semantics
    become opaque). Already noted in Open issue #37 for size
    growth; the HMR survival makes it a debug-only mystery
    when nodes from a previous session leak into a new one.

95. **`scheduleMidiNotes` uses `Math.random()` for note
    probability, even though `evaluateFollowActions` switched to
    a seeded PRNG.** `scheduleMidiNotes.ts:393`: `if
    (probability < 100 && Math.random() * 100 >= probability)
    continue;`. `evaluateFollowActions.ts:8-18` defines
    `seededRandom(clipId, position)` and uses it for
    `play_random` (line 111) — so follow-actions are
    deterministic across replays, but per-note probability is
    not. Two playbacks of the same project will produce
    different audible patterns. (Inconsistent with
    `evaluateFollowActions`'s declared "deterministic
    pseudo-random" contract at line 3-7.)

96. **`scheduleAudioClips.sessionState` is `export`-ed.**
    `scheduleAudioClips.ts:29`: `export const sessionState: {
    requestedAssets: Set<string> } = { … }`. AGENTS.md: "Files
    under `src/modules/<Name>/` MUST NOT import from
    `#/modules/<Name>` (their own barrel). Use **relative**
    paths." This is an export from a `useCases/scheduling/*`
    file, intended for intra-module reset hooks. Not strictly a
    barrel violation, but `export const` of mutable runtime
    state is a leak surface — any other file in the module can
    `import { sessionState }` and reach into the dedup-set. No
    consumer was found, but the door is open.

97. **`scheduleMetronome._currentTempo` parameter is unused.**
    Verified at `scheduleMetronome.ts:24-25`: the parameter is
    underscore-prefixed and never referenced — the function
    re-resolves tempo per-beat from the tempo map at line 40.
    This is the symptom; the root cause is that the function
    signature was never refactored when the tempo-map-aware
    look-up replaced the snapshot-tempo computation. Open
    issue #17 calls out the multi-positional-arg violation;
    this finding is the unused-parameter compounding.

98. **`recordingLifecycle.countInTimerId` is module-level
    mutable state with no reset path on `stopPlayheadScheduler`.**
    `transportControls/recordingLifecycle.ts:13`. Cleared by
    `stopActiveRecording()` (`:22-25`), but
    `stopPlayheadScheduler` does NOT call `stopActiveRecording`.
    So a follow-action `stop` (which calls
    `schedulerSession.onStopRequested?.()` →
    `stopPlayback()` → `stopActiveRecording()` if isRecording)
    DOES clear it; but a direct `pausePlayback` does NOT. This
    is the race underneath Open issue #7, with the call-graph
    spelled out.

99. **`startPlayback` does not check `isAlready playing`.**
    `transportControls/startPlayback.ts:9-27`: no guard against
    being called twice (which can happen via two rapid
    spacebar presses through the keyboard handler). The second
    call posts `{ type: 'start', interval: grainMs }` to the
    Worker, which `clearInterval`s its own timer and re-sets
    (`schedulerWorker.ts:19-24`). Net effect: the worker re-arms,
    likely fine. But `startPlayheadScheduler` re-creates the
    Worker only if `!schedulerSession.worker` — so the second
    call hits the `else` branch and posts another `start`.
    `lastTickTime` is **also** reset to `ctx.currentTime`
    (`:92`), which means the next tick will see `deltaSec ≈ 0`,
    skipping any time elapsed since the first call's last
    tick. Every double-press of spacebar pauses position
    advance for one tick.

100. **`stopPlayback`'s `state.playheadPosition === state.loopStart`
     compares the store value, not `playheadPositionRef.current`.**
     `transportControls/stopPlayback.ts:34`. The store value lags
     the ref by up to 100 ms during playback (the scheduler updates
     both, but the store flush goes through `updateTransportState`
     only on discrete events: pause/stop/seek/loop wrap). After a
     `pausePlayback` followed by a `stopPlayback`, the store value
     is the position at pause. After a loop wrap then a pause then
     a stop, the store value is `loopStart` (from the wrap), but
     the user may have pressed pause _before_ the wrap was committed
     — in which case the store has the pre-wrap value. The
     equality compare is fragile in two dimensions: float drift
     (already noted in #25) and which clock reads the position.

### Findings — meta

101. **Audit was missing a "no root barrel" finding.** This is
     the most impactful AGENTS.md violation in the module —
     surfaced here as Finding #72 and Open issue #41 below.

102. **Audit downgraded the `models/index.ts` barrel as out-of-scope.**
     Surfaced here as Finding #74 and consolidated with the
     barrel-rule violations.

---

## Priorities

> Numbers in parentheses are **Open issue** numbers (the headed
> sections in `## Open issues`), not Findings numbers. Issues 41+
> are introduced by the 2026-04-28 adversarial pass and pull
> several Findings #72+ into actionable form.

1. **The Transport module has no root `index.ts` (#41).** The
   single largest architectural finding. Until the root barrel
   exists, every cross-module import is illegal-by-spec, and the
   `useCases/index.ts` type leak (#18) and `stores/index.ts` model
   leak (#42) cannot be repaired in isolation — they require the
   barrel to land first.
2. **Scheduler tempo-curve correctness (#1, #2, #3, #14, #27).**
   Tempo changes mid-playback produce drift between visual
   playhead, audio clip placement, MIDI note timing, and metronome
   ticks. The single most user-visible "jitter" hazard. New issue
   #43 (Yeast loop-iter re-runs on stale block metadata)
   compounds this.
3. **Recording data-loss class (#4, #45, #46).** Loop wrap during
   recording overwrites takes; seek-while-recording desyncs clip
   audio from timeline; in-flight tick after `terminate()` writes
   one extra `setTransportInfo`. All cause silent data loss or
   timeline corruption that the user discovers post-hoc.
4. **Loop-region edge cases (#5, #6, #19, #44).** `loopEnd <=
   loopStart` silently disables looping (#5); playhead can escape
   the loop region after an edit (#6); `stopActiveSources` races
   `onended` (#19); inverted punch regions accept silently (#44).
5. **Play/stop/record state-machine races (#7, #8, #45, #47).**
   Count-in timer not cleared on `pausePlayback`, double-arm when
   punch and record both fire, automation lane truncated on every
   seek, double-press of spacebar resets `lastTickTime` to "now"
   skipping a tick.
6. **Tempo / time-sig validation drift (#11, #12, #48).** Three
   different BPM upper bounds (300 / 999 / no-bound), float
   beat-equality used as a key, CRDT-replayable inserts producing
   near-duplicates, plus `removeTimeSignatureChange` keying by
   float beat (Finding #75).
7. **Hot-loop allocations and per-call sorts in models (#14,
   #20, #33).** Every `getTempoAtBeat` call sorts the tempo map;
   every Yeast-armed tick allocates Maps; tempo detection slices
   per frame.
8. **`detectProjectTempo` is a closed-loop fake (#13).** Function
   "detects" the input tempo by construction. UX-misleading and
   churns the CRDT.
9. **Beats↔seconds conversion uses `transport.tempo` directly in
   places that should use the tempo map (#3).** Yeast worklet
   block boundaries ignore the tempo map entirely.
10. **`scheduleMetronome` module-level state racing across
    pause/play sequences (#9).** Metronome misses clicks on
    pause/play without stop. Adjacent: Finding #87 (potential
    double-fire on integer-beat boundaries).
11. **Dead / unwired feature code (#22, #23, #49).** Loop-station
    is UI-only, setlist not coordinated with transport, and the
    `punchRecording/*` use case stack is mostly unwired (Finding
    #81). Either ship or strip.
12. **AGENTS.md violations (#17, #18, #41, #42, #43).** No root
    barrel, type re-exports from useCases, model types re-exported
    from `stores/`, multi-positional-arg functions, internal
    `models/index.ts` barrel.

---

## Open issues

> **Verification (2026-04-28 adversarial pass):** every numbered
> issue below was re-checked against the current source. None
> moved to `## Resolved`. Severity-relevant verification notes:
>
> - **#1 [VERIFIED]** — `playheadScheduler.ts:111-114` reads
>   `currentTempo` once per tick from `accumulatedPosition` and
>   applies to the full `deltaSec`. The `'linear'` curve in
>   `getTempoAtBeat` (`models/TempoMap.ts:36-41`) is not
>   integrated across the tick. Magnitude of drift: at 100 Hz
>   tick (10 ms), with a linear ramp from 60→120 BPM over 4
>   beats, the integration error per tick is up to `(deltaSec)²
>   × slope / 2 ≈ 0.5 ms × slope` — but the error
>   **accumulates** because `accumulatedPosition` is the seed
>   for the next tick. Severity: **HIGH**, confirmed.
> - **#2 [VERIFIED]** — `scheduleAudioClips.ts:182` uses
>   `currentTempo` (scheduler's tick-snapshot) for time
>   placement; `:147` uses `clipBeatsPerSecond` (clip's
>   startBeat tempo) for duration. With any non-flat tempo
>   map, `iterStartTime` and `iterDurationSeconds` use
>   different rates. Same dual-tempo bug at
>   `scheduleMidiNotes.ts:404-410` (per-note tempo
>   re-resolved) vs `:407` (`currentTempo` for time).
>   Severity: **HIGH**, confirmed.
> - **#3 [VERIFIED]** — `scheduleMidiNotes.ts:211`: `const
>   spb = transport.tempo / 60`. `:218-219` derives
>   `barIndex` and `beatInBar` directly from `fromBeat /
>   transport.timeSignatureNumerator`. Both ignore
>   `tempoMapStore` and `timeSignatureMapStore`.
>   Severity: **HIGH**, confirmed.
> - **#4 [VERIFIED]** — `playheadScheduler.ts:117-135`: on
>   loop wrap during recording, `addTake(...)` is called per
>   armed track — but `stopAudioRecording` /
>   `startAudioRecording` are NOT. Compare to
>   `recordingLifecycle.beginActualRecording` which sets up
>   the buffer-to-clip mapping; the loop wrap branch creates
>   take rows without the recording infrastructure to fill
>   them. Severity: **CRITICAL** (data loss), confirmed.
> - **#5 [VERIFIED]** — `setLoopRegion.ts:4-10` accepts any
>   `(start, end)` pair; `playheadScheduler.ts:116`'s wrap
>   guard requires `loopEnd > loopStart`. The two combine to
>   silently disable looping for inverted regions.
>   Severity: **MEDIUM**, confirmed.
> - **#6 [VERIFIED]** — `playheadScheduler.ts:116`'s wrap
>   guard fires only on `newPosition >= loopEnd`. There is
>   no "playhead currently past `loopEnd`" branch. Editing
>   `loopEnd` below `accumulatedPosition` mid-playback
>   leaves the playhead outside the region, advancing
>   indefinitely. Severity: **MEDIUM**, confirmed.
> - **#7 [VERIFIED]** — `pausePlayback.ts:7-17` does not
>   call `stopActiveRecording`; only `stopPlayback.ts:21-23`
>   does. `recordingLifecycle.countInTimerId` is cleared in
>   `stopActiveRecording` (`:22-25`); the timer survives
>   `pausePlayback` and `togglePlayback`. Severity: **HIGH**
>   (surprise recording = silent file write), confirmed.
> - **#8 [VERIFIED]** — `playheadScheduler.ts:184-222`
>   guards on `!current.isRecording` (line 186), so the
>   common path (user toggled record before reaching
>   `punchInBeat`) is fine. But the user can also enable
>   `punchInEnabled` AFTER toggling record — line 186 sees
>   `isRecording: true` and the punch branch returns. So the
>   true risk is the OTHER direction: punch was active at
>   `:194` (set `isRecording: true`); user then toggles
>   record-arm a second time mid-region; at the next tick,
>   the guard at `:186` is re-evaluated and the user toggle
>   may or may not race the punch's set. Severity:
>   downgraded to **MEDIUM** based on this verification —
>   the bug is real but requires a specific user
>   interleaving, and the existing guard prevents the
>   common case.
> - **#9 [VERIFIED]** — `scheduleMetronome.ts:9` is module
>   level; `pausePlayback.ts:13-16` does not call
>   `resetMetronomeBeat`; only `stopPlayheadScheduler` does
>   (`playheadScheduler.ts:297`). So pause→play from a new
>   beat skips clicks ≤ stale value. Severity: **MEDIUM**,
>   confirmed.
> - **#13 [VERIFIED]** — math walkthrough confirmed:
>   `estimateOnsetsFromClips` (`detectProjectTempo.ts:111`)
>   generates onsets at `i × beatDuration` where
>   `beatDuration = 60 / currentTempo`. Inter-onset interval
>   = `beatDuration` everywhere. `bpmEstimates` =
>   `60 / interval = currentTempo`. Histogram with 2-BPM
>   bin width: every estimate lands in the same bin.
>   `averageBpm = currentTempo`. Closed-loop, by
>   construction. Severity: **MEDIUM** (UX-misleading not
>   correctness-critical), confirmed.
> - **#19 [VERIFIED]** — `activeAudioSources` is `Array<>`
>   at `playheadScheduler.ts:63`; `onended` does
>   `activeAudioSources.indexOf(source); splice(idx, 1)` at
>   `scheduleAudioClips.ts:251-262` and
>   `scheduleMidiNotes.ts:151-157`. The race is real.
>   Severity: **LOW** (cosmetic — the array is local to
>   audio sources, not playback correctness), confirmed.
> - **#21 [VERIFIED]** — three stores use
>   `createStore({initialData})` without
>   `createAutomergeStorage`. Verified at
>   `setlistStore.ts:48-57`, `loopStationStore.ts:62-71`,
>   `punchRecordingStore.ts:55-63`. Severity: **MEDIUM**
>   (depends on whether the features are intended to
>   persist — see Open question), confirmed.
> - **#22, #23, #49 [VERIFIED]** — loop-station, setlist,
>   and punch-recording use cases produce no audible
>   behaviour. `triggerSlot.ts:7-20` only flips slot state.
>   `goToItem.ts:9-32` only updates `currentIndex` and emits
>   a `programChange` event (not a transport seek). The
>   richer `punchRecording/*` use cases (define / commit /
>   discard) have zero external callers. Severity:
>   **MEDIUM** (UX failure, not correctness), confirmed.
> - **#34, #41-#54 (new)** — see headed sections below.
>
> Issues #10-#12, #14-#18, #20, #24-#33, #35-#40 — verified
> by spot-check; current behaviour matches the description in
> the original audit. No severity adjustments.

### 1. Scheduler tempo curve drift between position and audio time

**Problem:** The tick reads `currentTempo = getTempoAtBeat(changes,
accumulatedPosition, …)` once and uses it for the whole `deltaSec`
interval (`playheadScheduler.ts:111-113`). For any `'linear'` tempo
curve, the integrated position over `deltaSec` should be
`integral(tempo(t)/60, accumulatedPosition, accumulatedPosition + …)`
— not `tempo(accumulatedPosition) × deltaSec`. The error grows linearly
with the slope of the tempo curve and accumulates every tick.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:107-114`
- `src/modules/Transport/models/TempoMap.ts:17-42`

**Needed:** Either (a) clamp tick advance to "until next tempo change
beat or end of tick, whichever first" and re-resolve, looping until
deltaSec is consumed, or (b) integrate `tempo(t)/60` analytically
across the linear segment(s) the tick crosses. Add a property test:
"between two ticks, integrated beats == direct integration of the
tempo curve".

### 2. Per-event tempo re-resolution disagrees with position bookkeeping

**Problem:** `scheduleAudioClips.ts:182` places audio at
`getCurrentTime() + beatOffset / (currentTempo / 60)` (the
**scheduler's** snapshot tempo), while
`scheduleAudioClips.ts:147` derives `iterDurationSeconds` from
`clipBeatsPerSecond = clipTempo / 60` (the clip's startBeat tempo).
With a non-flat tempo map, the start time and the duration use
different rates — clips drift.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:130-147,182`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:404-410`

**Needed:** Single helper that converts `(beat, anchorBeat,
anchorTime)` to audio-clock time using the tempo map, and use it
everywhere. No more "snapshot tempo at current beat" + "snapshot
tempo at clip beat" duality.

### 3. Yeast worklet block-processing ignores the tempo map

**Problem:** `scheduleMidiNotes.ts:211` (`spb = transport.tempo / 60`)
and the time-samples computation at `:233,238,245-246` use the **flat**
`transport.tempo`. With any tempo change, the Yeast worklet receives
mis-timed events.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:207-251`

**Needed:** Replace `transport.tempo / 60` with a tempo-map-aware
beat→samples helper. Add a test with a tempo change inside the block
and assert the noteOn `timeSamples` matches the expected sample
position.

### 4. Loop wrap during recording loses audio

**Problem:** `playheadScheduler.ts:117-135` creates per-track
`addTake(...)` records on every loop wrap during recording, but does
not stop and restart the underlying `MediaRecorder`. The recording
buffer continues to fill until `stopPlayback` / `stopActiveRecording`.
The take rows the user sees are empty — only the **last** take gets
the buffer.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:117-145`
- `src/modules/Transport/useCases/transportControls/recordingLifecycle.ts:1-27`
- `src/modules/AudioEngine/useCases` (caller path: `startAudioRecording`)

**Needed:** On loop wrap during recording, stop and restart per-armed-track
audio recording, **carrying over** the previous buffer to the previous
take's clip and starting a fresh buffer for the new take. Add an
integration test: record across two loop wraps, expect three takes
each with a ~loop-length buffer.

### 5. `loopEnd <= loopStart` silently disables loop without UX feedback

**Problem:** `playheadScheduler.ts:116`'s wrap guard requires `loopEnd >
loopStart`. `setLoopRegion(start, end)` accepts `end <= start` without
validation (`transportControls/setLoopRegion.ts:4-10`). User sees
`isLooping: true` and a region in the UI; playback ignores it.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/setLoopRegion.ts:4-10`
- `src/modules/Transport/useCases/playheadScheduler.ts:116`

**Needed:** Reject `end <= start` (return without effect, or normalize
to `[end, start]`), or surface a `notifyUser` error. Disallow `setLoop
Region` with the wrong ordering at the use case boundary.

### 6. Playhead can escape the loop after a region edit

**Problem:** When the user shrinks `loopEnd` to a value `<
accumulatedPosition` mid-playback, the next tick computes `newPosition <
loopEnd` (`116`) — false — but `accumulatedPosition` is past the new
`loopEnd`. The wrap never fires; the playhead escapes the loop region.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:116-145`

**Needed:** Add a "playhead is currently outside the loop region;
clamp to loop start" branch when `accumulatedPosition >= loopEnd` AND
`isLooping` is true. Run on every tick, before the wrap-on-cross
branch.

### 7. Count-in timer not cleared on `stopPlayback`

**Problem:** `recordingLifecycle.ts:13-27`'s `countInTimerId` is
cleared inside `stopActiveRecording`, which is called from
`stopPlayback`. But if the user toggles `togglePlayback`/`pausePlayback`
during count-in (instead of `stopPlayback`), the timer keeps running
and `beginActualRecording()` fires after `state.isPlaying === false`.
Result: surprise recording starts.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/toggleRecording.ts:97-107`
- `src/modules/Transport/useCases/transportControls/recordingLifecycle.ts:13-27`
- `src/modules/Transport/useCases/transportControls/pausePlayback.ts`

**Needed:** Clear `countInTimerId` from `pausePlayback` and any other
"halt playback" path. Better: have `beginActualRecording` re-check
`state.isPlaying` (or an equivalent flag) before arming, so a
late-firing timer becomes a no-op.

### 8. Punch-recording double-arm when both punch and record are on

**Problem:** `playheadScheduler.ts:184-222`: armed-on-tick `>=
punchInBeat` calls `startRecording()` and per-track
`startAudioRecording`. If `transport.isRecording` is already `true`
(user toggled record before enabling punch, or before reaching
punchInBeat), the punch branch fires a second `startRecording()` /
`startAudioRecording()`, overwriting the in-flight recording. The
guard `!current.isRecording` at `:186` only prevents the case where
the **user** already toggled record-arm — but the very next tick
flips `isRecording: true` (`:194`) without un-arming.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:184-222`

**Needed:** Add an authoritative state machine: "is the punch system
the owner of recording?" If yes, the user's record-arm is a no-op
within the punch region. If no, the punch system is a no-op. Today
both can fire.

### 9. `_lastMetronomeBeat` module-level state breaks across pause/play

**Problem:** `scheduleMetronome.ts:9` keeps a module-level
`_lastMetronomeBeat`. `pausePlayback` does **not** call
`resetMetronomeBeat`; only `stopPlayheadScheduler` (called via
`stopPlayback`) does. After `pause` then `play` from a new beat,
`_lastMetronomeBeat` is stale — every beat ≤ that value is silently
skipped.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMetronome.ts:9-17`
- `src/modules/Transport/useCases/transportControls/pausePlayback.ts:7-17`
- `src/modules/Transport/useCases/playheadScheduler.ts:282-303`

**Needed:** Either (a) reset metronome from `pausePlayback` /
`startPlayback` symmetrically, or (b) move the metronome cursor into
`schedulerSession` so it is re-seeded by `startPlayheadScheduler`.

### 10. `setLoopRegion` accepts inverted regions; `seekPlayhead` does not clamp to project end

**Problem:** Two related validation gaps. `setLoopRegion` allows
`end <= start` (issue #5). `seekPlayhead` clamps below at 0 only,
not above (no project-end ceiling), so seeking to beat 99,999 leaves
the scheduler ticking against the void. Combined with #5/#6, loop
region edits can produce nonsensical states.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/seekPlayhead.ts:8-29`
- `src/modules/Transport/useCases/transportControls/setLoopRegion.ts`

**Needed:** Cross-module helper `getProjectEndBeat()` (in
`Arrangement` or `Transport`'s queries) and clamp both ends. Reject
inverted loops.

### 11. Tempo / BPM bound mismatch across files

**Problem:** Three different BPM ceilings:

- `useCases/setTempo.ts:6` — `bpm < 20 || bpm > 300` throws.
- `models/TempoMap.ts:12` — `Math.max(20, Math.min(999, tempo))`.
- `useCases/tempoMap/updateTempoChange.ts:10` — `Math.max(20,
Math.min(999, tempo))`.
- `useCases/tempoMap/addTempoChange.ts` — no explicit guard (relies
  on `createTempoChange`).

**Representative files:**

- `src/modules/Transport/useCases/setTempo.ts:6-8`
- `src/modules/Transport/models/TempoMap.ts:8-15`
- `src/modules/Transport/useCases/tempoMap/updateTempoChange.ts:10`
- `src/modules/Transport/useCases/tempoMap/addTempoChange.ts:4-23`
- `src/modules/Transport/errors/InvalidTempoError.ts`

**Needed:** Single canonical `MIN_BPM` / `MAX_BPM` constant pair in
`models/TempoMap.ts`, used by `setTempo`, `createTempoChange`,
`updateTempoChange`, and the `InvalidTempoError` error path.

### 12. Float-equality keys in `addTempoChange` / `addTimeSignatureChange` / `adjustTempoPoint`

**Problem:** `addTempoChange.ts:10`, `addTimeSignatureChange.ts:10`,
and `adjustTempoPoint.ts:7` use `===` on `beat: number` to find an
existing change. Float drift from save→load roundtrips creates
near-duplicates (`1.5 vs 1.4999999999`) that coexist; subsequent
edits target one or the other based on which the comparator settles
on after `sort`.

**Representative files:**

- `src/modules/Transport/useCases/tempoMap/addTempoChange.ts:10`
- `src/modules/Transport/useCases/timeSignatureChanges/addTimeSignatureChange.ts:10`
- `src/modules/Transport/useCases/tempoMapping/operations/adjustTempoPoint.ts:7`

**Needed:** Match by stable `id` everywhere a "find existing" is
done. Snap incoming beats to a quantization grid (e.g.
`Math.round(beat × 960) / 960`) at the API boundary.

### 13. `detectProjectTempo` is a closed-loop fake

**Problem:**
`tempoMapping/operations/detectProjectTempo.ts:93-118`
(`estimateOnsetsFromClips`) generates one onset per beat per clip
using the **current transport tempo** as the seconds-per-beat
divisor. `detectTempoFromOnsets` then "infers" the tempo from those
onsets — by construction equal to the transport tempo. The function
is presented to users as "detect project tempo" but returns
`current_tempo` always.

**Representative files:**

- `src/modules/Transport/useCases/tempoMapping/operations/detectProjectTempo.ts:93-143`

**Needed:** Either (a) actually run onset detection on the project's
audio buffers (delegate to `AudioAnalysis.detectTempoFromOnsets`
applied to a rendered mix), or (b) delete the fake. Don't ship a
"detect" command that no-ops.

### 14. Hot-loop allocations in scheduling

**Problem:** Per-tick allocations across the scheduling stack:

- `scheduleAudioClips.ts:102` allocates a clip-key string per clip
  per tick.
- `scheduleMidiNotes.ts:259-272` allocates a `Map`, a cursor `Map`,
  and a notes array per Yeast clip per tick.
- `models/TempoMap.ts:22-24` and `TimeSignatureMap.ts:27-28` allocate
  sorted arrays + filtered before/after arrays per call (called per
  beat per tick).
- `tempoMapping/operations/detectProjectTempo.ts:62-66` allocates a
  `slice(...)` per frame.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:102`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:259-272`
- `src/modules/Transport/models/TempoMap.ts:22-24`
- `src/modules/Transport/models/TimeSignatureMap.ts:27-28,44`
- `src/modules/Transport/useCases/tempoMapping/operations/detectProjectTempo.ts:62-66`

**Needed:**
- Cache the sorted tempo map / time-signature map at insert time, not
  per call.
- Replace `filter(before)` / `filter(after)` with a binary-search
  index into a sorted-by-beat array.
- Hoist the per-tick `Map` allocations in `scheduleMidiNotes` out of
  the per-clip loop where possible; reuse from `schedulerSession`.
- Drop the per-clip key allocation; key by `clip.id` + iteration
  index in a `Map<string, number>` (already-scheduled-up-to-beat).

### 15. `getBarBeatAtPosition` off-by-one and tick truncation

**Problem:** Two sub-issues:
- `models/TimeSignatureMap.ts:51`: `if (change.beat >= position) break;`
  — at the exact change beat, the pre-change numerator is used, so the
  reported bar/beat is one frame stale.
- `models/TimeSignatureMap.ts:69`: `Math.floor(... × 480)` — for
  positions whose `quartersIntoBeat / beatUnit` exceeds 1 (e.g.
  `beatUnit = 0.25` and `quartersIntoBeat = 0.5`) the tick can
  exceed 480, but the function still attributes it to the current
  beat instead of overflowing into the next.

**Representative files:**

- `src/modules/Transport/models/TimeSignatureMap.ts:38-72`

**Needed:** Use `>` instead of `>=` (or document the choice). Clamp /
overflow tick correctly. Add tests for `getBarBeatAtPosition` at:
position exactly on a change, position landing exactly on a
beat-boundary, and position with denominator changes.

### 16. `audioEngine.setTransportInfo` called every tick without dirty check

**Problem:** `playheadScheduler.ts:174-181` writes the SAB on every
tick whether or not anything changed. The fields are typed as a
positional 6-tuple with no shape contract — a future signature
addition will silently break.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:174-181`

**Needed:** Diff against last-written values; skip if unchanged.
Convert to a single object parameter (per AGENTS.md) so future
field additions break at compile time.

### 17. Function signatures violate AGENTS.md "single object param" rule

**Problem:** Multiple multi-arg positional functions:

- `scheduleMidiNotes(fromBeat, toBeat, accumulatedPosition,
lastScheduledBeat, activeAudioSources, transport, currentTempo)` —
  7 positional.
- `scheduleAudioClips(...)` — 8 positional
  (`scheduleAudioClips.ts:59-68`).
- `scheduleMetronome(fromBeat, toBeat, accumulatedPosition,
transport, _currentTempo)` — 5 positional, plus an unused param.
- `scheduleFrozenTrack(track, accumulatedPosition,
activeAudioSources, currentTempo)` — 4 positional
  (`scheduleMidiNotes.ts:112-117`).
- `setTimeSignature(numerator, denominator)` — 2 positional
  (`useCases/setTimeSignature.ts:6`).
- `setLoopRegion(startBeat, endBeat)` — 2 positional.
- `getBarBeatAtPosition(changes, position, defaultNumerator,
defaultDenominator)` — 4 positional.
- `getTempoAtBeat(changes, beat, defaultTempo)` and
  `getTimeSignatureAtBeat(changes, beat, defaultNumerator, defaultDenominator)`.
- `addTimeSignatureChange(beat, numerator, denominator)`,
  `addTempoChange(beat, tempo, curve)`.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:162-170`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:59-68`
- `src/modules/Transport/useCases/scheduling/scheduleMetronome.ts:19-25`
- `src/modules/Transport/models/TempoMap.ts:8,17`
- `src/modules/Transport/models/TimeSignatureMap.ts:8,17,38`
- `src/modules/Transport/useCases/setTimeSignature.ts:6`
- `src/modules/Transport/useCases/transportControls/setLoopRegion.ts:4`

**Needed:** Refactor each to a single object param. Internal-only
functions are higher priority where the call sites are also internal
(no external callers to ripple-update).

### 18. Use-case index re-exports types (AGENTS.md violation)

**Problem:** `useCases/index.ts:69` exports `TransportState`,
`TempoChange`, `TimeSignatureChange` — `type` re-exports from a
useCases barrel. `transportQueries/helpers.ts` exists solely to
re-export these from `models/`, then the useCases barrel re-exports
again. AGENTS.md "Use-case types stay private" forbids this.

**Representative files:**

- `src/modules/Transport/useCases/index.ts:69`
- `src/modules/Transport/useCases/transportQueries/helpers.ts:5-7`

**Needed:** Drop the `export type` re-exports. Cross-module callers
must define their own local types or use `ReturnType<typeof
getTransportState>`/`Parameters<typeof setTempo>`. If a shared
type is genuinely needed (e.g. `TempoChange` shape used by an
event payload), move it to `events/` per the AGENTS.md exception.

### 19. `stopActiveSources` race with `onended` handlers

**Problem:** `playheadScheduler.ts:142,165,301` stops all active
sources synchronously, but their `onended` callbacks
(`scheduleAudioClips.ts:251-262`, `scheduleMidiNotes.ts:152-156`)
fire asynchronously — they do `activeAudioSources.indexOf(source);
splice(idx, 1)`. New sources are pushed onto the array between the
stop call and the async fire, racing the index lookup.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:33-49`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:250-262`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:151-157`

**Needed:** Move source tracking into `schedulerSession.activeAudioSources`
as a `Set<AudioBufferSourceNode>`, where `delete(source)` is O(1)
and not index-based. Bonus: split into "sources from the previous
generation that are stopping" vs "sources from this generation".

### 20. `getTempoAtBeat` / `getTimeSignatureAtBeat` sort on every call

**Problem:** Models sort the changes array on every call
(`TempoMap.ts:22`, `TimeSignatureMap.ts:27,44`). Per-beat
per-tick scheduling makes this O(N log N × beats × ticks).

**Representative files:**

- `src/modules/Transport/models/TempoMap.ts:17-42`
- `src/modules/Transport/models/TimeSignatureMap.ts:17-72`

**Needed:** Either (a) maintain the changes array sorted at insert
time (already done in `addTempoChange`/`addTimeSignatureChange`'s
insert path — the sort here is defensive), drop the sort and
require the invariant; or (b) cache a sorted snapshot in the store
and refresh on `set`. Add a binary search for the beat lookup.

### 21. Setlist, loop-station, and punch recording stores not persisted

**Problem:** Three stores use the in-memory `createStore` factory
without `createAutomergeStorage`, so they are lost on reload:

- `stores/setlistStore.ts:48-57`
- `stores/loopStationStore.ts:62-71`
- `stores/punchRecordingStore.ts:55-63`

This is undocumented; if the feature is intended to be transient,
say so; if it is intended to persist, fix it.

**Representative files:**

- `src/modules/Transport/stores/setlistStore.ts:48-57`
- `src/modules/Transport/stores/loopStationStore.ts:62-71`
- `src/modules/Transport/stores/punchRecordingStore.ts:55-63`

**Needed:** Decide policy. If transient, add a doc-comment. If
persistent, add `storage: createAutomergeStorage('root', '<name>',
…)` and pick the persistable subset (similar to
`transportStore`'s `toCrdt` projection).

### 22. Loop-station feature is UI-only, no audio pipeline

**Problem:** `loopStation/triggerSlot`, `triggerScene`,
`toggleRecord`, etc. mutate `loopStationStore` slot states
(`empty → recording → playing → overdubbing`) but no use case wires
audio capture, layered playback, scene-launch quantization, or any
audible output. The feature presents as a working
"clip launcher" — none of it produces sound.

**Representative files:**

- `src/modules/Transport/useCases/loopStation/*.ts`
- `src/modules/Transport/presentations/views/LoopStationPanel.tsx`

**Needed:** Either (a) wire to `AudioEngine` recording / scheduling,
implement scene-launch quantization to bar boundaries, layer
mix-down on overdub commit; or (b) flag in UI that the feature is
non-functional.

### 23. Setlist not coordinated with transport

**Problem:** `setlistStore` carries `currentIndex`, `autoAdvance`,
`countInBars`, `gapSeconds` — none of which are read by the
playhead scheduler or transport controls. Hitting "Next item" on
the setlist UI mutates the store; playback continues unchanged.

**Representative files:**

- `src/modules/Transport/stores/setlistStore.ts:48-57`
- `src/modules/Transport/useCases/setlist/*`
- `src/modules/Transport/useCases/playheadScheduler.ts` (no setlist read)

**Needed:** Wire setlist advance to `seekPlayhead` (load the item's
`projectPath`, set `tempo` / time-signature, optionally fire
`programChange`, run the per-item count-in). If the setlist is
intentionally a future feature, isolate it behind a feature flag
or doc comment.

### 24. `scheduleFrozenTrack` plays at "beat 0" of the project

**Problem:** `scheduleMidiNotes.ts:136`: `const beatOffset = 0 -
accumulatedPosition`. The frozen render is treated as if it begins
at beat 0; there is no offset to where the original clips actually
start. A frozen track whose first clip began at beat 32 will sound
its content immediately when playing from beat 0.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:112-160`

**Needed:** Resolve the original first-clip startBeat (or store the
`renderStartBeat` on `freezeState`) and offset the frozen buffer
by it.

### 25. Loop wrap epsilon and `lastScheduledBeat` magic numbers

**Problem:** `playheadScheduler.ts:95`,`:139`,`:163`,
`scheduleMetronome.ts:16` use `0.0001` and `Math.floor(position) - 1`
as initial offsets. At very fast tempos they collapse onto the same
integer beat; at very slow tempos they straddle real onsets.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:95,139,163`
- `src/modules/Transport/useCases/scheduling/scheduleMetronome.ts:16`

**Needed:** Replace with a tempo-aware "smallest schedulable beat
delta" or, better, track scheduled beats by `id`/`index` rather than
by float comparison.

### 26. `stopPlayback` double-stop float-equality

**Problem:** `transportControls/stopPlayback.ts:34`: `state.playheadPosition
=== state.loopStart` — float equality. After a loop wrap, rounding
errors mean the second stop press silently fails to jump to 0.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/stopPlayback.ts:30-37`

**Needed:** Use `Math.abs(state.playheadPosition - state.loopStart) <
EPSILON` with a tempo-derived epsilon, or anchor "at loop start" via
a boolean set during the wrap.

### 27. Pre-roll and count-in not aligned with tempo / time-sig changes

**Problem:** `transportControls/toggleRecording.ts:84-95` schedules
count-in clicks at `ctx.currentTime + index / (state.tempo / 60)` —
the **flat** `state.tempo`, ignoring tempo and time-signature
changes inside the pre-roll bars. Same flaw means
`startPlayback`'s `preRollBeats = state.preRollBars *
state.timeSignatureNumerator` ignores any time-signature change at
the rolled-back position.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/toggleRecording.ts:83-105`
- `src/modules/Transport/useCases/transportControls/startPlayback.ts:18-24`

**Needed:** Resolve tempo and time-sig at the rolled-back position,
not at the play position. For count-in, route the clicks through
the same `scheduleMetronome` pipeline so the tempo/time-sig
treatment matches.

### 28. Worker `setInterval` drift / no high-resolution clock

**Problem:** `workers/schedulerWorker.ts:22` uses raw `setInterval`
with no drift correction. `setInterval` drift in workers is small
but real over many minutes; it can fall behind the audio clock.
Combined with a 100 ms schedule-ahead window, the cushion shrinks
over time.

**Representative files:**

- `src/modules/Transport/workers/schedulerWorker.ts:22-24`

**Needed:** Use `setTimeout` recursively with `performance.now()`-based
drift correction (target = lastFire + interval; next = max(0, target
- now)). Or run a self-clocking loop driven by audio context
'audioprocess' events. Keep the schedule-ahead window adaptive to
observed jitter.

### 29. `useCases/index.ts` re-exports `defaultTransportState` (runtime) and `TransportState` (type)

**Problem:** Mixing `export type { TransportState, … }` with `export {
defaultTransportState }` in the same barrel makes the cross-module
boundary ambiguous. Per AGENTS.md, types should not leak; runtime
constants are fine.

**Representative files:**

- `src/modules/Transport/useCases/index.ts:69-70`

**Needed:** Drop the `export type` line. If a downstream module
genuinely needs `TransportState`, derive it via
`ReturnType<typeof getTransportState>`. Or move the type to
`events/` if it's part of an event payload contract.

### 30. `scheduleMidiNotes` can throw on `notes[0]!`

**Problem:** `scheduleMidiNotes.ts:296`: `transformedNotes.push({
...notes[0]!, … })`. If the Yeast worklet produces output without
any input notes (`notes.length === 0`), the non-null assertion
crashes the tick. The current callers gate on `notes` being defined,
not on its length.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:200-303`

**Needed:** Guard `notes.length > 0` before the transform pass, or
construct `transformedNotes` from a default note shape rather than
spreading from `notes[0]`. Add a test for the empty-input case.

### 31. `scheduleMidiNotes` Yeast `endBeat` fallback is hard-coded 0.25

**Problem:** `scheduleMidiNotes.ts:294`: `endBeat = … offTime !==
null ? … : startBeat + 0.25`. No comment, no constant. A note that
the Yeast worklet emits without a paired noteOff truncates to a
quarter beat regardless of the source duration.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:293-294`

**Needed:** Use the source note's duration as the fallback (carry it
through the worklet event metadata) or document the 0.25 as a
named constant `YEAST_DEFAULT_NOTE_LENGTH_BEATS` and surface a
warning when used.

### 32. `evaluateFollowActions` "last-writer-wins" across tracks

**Problem:** `evaluateFollowActions.ts:46-48` (NOTE comment) — only
one `jumpToPosition` survives per tick across all tracks. Documented
in code, but if multiple tracks have follow-actions firing on the
same tick, the result is non-deterministic relative to track order
edits.

**Representative files:**

- `src/modules/Transport/useCases/evaluateFollowActions.ts:46-128`

**Needed:** Define the priority semantics (e.g. "first-finishing
clip's follow-action wins") and document. Or accept a `priority`
field on follow-actions. Today's behavior is order-dependent and
silent.

### 33. `tempoMapping.detectTempoFromOnsets` slice-per-frame

**Problem:** Same `slice(...).reduce(...)` per-frame anti-pattern
called out in the AudioAnalysis audit. With a long onset list this
is O(N²) and allocates a sub-array each iteration.

**Representative files:**

- `src/modules/Transport/useCases/tempoMapping/operations/detectProjectTempo.ts:62-66`

**Needed:** Replace with a moving-window sum.

### 34. `playheadPositionRef` mutable singleton with no observability

**Problem:** `stores/playheadPositionRef.ts:13` is a `{ current: 0 }`
object. The doc-comment defends the design (high-frequency reads
without React triggers). Tests / devtools cannot observe writes
without polling, and the ref is a HMR-invariant singleton with no
reset path.

**Representative files:**

- `src/modules/Transport/stores/playheadPositionRef.ts`

**Needed:** Document the HMR behavior explicitly. Optionally provide
a `subscribe(cb)` method gated by a `__DEV__` flag for debugging.

### 35. `transportStore.toCrdt` projection silently drops new fields

**Problem:** `stores/transportStore.ts:11-47`. New fields added to
`TransportState` will not persist unless the dev also adds them to
the explicit projection. There is no compile-time guard that the
projection covers all persistable fields.

**Representative files:**

- `src/modules/Transport/stores/transportStore.ts:11-47`

**Needed:** Extract a `PersistableTransportState` type that
`toCrdt` returns, and have `defaultTransportState` `satisfies` a
union of `PersistableTransportState & RuntimeOnlyFields`. Or
invert: `RUNTIME_ONLY_KEYS = ['playheadPosition', 'isPlaying',
'isRecording', 'overdubEnabled', 'scheduleGrainMs'] as const` and
project by `Object.entries(state).filter(([k]) => !RUNTIME_ONLY_KEYS
.includes(k))`. Either way, future fields shouldn't silently drop.

### 36. Multiple `getCurrentTime()` calls per scheduling block

**Problem:** Inside `scheduleAudioClips` and `scheduleMidiNotes`
the audio-context current time is queried repeatedly
(`scheduleAudioClips.ts:182,183,193,237`,
`scheduleMidiNotes.ts:137,138,407`). Within one scheduling tick
these should snapshot once.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts`

**Needed:** Snapshot `audioNow = ctx.currentTime` at the top of each
tick and pass it through.

### 37. `gainNodePool` grows monotonically

**Problem:** `scheduleAudioClips.ts:37-57`. Released nodes go to a
pool with no eviction. Long sessions accumulate retained `GainNode`
references. With HMR the pool survives across reloads.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:37-57`

**Needed:** Cap pool size (e.g. 64 nodes) with FIFO eviction; on HMR
dispose-listener if available.

### 38. `getBarBeatAtPosition` 480 PPQ magic constant

**Problem:** `models/TimeSignatureMap.ts:69`. The PPQ constant is
hard-coded inline. Convention varies (96 / 480 / 960 / 1920) — a
named constant would clarify and centralise.

**Representative files:**

- `src/modules/Transport/models/TimeSignatureMap.ts:69`

**Needed:** `const PPQ_RESOLUTION = 480 as const` at module top with
a comment.

### 39. `loopStation` slot identity mutation

**Problem:** `loopStation/toggleRecord.ts:39`,
`triggerSlot.ts:18`, `triggerScene.ts:11`: state-machine
transitions are written via `state.slots.map(...)`, allocating a
new array on every state change. Acceptable for UI state, but each
mutation also touches every slot — a project with 64 slots
allocates 64 new objects per slot toggle.

**Representative files:**

- `src/modules/Transport/useCases/loopStation/toggleRecord.ts`
- `src/modules/Transport/useCases/loopStation/triggerSlot.ts`
- `src/modules/Transport/useCases/loopStation/triggerScene.ts`

**Needed:** Acceptable as-is given the UI scale; flag if a future
performance audit picks at this. Not a priority.

### 40. Tests: scheduler tick-level behavior under-covered

**Problem:** `useCases/__tests__/playheadScheduler.spec.ts` exists
(not read in detail) but the high-risk corner cases — tempo change
crossing a tick boundary, loop wrap with in-flight audio sources,
loop region edited mid-playback, seek while recording, very-long
delta after audio-context suspension — are not surfaced as named
test cases by file inspection.

**Representative files:**

- `src/modules/Transport/useCases/__tests__/playheadScheduler.spec.ts` (review)
- `src/modules/Transport/useCases/scheduling/__tests__/scheduleMetronome.spec.ts` (review for `_lastMetronomeBeat` reset)

**Needed:** Property tests for tempo-curve advance. Integration tests
for record-across-loop-wrap, pause→play→metronome-state, seek →
schedule reset. Adversarial tests for loop region inversion and
playhead-outside-loop-region.

### 41. Transport module has no root `index.ts` (AGENTS.md hard violation)

**Problem:** AGENTS.md mandates: "Cross-module imports MUST only
target the destination module's root `index.ts`." Verified by
listing `src/modules/Transport/` — there is no `index.ts` at the
module root. External consumers (Workspace, Arrangement, AiRuntime,
Command, Toaster, Collaboration, Project, …) reach into Transport
via `#/modules/Transport/useCases`, `#/modules/Transport/stores`,
`#/modules/Transport/models/TransportState`, and
`#/modules/Transport/presentations/views`. Each of those is a
deep import bypassing the (missing) barrel.

Concrete examples:

- `src/app/bootstrap.ts:55` — `from '#/modules/Transport/useCases'`
- `src/modules/Workspace/.../AppShell.tsx:30` —
  `from '#/modules/Transport/presentations/views'`
- `src/modules/Arrangement/.../BeatRulerBar.tsx:5` —
  `import { type TransportState, seekPlayhead, … } from
  '#/modules/Transport/useCases'` (type leak _and_ missing
  barrel)
- `src/modules/Arrangement/useCases/recording/__tests__/stopRecording.spec.ts:6`
  — `import type { TransportState } from
  '#/modules/Transport/stores/transportStore'` (deep file path,
  not even the `stores/index.ts` barrel)

**Representative files:**

- `src/modules/Transport/` (no `index.ts` at root)
- `src/modules/Transport/stores/index.ts` (re-exports types
  that should not cross module boundaries)
- `src/modules/Transport/useCases/index.ts:69` (re-exports model
  types — already in #18)

**Needed:** Create `src/modules/Transport/index.ts` re-exporting
the curated public surface from `useCases/`, `events/` (none
yet), `stores/` (only stores _values_, not `TransportState` type
— see #42), and `presentations/views/`. Migrate all cross-module
imports to use the root barrel. Remove `models/index.ts`
(Finding #74). After landing, `pnpm deps:validate` must pass
zero violations.

### 42. `stores/index.ts` re-exports `TransportState` (a model)

**Problem:** AGENTS.md model-isolation rule: "Models are strictly
private to their owning module and must never be exported or
re-exported across module boundaries — not even through
`useCases/`." `stores/index.ts:13` re-exports
`TransportState` from `./transportStore`, which itself re-exports
from `models/TransportState.ts`. Same issue compounds with
Open issue #18 for `useCases/index.ts:69`. The store-defined
types (`SetlistItem`, `LoopSlot`, `LoopStationState`, etc.) at
lines 16-19 _are_ in stores/, but they are domain shapes — and
they cross module boundaries via the same barrel.

**Representative files:**

- `src/modules/Transport/stores/index.ts:13`
- `src/modules/Transport/stores/transportStore.ts:6` (re-exports
  `defaultTransportState, type TransportState` from models)

**Needed:** Drop the type re-export. Move the runtime constant
`defaultTransportState` to a non-barrel re-export site (or have
external consumers compute it from `getTransportState()`).
External callers needing the shape should use
`ReturnType<typeof getTransportState>` or define a local
projection.

### 43. `models/index.ts` is a forbidden barrel

**Problem:** `models/index.ts` re-exports from `TransportState`,
`TempoMap`, `TimeSignatureMap`, `TempoMappingTypes` via
`export * from './…'`. AGENTS.md: "Do not add `index.ts`
barrels … _except_ each module's **root** `index.ts`." This is a
non-root barrel inside a folder whose contents are explicitly
private. No cross-module consumer was found importing
`#/modules/Transport/models` directly, but the barrel exists
and invites future violations.

**Representative files:**

- `src/modules/Transport/models/index.ts`

**Needed:** Delete the barrel (after confirming no consumer
imports it). Intra-module callers use relative imports per
AGENTS.md "Same module — relative imports".

### 44. `setPunchIn` / `setPunchOut` admit inverted regions and have no project-end clamp

**Problem:** `transportControls/setPunchIn.ts:9` clamps `Math.max(
0, beat)` only. Same in `setPunchOut.ts:9`. There is no
`punchOut > punchIn` cross-validation; the scheduler defends
with `current.punchInBeat < current.punchOutBeat` at
`playheadScheduler.ts:189`, so an inverted region "silently
disables punch", same shape as Open issue #5/#6 for loop. Plus
no project-end clamp — `setPunchOut(99999)` is silently
accepted.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/setPunchIn.ts`
- `src/modules/Transport/useCases/transportControls/setPunchOut.ts`

**Needed:** Add a `validatePunchRegion(in, out, projectEnd)` use
case (parallel to the loop-region one in Open issue #10) that
rejects inverted regions and clamps to project end. Wire to both
setters.

### 45. `seekPlayhead` while playing destroys automation recording continuity and does not commit recording

**Problem:** Two coupled bugs in
`transportControls/seekPlayhead.ts:17-28`. When `wasPlaying`:

1. `stopPlayheadScheduler()` calls `stopAutomationRecording()`
   (`playheadScheduler.ts:283`); `startPlayheadScheduler()` then
   calls `startAutomationRecording()` (`:89`). Every seek tears
   down and re-arms automation recording, splitting any
   in-progress automation lane and dropping any pending
   write-buffered events.
2. The audio recording branch is NOT committed. If
   `transport.isRecording === true` and the user seeks, the
   `MediaRecorder` keeps capturing while the playhead jumps —
   the resulting clip's audio buffer covers wallclock time, but
   `recClip.startBeat` was set when `beginActualRecording` ran
   (pre-seek). Audio and timeline diverge silently.

`stopPlayback` does commit recording first
(`stopPlayback.ts:21-23`); `seekPlayhead` doesn't.

**Representative files:**

- `src/modules/Transport/useCases/transportControls/seekPlayhead.ts:8-29`
- `src/modules/Transport/useCases/transportControls/recordingLifecycle.ts`
- `src/modules/Transport/useCases/playheadScheduler.ts:282-303`

**Needed:**

- Commit any in-progress audio recording before the seek (route
  through `stopActiveRecording` if `isRecording`).
- Either preserve automation recording across seek (track the
  active lane in a holder that is not torn down by
  `stopPlayheadScheduler`), or stop+commit the lane and emit a
  user-visible "automation lane split" notification so the user
  knows to merge it.
- Add a test: seek-while-recording → expect (a) recording
  committed before seek, (b) automation lane committed at seek
  position.

### 46. In-flight `tick()` race window after `worker.terminate()`

**Problem:**
`stopPlayheadScheduler` calls `worker.postMessage({ type:
'stop' }); worker.terminate();` (`playheadScheduler.ts:284-288`).
`onmessage` queues `void tick()` per tick message. After
`terminate()`, no further messages fire, but a tick already
queued in the microtask queue is not cancelled. The
`current?.isPlaying` guard at `:102` prevents most damage, but
in `pausePlayback` (`pausePlayback.ts:13-16`) the order is
`stopPlayheadScheduler()` THEN `updateTransportState({
isPlaying: false })`. A tick that resolves between those calls
sees `isPlaying: true` (still — store hasn't been updated) and
runs the full body: `setTransportInfo`, schedules a metronome
click, pushes onto the freshly-emptied `activeAudioSources`.
Worse, `accumulatedPosition` was reset to 0 in
`stopPlayheadScheduler` (`:295`), so `setTransportInfo` writes a
"playing at beat 0 with current tempo" SAB record while the UI
shows the pause position.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:282-303`
- `src/modules/Transport/useCases/transportControls/pausePlayback.ts:13-16`
- `src/modules/Transport/useCases/transportControls/stopPlayback.ts:25-39`

**Needed:** Either (a) flip `isPlaying: false` BEFORE
`stopPlayheadScheduler`, so the in-flight tick sees the false
guard and returns immediately; or (b) add a session-id /
generation counter to `schedulerSession` so a stale tick is
ignored by checking against the current generation; or (c) gate
the in-flight tick on a `schedulerSession.worker !== null` check
in addition to the `isPlaying` check.

### 47. `startPlayback` double-call resets `lastTickTime` to "now", skipping a tick

**Problem:** `transportControls/startPlayback.ts:9-27` does not
guard against being called twice. Two rapid spacebar presses go
through the keyboard-handler chain to `togglePlayback`, which
calls `startPlayback` if `!isPlaying`. The first call flips
`isPlaying: true`. If the second call still sees the pre-update
snapshot of `getTransportState()` (which it can, depending on
how `updateTransportState` is observed in the call chain), it
calls `startPlayback` again. Even if it sees the update, an
external caller could invoke `startPlayback()` directly while
already playing.

`startPlayheadScheduler` re-creates the Worker only if
`!schedulerSession.worker` — so the second call hits the `else`
path and posts another `start` to the same worker. Crucially:

- `schedulerSession.lastTickTime = ctx.currentTime`
  (`playheadScheduler.ts:92`) — overwritten on every call.
- `schedulerSession.accumulatedPosition = state.playheadPosition`
  (`:93`) — overwritten on every call.

Net effect: every double-call re-snaps the scheduler clock to
"now", causing one missed tick advance (the next tick will see
`deltaSec ≈ 0`).

**Representative files:**

- `src/modules/Transport/useCases/transportControls/startPlayback.ts`
- `src/modules/Transport/useCases/playheadScheduler.ts:83-99`

**Needed:** Add an `isPlaying` guard at the top of
`startPlayback` (return early if already playing), and an
"already-running scheduler" guard at the top of
`startPlayheadScheduler` (return early if
`schedulerSession.worker` is non-null).

### 48. `removeTimeSignatureChange` keys by float `beat ===` instead of `id`

**Problem:** Verified at
`useCases/timeSignatureChanges/removeTimeSignatureChange.ts:11`:
`state.changes.filter((context) => context.beat !== beat)`.
Same float-equality anti-pattern as Open issue #12. Compare to
`removeTempoChange` which keys by `id` — the pattern is
inconsistent within the module itself.

**Representative files:**

- `src/modules/Transport/useCases/timeSignatureChanges/removeTimeSignatureChange.ts:3-13`
- `src/modules/Transport/useCases/tempoMap/removeTempoChange.ts` (correct id-based)

**Needed:** Refactor `removeTimeSignatureChange(id: string)` to
match by id. Update the callers (find via
`getTimeSignatureChanges` to get the id, then remove). Update
the spec at
`__tests__/timeSignatureChanges.spec.ts:59-68`.

### 49. `punchRecording/*` use cases are mostly dead code (parallel feature)

**Problem:** Verified by grep: only `togglePunchRecording` is
imported externally. The use cases
`startBackgroundCapture`, `definePunchRegion`,
`updateCapturePosition`, `commitPunchRegion`, `discardCapture`,
`setPreRoll`, `setPostRoll`, `stopBackgroundCapture` are not
imported anywhere outside their own folder + tests. The
scheduler reads `transport.punchInBeat / .punchOutBeat /
.punchInEnabled` — fields on `transportStore`, NOT on
`punchRecordingStore`. So:

- The richer punch-recording feature (background captures,
  regions, pre/post-roll, crossfade) lives in
  `punchRecordingStore` with use cases, handlers, and a UI
  panel — but no scheduler integration, no audio pipeline.
- The simpler punch-in/out feature lives in `transportStore`
  fields and IS scheduler-integrated (`playheadScheduler.ts:184-229`).

This is the same shape as Open issue #22 (loop-station UI-only)
and #23 (setlist not coordinated). Three "shipped" features,
zero of them actually work end-to-end, all visible to the user.

**Representative files:**

- `src/modules/Transport/useCases/punchRecording/*.ts` (all
  unwired except `togglePunchRecording`)
- `src/modules/Transport/stores/punchRecordingStore.ts`
- `src/modules/Transport/presentations/views/PunchRecordingControls.tsx`
- `src/modules/Transport/useCases/playheadScheduler.ts:184-229`
  (uses `transport.punch*` not `punchRecordingStore`)

**Needed:** Decide: ship or strip. If the richer feature is
intended, wire `playheadScheduler` to read from
`punchRecordingStore` and route the punch-arming branch
through `definePunchRegion` / `commitPunchRegion`. If not,
remove the unwired use cases and panels and keep only
`togglePunchRecording`. Either way, add a test that validates
the store/use case stack actually drives recording (or remove
those tests).

### 50. `scheduleMidiNotes` per-note probability uses non-deterministic `Math.random()`

**Problem:** Verified at `scheduleMidiNotes.ts:393`: `if
(probability < 100 && Math.random() * 100 >= probability)
continue;`. `evaluateFollowActions.ts:8-18` already defines a
`seededRandom(clipId, position)` and uses it for `play_random`
follow-actions (`:111`). Per-note probability gates pattern
audibility — using `Math.random()` here means two playbacks of
the same project produce different audible patterns.
Inconsistent with `evaluateFollowActions`'s declared
"deterministic pseudo-random" contract (`:3-7`).

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:392-395`
- `src/modules/Transport/useCases/evaluateFollowActions.ts:8-18`

**Needed:** Replace `Math.random()` with
`seededRandom(clip.id, noteStartBeat)` (or extract the helper
to `services/seededRandom.ts` for reuse). Add a test:
"two playbacks of a probability-gated note produce identical
trigger sets".

### 51. `startPlayheadScheduler` reads `scheduleGrainMs` once and ignores changes

**Problem:** `playheadScheduler.ts:98`: `const grainMs =
state.scheduleGrainMs`. Captured at start; never re-read.
`scheduleGrainMs` is in the runtime-only set
(`transportStore.toCrdt` does not persist it — see Open issue
#35). If a settings UI lets the user toggle this, the worker
keeps the stale interval until the next `stopPlayheadScheduler`
+ `startPlayheadScheduler` cycle (typically only on stop or
seek-while-playing).

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:98,279`
- `src/modules/Transport/workers/schedulerWorker.ts`

**Needed:** Either (a) subscribe to
`transportStore.scheduleGrainMs` in `startPlayheadScheduler` and
re-post `{ type: 'start', interval: grainMs }` to the worker on
change; or (b) document the constraint that `scheduleGrainMs`
takes effect only on next play/seek and surface that in the
settings UI.

### 52. `scheduleMidiNotes` Yeast loop-iter re-runs worklet output with stale block metadata

**Problem:** When a Yeast-armed clip has `loopEnabled`, the
worklet runs once per tick over the block `[fromBeat, toBeat)`
and produces `transformedNotes`. The non-Yeast scheduling pass
(`scheduleMidiNotes.ts:375-476`) then iterates the
`transformedNotes` with `for (let iter = 0; iter < maxIterations;
iter++)` and replays them at `clip.startBeat + iter * loopLen +
note.startBeat`. The worklet does NOT know about iteration —
its `transport.barIndex / .beatInBar` (set at `:218-219`) come
from `fromBeat` of the current block. So iter > 0 plays the
worklet output at wrong absolute positions for any
bar-aware Yeast processor (e.g. Euclidean rhythms keyed to bar
position).

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:207-306`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:375-476`

**Needed:** Either (a) run the Yeast worklet once per iteration
with iter-correct `transport.barIndex / .ppqPosition` (kills
performance for many iterations); or (b) document Yeast as
"loop-iteration-agnostic" and disable `loopEnabled` for Yeast
clips at the model level; or (c) cache worklet output by
`(clipId, fromBeat % loopLen, toBeat % loopLen)` and replay
across iters when the input notes are themselves periodic.

### 53. `scheduleMetronome` integer-beat boundary can double-fire on reset

**Problem:** `scheduleMetronome.ts:30-31`: `startBeatInt =
Math.ceil(fromBeat); endBeatInt = Math.floor(toBeat); for (let
beat = startBeatInt; beat <= endBeatInt; beat++)` — inclusive
upper. The `<=` includes `endBeatInt`. The next tick's
`fromBeat = scheduleUpTo` (which is `toBeat`); `Math.ceil(
toBeat)` = same integer, but the `if (beat <=
_lastMetronomeBeat) continue` guard at `:35` filters duplicates.
However, `resetMetronomeBeat(position)` sets `_lastMetronomeBeat
= Math.floor(position) - 1` (`:16`). For `position` exactly on
an integer beat (e.g. loop wrap to `loopStart = 4.0`),
`_lastMetronomeBeat = 3`. Beat 4 then fires. But the previous
tick's `endBeatInt` was `Math.floor(toBeat)` and the previous
tick may already have fired beat 4 (if `toBeat >= 4.0`).
Result: beat 4 fires twice — once on the previous tick (forward
look-ahead) and once after the wrap reset.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMetronome.ts:9-52`
- `src/modules/Transport/useCases/playheadScheduler.ts:139-140`

**Needed:** Either (a) on loop wrap, set `_lastMetronomeBeat =
Math.floor(loopEnd)` so beats already fired in the look-ahead
window are not re-fired; or (b) track scheduled metronome
clicks by `(beat, audioContextTime)` tuple and dedupe on
audio-clock instead of integer-beat. Add a property test:
"loop wrapping at an integer beat does not double-fire the
metronome".

### 54. `schedulerSession` survives HMR with no dispose path

**Problem:** `playheadScheduler.ts:56-66` is a module-level
holder. On HMR, the module re-evaluates and re-creates
`schedulerSession` — but the previous Worker, GainNodes from
`scheduleAudioClips.gainNodePool`, `activeAudioSources`, and
`scheduledAudioClips` keys live on in the previous module
instance. Without an `import.meta.hot` dispose handler, those
references leak.

For users this is a dev-only concern (production has no HMR),
but it makes scheduler bugs harder to reproduce: a "ghost
metronome" or "phantom audio source" after HMR is invisibly
sourced from the previous module instance.

**Representative files:**

- `src/modules/Transport/useCases/playheadScheduler.ts:56-66`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:29-37`

**Needed:** Add `import.meta.hot?.dispose(() => {
stopPlayheadScheduler(); gainNodePool.length = 0;
sessionState.requestedAssets.clear(); })` at module scope. Or
move the holders into a true singleton service that exposes a
`dispose()`.

---

## Open questions

- [ ] Is `loopStation` intended to be a working feature, or
      scaffolding? (Affects whether issue #22 is a bug or a
      "do not promote yet" item.)
- [ ] Is `setlist` intended to drive transport advance, or to be a
      passive UI only? (Affects #23.)
- [ ] What is the intended semantics of "pre-roll" vs "count-in"?
      (Affects #27 and #43-#45 in findings.)
- [ ] Are `setlistStore`, `loopStationStore`, `punchRecordingStore`
      meant to persist across project reloads? (Affects #21.)
- [ ] What is the canonical project-end beat? Is it an `Arrangement`
      query? (Affects #10 / `seekPlayhead` clamp.)
- [ ] Is `detectProjectTempo` supposed to actually run onset
      detection, or is it a placeholder? (Affects #13.)
- [ ] What is the maximum tempo the audio engine actually supports
      stably? (300, 400, 999?) — drives #11.
- [ ] Is the `punchRecording/*` use case stack
      (`startBackgroundCapture`, `definePunchRegion`, etc.)
      supposed to replace the simpler `transport.punchInBeat /
      .punchOutBeat` field-based system, or is one of them
      intended to be removed? (Affects #49.)
- [ ] Should automation recording survive a seek-while-recording?
      Or is splitting / committing the lane the desired UX?
      (Affects #45.)
- [ ] Is two-phase `Math.random()` vs seeded-PRNG split between
      `evaluateFollowActions.play_random` and
      `scheduleMidiNotes.probability` intentional? (Affects #50.)
- [ ] When a Yeast-armed clip has `loopEnabled`, should each
      iteration get its own worklet pass with iter-correct
      transport metadata, or is "run once, replay across iters"
      acceptable for the current Yeast processor set? (Affects
      #52.)
- [ ] Is `scheduleGrainMs` a deploy-time constant or a runtime
      tunable? Today it's read once at scheduler start.
      (Affects #51.)

---

## Risks

- **Audible drift during tempo curves.** Issues #1, #2, #3, #14,
  #52: the scheduler uses one tempo to advance position, another
  tempo to schedule each event. With any non-flat tempo map,
  audio clips, MIDI notes, and metronome ticks drift relative to
  the visual playhead. For a "DAW with tempo automation", this is
  core correctness. Yeast-armed loops compound (#52).
- **Loss of recorded audio across loop wraps.** Issue #4:
  multi-take loop recording silently overwrites takes; the user
  hits stop and finds N-1 of their N takes empty. Catastrophic
  data loss if the user relied on it.
- **Loss of recording state on seek.** Issue #45:
  seek-while-recording does not commit the in-progress recording;
  audio buffer covers wallclock time but `recClip.startBeat` is
  pinned to the original start. The clip plays back in the wrong
  timeline position with no warning. Same risk class as #4.
- **Surprise recording on count-in.** Issue #7: user pauses or
  toggles play during a count-in and records start anyway when the
  timer fires. UX failure with side-effects (silent file write).
- **Punch double-arm.** Issue #8: enabling punch mid-record
  produces two concurrent `MediaRecorder` calls per track, with
  undefined audio engine behaviour on the second invocation.
- **Race-window on stop/pause.** Issue #46: in-flight `tick()`
  fires after `worker.terminate()` and before `isPlaying`
  flips, writing one extra `setTransportInfo` (with stale
  position 0) and pushing a stale `activeAudioSources` entry.
  Audible: occasional click on stop, occasional metronome tick
  one beat after stop.
- **Loop escape after region edit.** Issues #5, #6, #10, #44:
  editing loop-end below the playhead can let playback escape the
  loop; inverted regions silently disable looping (loop _and_
  punch); seek to beyond project end runs forever. Punch has the
  same shape (#44).
- **DAW-as-interpreter UX failures.** Issue #13:
  `detectProjectTempo` returns the input tempo; user sees
  "we detected 120 BPM" because they had it set to 120.
  Issue #22: loop-station is a state-machine theater with no audio.
  Issue #23: setlist is a list with no playback hookup.
  Issue #49: `punchRecording/*` is a 9-file richer feature
  shipped with UI, handlers, and tests, none of which produce
  any audible result.
- **Architectural drift.** Issues #17, #18, #29, **#41, #42,
  #43**: positional-arg signatures in hot scheduling functions,
  type re-exports through use case barrels, **no module root
  barrel at all**, model types leaking via `stores/index.ts`,
  and a forbidden non-root barrel in `models/`. The missing
  root barrel is the most consequential — it makes the
  curated public surface unenforceable.
- **Determinism leak.** Issue #50: per-note probability uses
  `Math.random()` while follow-actions use a seeded PRNG. Same
  project produces audibly different patterns across replays —
  contradicts the project's own deterministic-replay invariant
  (e.g. for test snapshots, collaboration replay).
- **Hot-loop GC.** Issue #14: per-tick allocations on the
  scheduling thread are GC pressure on the **same** thread that
  drives `audioEngine.setTransportInfo` and the
  schedule-ahead window. A large GC pause = audible click.
- **HMR ghost state.** Issue #54: `schedulerSession`,
  `gainNodePool`, `sessionState.requestedAssets` survive HMR
  with no dispose path. Dev-only, but it makes scheduler bugs
  silently impossible to reproduce after a hot reload.

---

## Suggested approaches

- **Single beat→time helper.** Define `beatToAudioTime({ beat,
anchorBeat, anchorTime, tempoMap })` once in
  `models/TempoMap.ts` (or a new `services/timeConversions.ts` —
  the kind of pure helper that fits the AGENTS.md `services/`
  rule), and replace every `getCurrentTime() + beatOffset /
(tempo / 60)` site with it. This collapses issues #1, #2, #3,
  #10, #14 into a single sound implementation.
- **Tempo-map invariants.** Maintain `tempoMapStore.changes` and
  `timeSignatureMapStore.changes` as **always sorted by beat** at
  insert time, with a `satisfies` invariant. Drop the
  per-call `[...].sort()`. Add a binary search for the lookup.
  This addresses issues #20, #48, #49.
- **State machine extraction.** Extract a typed `TransportPhase`
  union (`'idle' | 'playing' | 'recording' | 'count-in' |
'pre-roll' | 'punch-armed' | 'punch-active' | 'paused'`) into
  `models/TransportState.ts`, derived from existing fields.
  Have `togglePlayback`/`stopPlayback`/`toggleRecording` /
  `pausePlayback` switch on phase. This addresses issues #7, #8,
  #46 by making invalid transitions structurally impossible.
- **Single canonical loop-region validation.** A `validateLoop
Region(start, end, projectEnd)` helper rejects inverted /
  out-of-range regions. Wire to `setLoopRegion` and to the
  scheduler's "playhead outside loop" guard. Addresses #5, #6,
  #10.
- **Drift-corrected scheduler tick.** Replace the worker
  `setInterval` with a self-correcting `setTimeout` recursion,
  and snapshot `ctx.currentTime` once per tick — pass through to
  scheduling. Addresses #28, #36.
- **Source tracking via `Set`.** Replace `activeAudioSources:
Array<>` with `Set<>`; `delete()` is O(1) and not index-based.
  Addresses #19, #64.
- **Single canonical tempo-bound constants.** `MIN_BPM`,
  `MAX_BPM` in `models/TempoMap.ts`; reuse from `setTempo`,
  `addTempoChange`, `updateTempoChange`,
  `createTempoChange`, `InvalidTempoError`. Addresses #11.
- **Make `detectProjectTempo` real or delete it.** If kept, route
  through `AudioAnalysis.detectTempoFromOnsets` against actual
  audio buffers. Addresses #13.
- **AGENTS.md sweep.** Object-param refactor for the 8+ multi-arg
  functions; drop the `export type` from `useCases/index.ts`;
  document/clean the use-case → models indirection in
  `transportQueries/helpers.ts`. Addresses #17, #18, #29.
- **Module root barrel.** Create
  `src/modules/Transport/index.ts` curating the cross-module
  public surface. Migrate ~30+ deep imports across 12+ modules.
  Drop type re-exports from `stores/index.ts` and
  `useCases/index.ts`. Delete `models/index.ts`. Run `pnpm
  deps:validate` until zero violations. Addresses #41, #42,
  #43, and consolidates #18, #29.
- **Generation-counter scheduler session.** Replace the
  module-level `schedulerSession` with a holder that includes a
  `generation: number`. `stopPlayheadScheduler` increments the
  generation; `tick()` captures the generation at entry and
  bails if the captured value differs from the current. Closes
  the in-flight tick race (#46) and is a precondition for HMR
  dispose (#54).
- **Recording-aware seek.** Wrap `seekPlayhead` to commit any
  in-progress recording (`stopActiveRecording`) before the seek,
  and either preserve or split the automation lane explicitly
  with a user-visible notification. Addresses #45.
- **Single seeded RNG.** Extract `seededRandom(seed1, seed2)` to
  `services/seededRandom.ts` and use it everywhere
  (`evaluateFollowActions.play_random`,
  `scheduleMidiNotes.probability`). Addresses #50.
- **Tests.** Property test for tempo-curve advance; integration
  test for record-across-wrap, seek-while-recording, and
  pause-then-resume metronome; adversarial tests for inverted
  loop / inverted punch / out-of-range seek; double-press
  spacebar test for `startPlayback`.

---

## Recommendation

Start with **issue #41 (no root `index.ts`)** — this is a hard
AGENTS.md violation, and every cross-module import surveyed is
illegal-by-spec until it lands. Create
`src/modules/Transport/index.ts` re-exporting the curated public
surface from `useCases/`, `stores/` (values only), and
`presentations/views/`. Migrate cross-module call sites (rough
count: ~30+ deep imports across 12+ modules). Run `pnpm
deps:validate` until zero violations. While you're there, drop
the model-type re-exports from `useCases/index.ts:69` (issue
#18) and `stores/index.ts:13` (issue #42), and delete
`models/index.ts` (issue #43).

Then **issue #1 + #2 (single beat→time helper)** — fixing the
scheduler's tempo-curve drift is the single highest-value
correctness change in the module, and the helper unifies five
other issues (#3, #10, #14, #27, #52). Land it as a standalone
PR with a property test that asserts integrated beats == direct
integration of the tempo map.

Next, **the recording data-loss class — issues #4 + #45 + #46**
as a single PR. (a) `#4`: loop-wrap during recording must stop
and restart per-track recording, not just create a take row.
(b) `#45`: `seekPlayhead` must commit any in-progress recording
before the seek and either preserve or commit-and-split the
automation lane. (c) `#46`: in-flight `tick()` after
`worker.terminate()` must be neutralised — flip `isPlaying:
false` BEFORE `stopPlayheadScheduler`, or add a generation
counter. These three share recovery test infrastructure.

Then **issues #7, #8, #47 (state machine sequencing)** as a
single "transport phase" PR — extract a typed phase union,
make count-in / punch / record transitions explicit, remove
the shadow `punchRecordingActive` boolean, and add the
"already-playing" guard in `startPlayback`. Closes the sneaky
"surprise recording", "double-arm", and "double-press resets
tick clock" failure modes.

After those land, choose between the **correctness pass** (#5,
#6, #9, #10, #11, #12, #15, #19, #44, #48, #50, #53) and the
**architecture pass** (#14, #16, #17, #18, #20, #29, #42, #43,
#54). They are independent.

The **dead-feature decision** (#22, #23, #49) is orthogonal to
all of the above and should be made by the user, not the agent
— the audit's job is to surface that three "shipped" features
do not function.

---

## Resolved

_No issues resolved yet._
