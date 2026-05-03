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

---

## Priorities

1. **Scheduler tempo-curve correctness (#2, #3, #4, #10, #14, #18)** —
   tempo changes mid-playback produce drift between visual playhead,
   audio clip placement, MIDI note timing, and metronome ticks. This is
   the single most user-visible "jitter" hazard.
2. **Loop-region edge cases (#5, #6, #7, #21)** — loop wrap during
   recording loses audio (#21), `loopEnd <= loopStart` silently
   disables looping (#7), playhead can escape the loop region after
   an edit (#6), and `stopActiveSources` races the new tick (#5).
3. **Play/stop/record state-machine races (#22, #26, #27, #46, #53)**
    — count-in timer not cleared on `stopPlayback`, double-arm of
   audio recording when punch is enabled mid-record, divergent
   `punchRecordingActive` vs `transportStore.isRecording`, double
   `stopAudioRecording` calls on stop.
4. **Tempo / time-sig validation drift (#36, #37, #38, #39)** —
   three different BPM upper bounds (300 / 999 / no-bound), float
   beat-equality used as a key, CRDT-replayable inserts producing
   near-duplicates.
5. **Hot-loop allocations and per-call sorts in models (#16, #17, #20,
   #35, #48, #49, #50, #60)** — every `getTempoAtBeat` call sorts the
   tempo map; every Yeast-armed tick allocates Maps; tempo detection
   slices per frame.
6. **`detectProjectTempo` is a closed-loop fake (#34)** — function
   "detects" the input tempo by construction. UX-misleading.
7. **Beats↔seconds conversion uses `transport.tempo` directly in
   places that should use the tempo map (#14)** — Yeast worklet
   block boundaries ignore the tempo map entirely.
8. **`scheduleMetronome` module-level state racing across pause/play
   sequences (#9, #10, #42)** — metronome misses clicks on pause/play
   without stop.
9. **`AGENTS.md` violations (#41, #54, #55, #56)** — type
   re-exports from useCases, multi-positional-arg functions, deep
   imports.

---

## Open issues

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

---

## Risks

- **Audible drift during tempo curves.** Issues #1, #2, #3, #14:
  the scheduler uses one tempo to advance position, another tempo
  to schedule each event. With any non-flat tempo map, audio clips,
  MIDI notes, and metronome ticks drift relative to the visual
  playhead. For a "DAW with tempo automation", this is core
  correctness.
- **Loss of recorded audio across loop wraps.** Issue #4:
  multi-take loop recording silently overwrites takes; the user
  hits stop and finds N-1 of their N takes empty. Catastrophic
  data loss if the user relied on it.
- **Surprise recording on count-in.** Issue #7: user pauses or
  toggles play during a count-in and records start anyway when the
  timer fires. UX failure with side-effects (silent file write).
- **Punch double-arm.** Issue #8: enabling punch mid-record
  produces two concurrent `MediaRecorder` calls per track, with
  undefined audio engine behaviour on the second invocation.
- **Loop escape after region edit.** Issues #5, #6, #10: editing
  loop-end below the playhead can let playback escape the loop;
  inverted regions silently disable looping; seek to beyond project
  end runs forever.
- **DAW-as-interpreter UX failures.** Issue #13:
  `detectProjectTempo` returns the input tempo; user sees
  "we detected 120 BPM" because they had it set to 120.
  Issue #22: loop-station is a state-machine theater with no audio.
  Issue #23: setlist is a list with no playback hookup.
- **Architectural drift.** Issues #17, #18, #29: positional-arg
  signatures in hot scheduling functions, type re-exports through
  use case barrels, are the kinds of violations that normalise
  and spread.
- **Hot-loop GC.** Issue #14: per-tick allocations on the
  scheduling thread are GC pressure on the **same** thread that
  drives `audioEngine.setTransportInfo` and the
  schedule-ahead window. A large GC pause = audible click.

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
- **Tests.** Property test for tempo-curve advance; integration
  test for record-across-wrap and pause-then-resume metronome;
  adversarial test for inverted loop and out-of-range seek.

---

## Recommendation

Start with **issue #1 + #2 (single beat→time helper)** — fixing
the scheduler's tempo-curve drift is the single highest-value
correctness change in the module, and the helper unifies four
other issues (#3, #10, #14, #27). Land it as a standalone PR with
a property test that asserts integrated beats == direct integration
of the tempo map.

Next, **issue #4 (loop wrap during recording loses audio)** —
catastrophic data-loss class; needs the loop-wrap branch to stop
and restart per-track recording, not just create a take row.

Then **issues #7, #8, #46 (state machine sequencing)** as a single
"transport phase" PR — extract a typed phase union, make
count-in / punch / record transitions explicit, and remove the
shadow `punchRecordingActive` boolean. This closes the sneaky
"surprise recording" and "double-arm" failure modes.

After those land, choose between the **correctness pass** (#5, #6,
#9, #10, #11, #12, #15, #19) and the **architecture pass** (#14,
#16, #17, #18, #20, #29). They are independent.

---

## Resolved

_No issues resolved yet._
