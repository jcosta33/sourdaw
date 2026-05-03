# MIDI module audit

## Scope

This audit covers `src/modules/MIDI/` in full — every file under
`models/`, `stores/`, `useCases/`, `handlers/`, `transformers/`,
`presentations/views/`, `repositories/`, `errors/`, `events/`, and
`workers/`. It explicitly excludes upstream callers (`Arrangement`,
`Command`, `Toaster`, `AudioEngine`, `Transport`, `Project`,
`Workspace`) except where directly imported by this module, and the
hardware/Web-MIDI message routing in browser code outside the module
boundary.

It is an adversarial review: bugs, races, contracts, off-by-ones,
quantization rounding, note-on/off pairing, channel/CC routing,
velocity/pitch-bend resolution, piano-roll edit invariants, type
soundness, and architectural drift.

Related spec: none on disk.

---

## Goal

A correctness-first MIDI surface for the DAW:

- **Note pairing & ordering** — every note-on has a matching note-off
  in import/export; events at the same tick are ordered with note-offs
  before note-ons; running status is honoured.
- **Channel/CC routing** — CC and pitch-bend events carry the channel
  they came in on; export round-trips channels; MIDI Learn matches
  channel _and_ CC.
- **Edit invariants** — note edits clamp to MIDI ranges (pitch 0–127,
  velocity 1–127, pitch-bend −8192…8191); duration ≥ 1/64 beat;
  startBeat ≥ 0 _consistently_; pattern-instance overrides are honoured.
- **Quantization** — `quantizeNotes`/`quantizeNoteLengths` honour
  `strength`, `swing`, and never round notes off the timeline; legato
  and join handle adjacency robustly.
- **Architecture** — `useCases/` exports runtime values only (no
  `export type` for cross-module types); models stay private; one
  function per `useCases/` file; functions with multiple parameters
  take a single object; AGENTS.md TypeScript soundness honoured (no
  `as`, `as any`, `as unknown as`, no `any`).
- **Tests assert behaviour, not "called with X"** — quantization,
  split, join, transpose, retrograde, MIDI import/export,
  pattern-instance propagation are exercised end-to-end with real
  fixtures.

---

## Relevant code paths

- `src/modules/MIDI/` — _no module root `index.ts`_
- `src/modules/MIDI/models/` — `MidiNote.ts`, `ChordEvent.ts`,
  `ChordTypes.ts`, `ControllerProfile.ts`, `TrackViewTypes.ts`
- `src/modules/MIDI/stores/` — `midiStore.ts`, `midiLearnStore.ts`,
  `chordTrackStore.ts`, `hardwareControllerStore.ts`,
  `stepRecordStore.ts`, `duplicateClipNotes.ts`, `index.ts`
- `src/modules/MIDI/useCases/` — barrel, plus subfolders
  `chordStamps/`, `chordTrack/`, `grooveExtraction/`, `hardware/`,
  `midiEvent/`, `midiLearn/`, `midiNoteCrud/`, `midiNoteTransforms/`,
  `patternInstance/`, `stepRecording/`, `strumNotes/`, and the
  loose-leaf use cases (`arpeggiator.ts`, `createMidiNote.ts`,
  `exportMidiFile.ts`, `formatChordName.ts`, `getChordTrackHandlers.ts`,
  `getMidiLearnState.ts`, `getMidiNoteTransformHandlers.ts`,
  `getMidiStoreState.ts`, `getPatternInstanceHandlers.ts`,
  `importMidiFile.ts`, `setMidiStoreState.ts`, `snapClipToScale.ts`,
  `transposeForChordTrack.ts`)
- `src/modules/MIDI/handlers/` — `chordTrack/`, `noteTransform/`,
  `patternInstance/`
- `src/modules/MIDI/transformers/chordTransposer.ts`
- `src/modules/MIDI/presentations/views/MidiLearnButton.tsx`,
  `index.ts`
- `src/modules/MIDI/repositories/downloadFile.ts`
- `src/modules/MIDI/errors/MidiError.ts`
- `src/modules/MIDI/events/index.ts`
- `src/modules/MIDI/workers/midiImportWorker.ts`,
  `controller-scripting.worker.ts`

---

## Current behavior

**Storage.** `midiStore` keeps three flat maps keyed by `clipId`:
`notesByClipId`, `ccByClipId`, `pitchBendByClipId`. Notes carry
`startBeat` _relative_ to the clip (after the
`migrateAbsoluteMidiNotes` migration), but CC and pitch-bend events
also carry `beat` whose semantics are _undocumented_ — both relative
and absolute interpretations exist in code (see #6, #20).

**Note model.** `MidiNote` has `pitch`, `startBeat`, `duration`,
`velocity`, plus optional `probability`, `pressure`, `slide`,
`pitchBend`. There is no `channel` field on notes, so a clip cannot
preserve per-note channel information across import/export. Imported
files lose channel; exported files are pinned to channel 0
(`exportMidiFile.ts:53–54`).

**MIDI import.** `workers/midiImportWorker.ts` parses Standard MIDI
File format 0/1, returns `ParsedTrack[]` of notes. Sysex, meta-events
other than tempo/track-name, controller events, pitch-bend, channel
information, and aftertouch are all dropped. Notes-on without a
matching note-off are silently dropped (the `Map<pitch, …>` keeps a
single entry per pitch, so two simultaneous notes on the same pitch
collide — see #1).

**MIDI export.** `useCases/exportMidiFile.ts` writes a format-1
single-track .mid. CC events from `ccByClipId` are written; pitch-bend
events are silently omitted; notes' `channel` is hard-coded to 0 in
the status byte. Note-off and note-on events at identical ticks are
sorted only by tick — at a tied note-off→note-on boundary the order is
non-deterministic relative to insertion order (#2).

**Edit operations.** `midiNoteCrud/` covers add/remove/move/resize/
batch CRUD plus `setNoteVelocity*`, `setNoteProbability`,
`shiftClipMidiNotes`, `shiftMidiNotesAfterBeat`, and
`splitMidiNotesAtBeat` (clip-level split). `midiNoteTransforms/`
covers humanize, invert, join, legato, quantize (notes & lengths),
retrograde, scale velocities, set velocities, split note at beat,
transpose. None of the transform/CRUD functions clamp `startBeat ≥
0` consistently — `transposeNotes`, `quantizeNotes`, `humanizeNotes`,
`scaleVelocities`, `joinNotes`, `legatoNotes`, `splitNoteAtBeat`,
`retrogradeNotes`, `invertNotes` all permit notes to drift to negative
`startBeat` (see #3).

**Quantization.** `quantizeNotes` rounds to a grid step, applies
swing, then linearly interpolates by `strength`. `quantizeNoteLengths`
rounds duration to `gridSize` with `Math.max(gridSize, …)` floor —
silently extends notes shorter than the grid (#4).

**MIDI Learn.** `midiLearnStore` holds mappings keyed by
`{ channel, cc }`. `handleMidiMessage(channel, cc, value)` filters
mappings and dispatches via injected `MidiLearnDependencies`.
`completeMidiLearn` writes a new mapping but keys on `(channel, cc)`
only — _multiple_ targets for the same CC are allowed in storage but
will fan out (every matching mapping fires) without any priority.
There is no exclusivity check during learn: completing learn on a CC
that already has a mapping for a _different_ target overwrites only
the entry whose `channel == cc match` — but the conflict signal is
silent (#7).

**Chord track.** `chordTrackStore` persists to `localStorage` directly
on every change (synchronous, blocking), bypassing the Automerge
storage used by `midiStore`. State is loaded once at module-evaluate
time via `loadFromStorage()`; if the document changes from another
tab, this tab never picks it up (#8).

**Step recording.** `stepRecordStore` holds `activeNotes: Set<number>`,
which is a non-serializable mutable structure inside a store that
emits structural-equality notifications. Reading the same set after a
"copy" gives the same identity, and React subscribers won't see the
change without unsafe identity-mutation. `stepRecordNoteOff` advances
the cursor only when `activeNotes.size > 0` _before_ the delete — the
condition `state.activeNotes.size > 0` reads pre-mutation, but the
final cursor-advance check `nextActive.size === 0 && state.activeNotes.size > 0`
will still advance on the last note-off only if the user pressed at
least one note before the off-event arrived — _but_ a stray
note-off for a pitch the store doesn't currently hold short-circuits
at the top guard (#9).

**Worker scripting.** `controller-scripting.worker.ts` evaluates
arbitrary user-supplied JS via `new Function(...)` inside a Worker.
The eslint-disable comment justifies this as "sandboxed" but the
worker has full `self.postMessage` access and can flood the main
thread with `setParam` / `sendMidi` events; there is no rate limiting,
schema validation, or error budget (#11).

**Cross-module model leakage.** Other modules import
`MidiNote` directly from
`#/modules/MIDI/models/MidiNote`, bypassing the public surface
(`Arrangement/stores/__tests__/arrangementMiscStores.spec.ts:9`). This
violates AGENTS.md "Model isolation".

**No module root `index.ts`.** `src/modules/MIDI/` has no top-level
barrel — every external consumer reaches into `#/modules/MIDI/stores`
or `#/modules/MIDI/useCases` directly. AGENTS.md requires a root
`index.ts` as the sole cross-module public surface; without one the
module's public contract is `useCases/` + `stores/` + `events/` +
`presentations/views/` _by convention_, not by enforcement.

---

## Findings

1. **MIDI import drops everything except notes.** The worker parser
   silently swallows CC, pitch-bend, channel-pressure, polyphonic
   aftertouch, and program-change. The handler interface advertises
   a "MIDI import" feature but the file's actual MIDI data is reduced
   to monophonic-channel note streams. A user importing their carefully
   automated controller sweep loses everything.

2. **Same-pitch overlapping notes are silently merged on import.**
   `midiImportWorker.ts:111-178` keeps `activeNotes: Map<number, …>`
   keyed by pitch — a second `noteOn` for an already-active pitch
   _overwrites_ the first start tick, and the matching `noteOff`
   completes the _later_ note while the original note is lost. Files
   with overlapping same-pitch notes (legato sustain pedals,
   rapid-repeat synth lines, MPE/per-note expression) lose data.

3. **Note-on/off ordering and Running Status edge cases.**
   - The export at `exportMidiFile.ts:64` sorts events by `tick` only.
     Two notes that start exactly when another ends (zero-tick
     adjacency) emit `noteOn(B)` and `noteOff(A)` in **insertion
     order**, which is the iteration order of `notesByClipId[clipId]`.
     Conventional SMF practice is "note-off before note-on" at a tied
     boundary so the synth voice doesn't stack-allocate before
     releasing. This produces audible overlap on conforming players.
   - `writeVarLen` masks the value with `0x0fffffff` (`exportMidiFile.ts:8`),
     truncating any delta ≥ 2^28 ticks (~559 hours at 480 PPQN).
     Edge case, but silent on truncation.

4. **`MidiNote` has no `channel`.** Channel is part of MIDI's wire
   contract, not just CC routing — but `MidiNote.ts:1-11` omits it. On
   import, channel is discarded. On export `exportMidiFile.ts:53–54`
   writes `0x90` / `0x80` — no `| (channel & 0x0f)` — so channel is
   pinned to 1 (zero-indexed). Multi-channel files cannot round-trip.

5. **`addMidiCC` returns the cc object before the CRDT settles, with
   no de-duplication on `(beat, channel, controller)`.** Two calls to
   `addMidiCC(clipId, 7, 100, 4)` create two CC events at beat 4 ch 0
   ctrl 7. On export, both are emitted. MIDI playback consumers will
   see the second-written event "win" only because of insertion order
   in the store — but order is not stable across CRDT replays.

6. **CC/pitch-bend `beat` is ambiguous (relative vs absolute).**
   `migrateAbsoluteMidiNotes.ts` migrates **notes** from absolute to
   relative coordinates but leaves CC and pitch-bend untouched.
   `shiftMidiNotesAfterBeat` (`midiNoteCrud/shiftMidiNotesAfterBeat.ts:33–47`)
   compares `event.beat >= atBeat` — this only makes sense if both are
   in the same coordinate system. If notes are clip-relative (post-
   migration) and CC events are timeline-absolute (legacy), the shift
   uses two different reference frames and corrupts the relationship.

7. **MIDI Learn allows duplicate `(channel, cc)` mappings to fan
   out.** `handleMidiMessage` `filter`s mappings and iterates,
   firing each. Nothing prevents the user from binding the same CC
   to both `trackGain` _and_ a device parameter. A single CC sweep
   updates both targets — possibly desired, but `completeMidiLearn`'s
   "replace existing at this `(channel, cc)`" logic only replaces _one_
   row, leaving any prior mapping for that CC in place if the
   `learn → bind → bind elsewhere` sequence happened.

8. **Chord track persists synchronously to `localStorage` on every
   change.** `chordTrackStore.ts:29-34`: `chordTrackStore.subscribe`
   calls `JSON.stringify(state)` and `localStorage.setItem` on every
   mutation. (a) Blocking on the main thread for every chord drag.
   (b) No cross-tab sync — two open tabs will fight. (c) Diverges from
   the rest of the project's Automerge storage; chord-track state is
   **not** part of the project document, so saving the project _without_
   the chord track is possible if the user copies the doc to another
   browser.

9. **Step recording: `activeNotes` mutability and stuck-note risk.**
   - `stepRecordStore.ts:13` `activeNotes: Set<number>` lives inside a
     CRDT-backed store. Writing a `Set` will not survive Automerge
     serialisation cleanly. It also breaks shallow-equality React
     subscribers — `useStore` will not re-render when the set changes
     because the outer state object reference is reconstructed but
     React Compiler-memoised consumers may compare `activeNotes` by
     identity.
   - `stepRecordNoteOff.ts:14` advances on `activeNotes.size > 0 &&
     nextActive.size === 0`. If a user presses A and B, then B-off
     arrives without A-off (e.g. A "stuck" because the device dropped
     a note-off message), the cursor never advances and A is wedged
     in the active set. There is no janitorial timeout.
   - When step-recording is toggled off (`toggleStepRecording.ts:24`),
     `stepRecordStore.set(null)` — the store nullable contract is the
     opposite of the rest of the module; consumers that read
     `state.active` after toggle-off need a `state?.active` guard. No
     `defaultStepRecordState` reset, just null.

10. **`stampChord` clamps individual notes to MIDI range _by skipping
    them_, not by adjusting the chord voicing.**
    `stampChord.ts:27–32`: for `rootPitch = 125, chordType = '9'`,
    intervals `[0, 4, 7, 10, 14]` produce pitches `[125, 129, 132, 135,
    139]` — only the root is kept. The user thinks they stamped a 9th
    chord; they got a single root note. No warning.

11. **`controller-scripting.worker.ts` runs unsandboxed user JS.**
    The eslint-disable comment admits "not a full secure sandbox".
    The worker has full message-passing access; a hostile script can
    `setParam` every device on every track, every frame, and lock up
    the main thread. There is no rate limiting, no opcode budget, no
    timeout. Acceptable for a personal-use DAW; not for shipping
    third-party scripts.

12. **`humanizeNotes` doesn't clamp `startBeat ≥ 0`.**
    `humanizeNotes.ts:17` writes `startBeat: node.startBeat + (rng() -
    0.5) * timingAmount * 0.25`. A note at beat 0 with `timingAmount
    >= 4` (or even 1 in a worst-case RNG) ends up with a negative
    `startBeat`. The MIDI clip rectangle starts at 0 — the note is now
    invisible/unplayable.

13. **`quantizeNotes` swing model is broken for non-pure-grid notes.**
    `quantizeNotes.ts:6-13`: `stepIndex = Math.round(node.startBeat /
    gridSize)` — if `gridSize = 0.25` (1/16) and `node.startBeat =
    0.4`, `stepIndex = Math.round(1.6) = 2`, `isOffbeat = false`. Same
    note quantised at `gridSize = 0.5` (1/8): `stepIndex =
    Math.round(0.8) = 1`, `isOffbeat = true`. The "is this an
    offbeat" decision is **unstable across grid sizes** and depends
    entirely on rounding direction, not on the note's natural place
    in the bar.

14. **`quantizeNoteLengths` floor is `gridSize`, not the previous
    duration.** `quantizeNoteLengths.ts:7`: `Math.max(gridSize,
    Math.round(node.duration / gridSize) * gridSize)`. A 1/64 note
    quantised to 1/4 grid becomes a quarter note. There is no
    `strength` parameter and the operation is silently destructive.
    The corresponding handler (`handleQuantizeNoteLengths`) drives
    this from a single AppAction with no warning.

15. **`splitMidiNotesAtBeat` (clip split) duplicates `probability`
    via `??`.** `splitMidiNotesAtBeat.ts:60-65`: `probability: note.probability ?? rightHalf.probability`.
    `rightHalf.probability` was set to 100 by `createMidiNote(..., 100)`
    default, but `note.probability` could be `undefined`, and the `??`
    falls through. For a note with `probability: 0`, the right half
    keeps `probability: 0` (correct because `0 ?? 100 === 0`). OK
    here; the more important bug is sibling: the `pressure`, `slide`,
    `pitchBend` of the original are copied unconditionally, but the
    `id` from `createMidiNote` is used so the right half gets a
    fresh id while the left half keeps the original — undo replays
    that delete the "split" note find only the left half. Asymmetric.

16. **`splitNoteAtBeat` (per-note split, transform layer)
    discards the original note's `id` for both halves.**
    `midiNoteTransforms/splitNoteAtBeat.ts:35-41`: the left half is
    `{ ...note, duration: leftDuration }` (keeps original id), the
    right half is freshly minted via `createMidiNote`. Mostly fine,
    but combined with #15 — the **clip-split** version
    (`midiNoteCrud/splitMidiNotesAtBeat.ts`) uses the same pattern.
    Either consistency.

17. **`retrogradeNotes` reverses startBeat positions but not their
    durations.** `retrogradeNotes.ts:24`: `startBeat: minStart +
    totalLength - (node.startBeat - minStart) - node.duration`. This
    flips note _onsets_ along the time axis, accounting for note
    duration so the right edge ends up at the original left edge — but
    note **durations** are unchanged. A passage of `quarter, eighth,
    eighth` retrograde becomes `eighth, eighth, quarter` _shifted_;
    the rhythm is reversed, but this only works if all notes are
    contiguous. With overlapping notes, the retrograde produces
    overlaps in different places — possibly desired, possibly not, but
    undocumented.

18. **`invertNotes` axis is `minPitch + maxPitch`, not the conventional
    `minPitch + maxPitch` / 2 doubled.** `invertNotes.ts:19`: `axis =
    minPitch + maxPitch`, then `pitch = axis - node.pitch`. A range
    `[60, 72]` gives axis `132`, mapped pitch `132 - 60 = 72` and
    `132 - 72 = 60`. Mathematically equivalent to inverting around
    `(min + max) / 2 = 66`. OK — but with a single note (`length < 2`
    guard at `:5`) it short-circuits, and with two notes at the same
    pitch the inversion is a no-op. Edge: if only `notes.length === 1`,
    the function should still allow inversion around a user-supplied
    axis. Otherwise the feature is "select 2+ notes only".

19. **`legatoNotes` "next note on any pitch in the selection"
    fallback is wrong when the selection contains multiple voices.**
    `legatoNotes.ts:42–52`: if no same-pitch successor exists, it
    extends to "the next selected note on any pitch". For a 4-voice
    chord progression, every voice extends to the next chord's onset
    — but the next chord has 4 different notes; legatoing voice 1 to
    voice 2's onset of a different chord is musically wrong. The
    fallback heuristic should be "next event in time" (any note,
    selected or not) and only use the same-pitch successor.

20. **`shiftMidiNotesAfterBeat` rebuilds a complete copy of the store
    on each call.** `shiftMidiNotesAfterBeat.ts:32-54`: three full
    `Object.entries` loops over every clip's events, even clips that
    have no events past `atBeat`. With many clips, this is O(N×M)
    per shift action and produces a full structural-equality miss
    for every subscriber. Coupled with #6, the operation is also
    semantically wrong on CC/pitch-bend if those carry timeline-
    absolute beats.

21. **`arpeggiator.arpeggiate` _replaces_ all notes in a clip with
    the arp pattern.** `arpeggiator.ts:104-110`: `notesByClipId[clipId]
    = newNotes`. The user expectation for "arpeggiate" in some DAWs
    is "generate an arp from the chord", but this destroys the source
    chord. If the user invokes arpeggiate again with different
    parameters, they cannot undo back to the original chord without
    `Command`'s undo stack. The use case has no opt-in `replace` flag.

22. **`arpeggiator` random pattern uses `Math.random`, no seed.**
    `arpeggiator.ts:64`: `Math.random()` shuffles the pattern. Undo
    redoes a different shuffle each time. The DAW pattern (e.g.
    `humanizeNotes`) uses `createSeededRandom` for exactly this
    reason; arpeggiator was missed.

23. **`stampChord` velocity range and probability default not
    clamped.** `stampChord.ts:30`: `createMidiNote(pitch, startBeat,
    duration, velocity)` — `velocity` is forwarded raw. If the caller
    passes 200, the model factory `createMidiNote` (`MidiNote.ts:32`)
    accepts the value without validation. The model factory's default
    velocity is 100; the parameter type is just `number`. There's no
    `Math.max(1, Math.min(127, …))` at the boundary.

24. **`createMidiNote` model factory does not clamp inputs.**
    `MidiNote.ts:28-43`: builds a note with whatever pitch / velocity
    / duration / probability the caller passed. Several callers
    clamp before calling it (`addMidiNote`, `batchAddMidiNotes`,
    `duplicateClipNotes`); `stampChord`, `splitMidiNotesAtBeat`
    (clip-level), `splitNoteAtBeat`, `propagateParentChanges`,
    `createPatternInstance` do not. The clamping is an
    accident-of-call-site, not a contract.

25. **Pattern instance `propagateParentChanges` regenerates child
    note ids on every parent edit.** `propagateParentChanges.ts:39-46`:
    every push generates fresh `note-inst-${randomUUID}` ids for the
    child clip. References to those ids held by undo stacks, the
    selection store, the piano-roll's per-id memos, etc. become stale
    immediately. Subsequent operations (e.g. "delete this note in the
    instance") fail because the noteId no longer exists.

26. **Pattern instance `createPatternInstance` fires
    `setNotesForClip` _then_ `appendClipToTrack`.**
    `createPatternInstance.ts:57-64`: notes are written to the MIDI
    store **before** the clip exists in `trackStore`. Any subscriber
    that reacts to MIDI store changes by looking up the clip in
    `trackStore` (e.g. the piano-roll, the timeline render model)
    sees a transient orphan. Two store writes, no transaction.

27. **`detachPatternInstance` discards `parentClipId` and `overrides`
    via destructuring, but doesn't notify `Arrangement` to cancel
    pending overrides.** `detachPatternInstance.ts:11`: `const {
    parentClipId: _parent, overrides: _overrides, ...rest } = clip`.
    Notes still under `notesByClipId[clipId]` are kept, which is
    correct — but if the parent updates after detach, the orphaned
    instance won't receive updates (correct), and any subscriber
    waiting on `parentClipId` to change observes one event with both
    fields gone simultaneously (fine; just verifying intent).

28. **`importMidiFile` worker spawns a new Worker per call.**
    `importMidiFile.ts:24-50`: `new Worker(new URL(...))` per file
    import. Spinning up a Worker is ~10ms each on most browsers; for
    bulk import (drag 50 .mid files) the cost is mostly the worker
    startup, not the parse. The file comment acknowledges this and
    waves it off; for the canonical case (one file) this is fine, but
    no `worker pool` exists.

29. **`midiImportWorker` returns notes with `Math.max(0.01, duration)`
    floor, no maximum.** `midiImportWorker.ts:174`: a note that is
    never released (no matching `noteOff`) is silently lost (it stays
    in `activeNotes`). A note where the `noteOff` is far in the
    future (e.g. 999 999 ticks because the file is malformed) will be
    accepted as a 999-beat note. No upper bound.

30. **Channel pressure (`0xD0`) and program change (`0xC0`) are read
    from the file but produce no events.** `midiImportWorker.ts:157-159`:
    `data2 = 0` for these messages, no `notes.push` ever happens for
    them. They are silently consumed. CC events (`0xB0`) are similarly
    not converted to `MidiCC` records; the import path strictly
    creates `ParsedNote[]`, then upstream `Arrangement/useCases/importMidiFile`
    presumably ignores the rest. The contract advertises "MIDI import"
    but only notes are imported.

31. **`writeVarLen` truncates large delta times silently.**
    `exportMidiFile.ts:8`: `value & 0x0fffffff` masks to 28 bits. SMF
    spec allows up to 0x0FFFFFFF (which matches), but anything beyond
    that is silently truncated rather than raising an error. Edge case
    but worth a `logger.warn`.

32. **`readVarLen` does not bound-check the worker reader.**
    `midiImportWorker.ts:57-65`: a malformed input that loops
    indefinitely (no high bit ever clears) reads past the buffer end.
    `DataView.getUint8` will throw `RangeError`, which the worker's
    `try/catch` at `:198` will turn into an `error` message — but the
    exception cost is high. Bound check `pos < buffer.byteLength`
    would catch it earlier with a meaningful message.

33. **No module root `index.ts`.** Other modules (`AudioAnalysis`,
    `Arrangement`, `Transport`) have one. `src/modules/MIDI/` does not.
    External consumers reach into `#/modules/MIDI/stores`,
    `#/modules/MIDI/useCases`, `#/modules/MIDI/presentations/views`
    individually. AGENTS.md "Barrel files" mandates a root `index.ts`
    as the **sole** cross-module public surface.

34. **`useCases/index.ts` exports types.**
    `useCases/index.ts:6` exports `type ArpPattern, ArpRate`;
    `:103` exports `type MidiLearnDependencies`. AGENTS.md "Use-case
    types stay private" forbids this. Cross-module callers
    (`Arrangement/handlers/clip/handleArpeggiate.ts:1`) import the
    types via this path.

35. **`stores/index.ts` exports types and state alike.**
    `stores/index.ts:5` re-exports `MidiMappingTargetType, MidiMapping,
    LearningTarget, MidiLearnState` and others. These are
    cross-module type leaks of internal store shapes — better than
    use-case types per AGENTS.md (stores _can_ export types via
    barrel), but the model isolation rule still applies: **other
    modules should not depend on the shape of MIDI store state.**

36. **`MidiNote` and `MidiCC` model imported directly across module
    boundaries.** `Arrangement/stores/__tests__/arrangementMiscStores.spec.ts:9`:
    `import type { MidiNote } from '#/modules/MIDI/models/MidiNote'`.
    AGENTS.md "Model isolation": **never** import models across
    module boundaries.

37. **Function signatures take positional parameters (AGENTS.md
    violation).**
    - `createMidiNote(pitch, startBeat, duration, velocity, probability)`
      (`createMidiNote.ts:8`, `models/MidiNote.ts:28`)
    - `addMidiNote(clipId, pitch, startBeat, duration, velocity)`
      (`midiNoteCrud/addMidiNote.ts:5`)
    - `batchAddMidiNotes(clipId, notes)` ←  acceptable (1 + array)
    - `addMidiCC(clipId, controller, value, beat, channel)`
      (`midiEvent/addMidiCC.ts:5`)
    - `addPitchBend(clipId, value, beat, channel)`
      (`midiEvent/addPitchBend.ts:5`)
    - `moveMidiCC(clipId, ccId, newBeat, newValue)`
      (`midiEvent/moveMidiCC.ts:3`)
    - `movePitchBend(clipId, pbId, newBeat, newValue)`
      (`midiEvent/movePitchBend.ts:7`)
    - `setNotePitchBend(clipId, noteId, pitchBend)` and siblings
      (`setNotePressure`, `setNoteSlide`)
    - `arpeggiate(clipId, pattern, rate, octaves, gatePercent)`
      (`arpeggiator.ts:7`)
    - `quantizeNotes(clipId, gridSize, strength, swing)`
      (`midiNoteTransforms/quantizeNotes.ts:3`)
    - `humanizeNotes(clipId, timingAmount, velocityAmount, seed)`
      (`midiNoteTransforms/humanizeNotes.ts:10`)
    - `scaleVelocities(clipId, curve, minVelocity, maxVelocity)`
      (`midiNoteTransforms/scaleVelocities.ts:48`)
    - `stampChord(clipId, rootPitch, startBeat, duration, velocity, chordType)`
      (`chordStamps/stampChord.ts:11`)
    - `transposeNoteToChord(pitch, fromRoot, fromQuality, toRoot, toQuality)`
      (`transformers/chordTransposer.ts:12`)
    - `transposeForChordTrack(pitch, referenceChord, targetChord)`
      (`transformers/chordTransposer.ts:48`)
    - `addChordEvent(beat, root, quality, duration)`
      (`chordTrack/addChordEvent.ts:5`)
    - `createPatternInstance(sourceClipId, targetTrackId, startBeat)`
      (`patternInstance/createPatternInstance.ts:11`)
    - `joinNotes(clipId, selectedIds)` — 2 params, technically
      AGENTS.md-borderline; same with `splitNoteAtBeat(clipId, ids,
      beat)` (3 params, unambiguously violates).

38. **`handleAddChordEvent` uses `as ChordType` assertion.**
    `handleAddChordEvent.ts:11`: `(alpha.payload.quality as ChordType)`
    after a `Set.has()` check. This is the kind of `as` cast AGENTS.md
    flags as "silencing the compiler" — the correct narrowing is
    `quality: payload.quality is ChordType`, or a typed lookup
    (`CHORD_TYPES[quality] ? quality : 'major'`). The `Set.has` only
    asserts membership at runtime; `as ChordType` then claims the
    type. There is at least a branch.

39. **`importHardwareMappings` cast chain to satisfy the type
    checker.** `useCases/hardware/portableMappings.ts:37–48`:
    `(entry as Record<string, unknown>).controlType as string`
    repeated for every field. AGENTS.md: "as`, `as any`, or `as
    unknown as …` to silence compiler errors instead of fixing the
    value or the type" — forbidden. Use Zod or a discriminated
    parser.

40. **`importHardwareMappings` swallows JSON errors with
    `console.error`.** `portableMappings.ts:54-56`: `catch (error) {
    console.error(...) }` — no notification, no return value, the
    user does not learn the import failed. Should surface via
    `notifyUser`.

41. **`controller-scripting.worker.ts` posts `console.log`.** Worker
    runs `console.log('Running controller script...')` (line 17) per
    invocation. Floods devtools when a hardware controller dispatches
    rapid script invocations.

42. **`MidiLearnButton` view violates AGENTS.md "do not render with
    `&&`".** `MidiLearnButton.tsx:76-77`: `isLearningThis && '...'`,
    `!isLearningThis && existingMapping && 'text-...'` — these are
    inside the `cn()` helper and resolve to truthy/falsy strings, so
    rendering-wise they're fine. But `MidiLearnButton.tsx:81`:
    `existingMapping && !isLearningThis ? existingMapping.cc : 'M'`
    is a ternary. The `cn()` cases are using `&&` as a guard for
    string concatenation, which is OK; the ternary is fine. **But**
    `RotaryKnob` and `Arrangement/presentations/views/MidiLearnButton`
    consume the same store and may render with `&&` directly — out
    of audit scope, just flagging.

43. **`MidiLearnButton` file is duplicated.** This file
    (`presentations/views/MidiLearnButton.tsx`) and
    `Arrangement/presentations/views/MidiLearnButton.tsx` (referenced
    in test paths above) both exist. One module owns the button; the
    other is a shadow copy that imports the same MIDI store. Pick one.

44. **`stores/midiStore` has no per-clip pruning.** When a clip is
    deleted from `trackStore`, its entry in `notesByClipId`,
    `ccByClipId`, `pitchBendByClipId` is **not** removed by any
    code in this module. `Arrangement/handlers/clip/handleRemoveClip.ts`
    is the only code that touches `midiStore` from outside (per the
    grep), and it imports `midiStore` directly to clean up — the
    cleanup is _not_ a MIDI use case but an Arrangement concern. The
    MIDI module exposes no `removeClipMidiData(clipId)` to make this
    contract visible.

45. **`duplicateClipNotes` is a store-level helper exported via
    `stores/index.ts`.** `stores/duplicateClipNotes.ts` is
    architecturally a use case (read state, write state) that should
    live in `useCases/midiNoteCrud/`. Its placement under `stores/`
    is wrong; it confuses the "stores re-export the data, not the
    operations" rule.

46. **`migrateAbsoluteMidiNotes` heuristic uses a regex on clip
    name.** `migrateAbsoluteMidiNotes.ts:32`: `/melody|chords|drums|copy/i`.
    A user-imported clip named "Melody Drums Copy" is misidentified;
    a hand-drawn clip named "drums" is migrated even though it was
    always relative. This migration runs every time the store is
    re-hydrated (no version flag), so a user who imports a clip named
    "drums" between sessions will see their notes shifted by
    `clip.startBeat` on every reload until the start beat reaches 0.

47. **`createMidiNote` ID collision risk via `randomUUID().slice(0, 8)`.**
    `models/MidiNote.ts:36, 47, 58`: 8 hex chars = 32 bits =
    ~4.29 × 10⁹ space. Birthday collision at √4.29B ≈ 65 535 — a
    project with 100k notes (drum machines, generative content) has
    a ~50% chance of two ids colliding. The same `slice(0, 8)`
    pattern appears in `chordTrackStore`, `propagateParentChanges`,
    `createPatternInstance`. **Note ids are used in `Set<string>`
    selection state, undo references, MIDI Learn mappings, etc.;
    a collision is silent corruption.**

48. **`addMidiNote` and `batchAddMidiNotes` differ on
    "store missing → throw vs return".** `addMidiNote.ts:14` throws
    `MidiError('MIDI store not initialized')`; `setNotesForClip.ts:7`
    silently returns; `getNotesForClip.ts:7` returns `[]`;
    `arpeggiator.ts:14` returns; `stampChord.ts:21` returns `[]`.
    Pick one contract.

49. **`updateNotesForClip` early-exits on missing clip key.**
    `updateNotesForClip.ts:18-20`: `if (!existing) return;`. This
    silently no-ops a transform on a clip that has not yet had any
    notes — which is _correct_ for transforms (no-op on empty), but
    the call site
    (`splitNoteAtBeat`, `quantizeNotes`, etc.) cannot tell the
    difference between "no notes" and "store missing". Tests asserting
    "transform was applied" can pass on the missing-store path.

50. **`stepRecordStore.set(null)` violates the store's typed contract
    where appropriate.** The `createStore<T>` signature accepts `T |
    null`, but most other stores avoid setting null explicitly —
    they reset to `defaultStepRecordState`. The `null` toggle here
    creates a special case for every consumer.

51. **`completeMidiLearn` `VALUE_RANGES` magic constants.**
    `completeMidiLearn.ts:6-11`: `trackPan` range is `[-50, 50]` —
    the convention elsewhere in the project is **either** -1..1
    **or** -100..100. `[-50, 50]` is a third convention. `trackGain`
    is `[0, 1]` (linear, not dB). `deviceParam`/`fermenterGlobalParam`
    are `[0, 1]` regardless of the device's actual parameter range.
    The inferred "scaled" value is then dispatched to
    `setTrackGainArrangement` _and_ `engineSetTrackGain` (no
    dB→linear or normalised-to-real conversion).

52. **`handleMidiMessage.scaleMidiValue` is a 7-bit linear map only.**
    `handleMidiMessage.ts:5–7`: `min + (raw / 127) * (max - min)`. No
    14-bit MSB+LSB CC support, no exponential mode for `trackGain`
    (which is conventionally logarithmic in dB). A user mapping a
    fader to track gain gets a linear-volt response on a logarithmic
    perception axis.

53. **`getChordAtBeat` linear scan, no binary search.**
    `getChordAtBeat.ts:12`: iterates from end to start, returning the
    last event whose range covers `beat`. With many chord events and
    a per-frame call (e.g. from a per-frame transposer), this is O(N)
    per call. Sorted invariant exists (events array is sorted in
    `addChordEvent` and `moveChordEvent`); a binary search is ~free.

54. **`chordTrackStore.subscribe(() => ...)` `JSON.stringify` per
    keystroke.** Every chord-track edit serialises the full state.
    For a 2k-event chord track, that's ~50–100KB JSON every drag tick.

55. **`humanizeNotes` returns the seed but the handler discards it.**
    `humanizeNotes.ts:23` returns `usedSeed`. `handleHumanizeNotes.ts:7`:
    `humanizeNotes(action.payload.clipId, action.payload.amount)` —
    seed is never read, never stored. So undo→redo of humanize
    produces a different result every time, defeating the entire
    purpose of the seed parameter.

56. **`handleHumanizeNotes` does not forward `velocityAmount`.**
    `handleHumanizeNotes.ts:7`: passes only `amount` (timing). The
    use case accepts `velocityAmount` and `seed`. The action contract
    silently coalesces `vAmount = timingAmount` (humanize.ts:11). Same
    pattern as `AudioAnalysis` audit issue #3 — handler drops payload
    fields.

57. **`compareToReference` analogue in MIDI: `transposeForChordTrack`
    re-exporting transformers.** `useCases/transposeForChordTrack.ts`
    is a one-line re-export of `transformers/chordTransposer.ts`'s
    `transposeForChordTrack`. Indirection layer with no value
    (similar pattern to `AudioAnalysis/useCases/audioAi/*`).
    `formatChordName` and `createMidiNote` are similar pass-throughs
    of `models/`.

58. **`handleCreatePatternInstance` and `handleDetachPatternInstance`
    are async but execute sync.** `handlers/patternInstance/handleCreatePatternInstance.ts:7`
    and `handleDetachPatternInstance.ts:7` are
    `async (alpha) => { sync_call(); }` with an `eslint-disable
    @typescript-eslint/require-await` justifying the false async.
    Pollutes call sites with `await`. Same anti-pattern as
    `AudioAnalysis` audit issue #15.

59. **No tests for the MIDI import/export round-trip.**
    The audit grepped the test directory; no `__tests__` exists for
    `importMidiFile.spec.ts` against `exportMidiFile.spec.ts` as a
    round-trip. Two separate specs exist
    (`__tests__/exportMidiFile.spec.ts`,
    `__tests__/importMidiFile.spec.ts`) but they don't compose. Round-
    trip is the safest test for note-pairing / channel / running-
    status / variable-length encoding correctness.

60. **`stepRecordStepUp` / `stepRecordStepDown` ignore octave shifts
    at scale boundaries.** `stepRecording/stepRecordNavigation.ts:54-56`:
    `octShift = nextDegree === 0 ? 12 : 0` — when wrapping from B
    back to C, jump up an octave. Step-down at `:88-89`:
    `nextDegree === pattern.length - 1 ? -12 : 0` — when wrapping
    down, jump down an octave. Inconsistent with the up direction:
    in both cases `nextDegree` is computed from current; the up and
    down logic can produce monotonic sequences only if the pitch is
    a scale degree to begin with. If `currentPitch` is _not_ in the
    scale (chromatic note in a diatonic key), the "force to nearest
    scale degree" fallback `pattern.findIndex(n => n > currentPc)`
    skips the held pitch, then up/down advance from a different
    starting point than the one displayed. UX surprise.

61. **`stampChord.helpers.ts` is a duplicate of `models/ChordTypes.ts`.**
    `useCases/chordStamps/helpers.ts:1-22` defines `CHORD_TYPES`
    identically to `models/ChordTypes.ts:6-24`. Two sources of truth
    for chord definitions. `models/ChordEvent.ts:1` imports
    `ChordType` from `useCases/chordStamps/helpers.ts` — model
    importing from a use case, **the wrong direction**. The
    use-case should depend on the model.

62. **`CHORD_TYPE_KEYS.ts` is a one-line re-export.**
    `useCases/chordStamps/CHORD_TYPE_KEYS.ts:5`: `export const
    CHORD_TYPE_KEYS = Object.keys(CHORD_TYPES) as ChordType[]`. Same
    constant defined in `models/ChordTypes.ts:28`. Dead duplication.

63. **`groove`, `strum`, `arpeggiator`, `quantize`, `humanize`, `legato`,
    `join`, `split` all return `void`/`Map`/no-undo metadata, while
    `humanizeNotes` returns the seed.** Inconsistent. `applyGrooveToClip`
    returns a `Map<string, {...}>` for undo. `strumNotes` returns a
    `Map<string, number>`. Others return `void`. The undo subsystem
    presumably handles the rest via store snapshots, but the API is
    not uniform.

---

## Priorities

> **Note (2026-04-28):** Findings vs Open issues numbering diverges.
> The numbers in this Priorities list reference **Open issues**
> 1–50, not the Findings list. Updated after the adversarial review.

1. **CC/note coordinate-frame contradiction (Open issue #16)** —
   notes are clip-relative (post-migration); the
   `shiftMidiNotesAfterBeat` docstring claims everything is
   absolute. Either notes are wrong or the function is wrong; either
   way, arrangement-level shifts silently corrupt MIDI data. Triage
   as **Critical** before any other fix.
2. **MIDI import data loss (#1, #2)** — CCs, pitch-bend, channel,
   poly pressure, program change all silently dropped on import. Any
   non-trivial file is degraded.
3. **MIDI export channel pinned to 0 (#4)** — multi-channel
   round-trip is impossible; CC channel _is_ written, but note
   channel is not. Asymmetric I/O.
4. **Note id collision (#6)** — 32-bit truncated UUIDs collide at
   ~65k notes; silent corruption in selection, undo, MIDI Learn,
   pattern-instance propagation.
5. **`moveMidiNote` and `resizeMidiNote` skip clamping (#38)** — the
   CRUD layer doesn't enforce `MidiNote` invariants; combined with
   the transforms (#12), there is no chokepoint at all.
6. **`setNoteVelocity` allows velocity 0 (#34)** — silent corruption
   because vel-0 noteOn ≡ noteOff in MIDI wire spec. Inconsistent
   with every other velocity site in the module.
7. **`duplicateClipNotes` drops expression data (#35)** — duplicating
   a clip with MPE expression silently deletes per-note pitch-bend,
   pressure, slide, probability.
8. **`humanizeNotes` seed dropped at handler (#7, #49)** — undo/redo
   produces non-deterministic output despite the function returning
   a seed. The action contract is missing two payload fields.
9. **Stuck-note risk in step recording (#5)** — missing note-off
   keeps a pitch wedged; the cursor never advances. Toggle-off
   recovers (because state is nulled, see #36) but during active
   recording there's no escape.
10. **Pattern-instance id regeneration on every parent edit (#9)** —
    every push generates fresh child ids; selection state, undo,
    MIDI Learn references all break silently.
11. **Pattern-instance write-then-append race (#40)** — orphan notes
    written before the clip exists in `trackStore`; if the
    target-track check fails, notes leak forever.
12. **`migrateAbsoluteMidiNotes` regex heuristic with no schema
    version (#8, #39)** — migration trigger is fragile; CC/pitch-bend
    not migrated.
13. **MIDI Learn fan-out and value-range chaos (#10)** — duplicate
    mappings fire all targets; trackPan uses a third convention
    (`[-50, 50]`); trackGain is linear, not log-dB.
14. **Quantization swing instability (#11)** — "is offbeat" depends
    on rounding direction; same note swings differently at different
    grid sizes.
15. **`startBeat < 0` not consistently clamped (#12)** — humanize,
    quantize, retrograde can drift notes off the timeline. Combined
    with #38, no chokepoint exists.
16. **`quantizeNoteLengths` silently elongates short notes (#19)** —
    a 1/64 note at 1/4 grid becomes a quarter note. Destructive,
    no warning, no strength.
17. **`stampChord` skips out-of-range tones silently (#21)** — high
    root + 9th chord = single-note "chord". User confusion.
18. **`controller-scripting.worker.ts` runs unsandboxed user code
    (#17)** — fine for personal use; high-severity if scripts are
    ever shared.
19. **`addPitchBend` / `addMidiCC` accept unbounded inputs (#37)** —
    out-of-range values reach the store; export then truncates,
    wrapping around bit-stuck.
20. **Architecture pass (#18, #23, #24, #25, #28, #50)** — no module
    root `index.ts`; type leakage; positional parameters; `as`
    casts; misplaced use cases under `stores/`; inconsistent worker
    naming.
21. **Round-trip test missing (#29)** — single test catches #1, #2,
    #3, #4 simultaneously. Land first.
22. **`addPitchBend` / `addMidiCC` duplicate events (#22, #37)** —
    no de-duplication on `(beat, channel, controller)`; rapid
    hardware sweeps explode the store.
23. **Note-on/off ordering at zero-tick adjacency (#3)** — stable
    sort + insertion order; tied boundaries non-deterministic.
24. **Chord-track localStorage synchronous, non-CRDT (#13, #45)** —
    blocks main thread on every drag; not part of project document;
    module-init side effect.
25. **Lower-priority issues (#14, #15, #20, #26, #27, #30, #31, #32,
    #33, #41–48, #50)** — see issue text for severity.

---

## Open issues

> **Adversarial review pass — 2026-04-28.** Each numbered issue below has been
> re-verified at cited file:line. Verification notes appear under
> `**Verified:**` for each issue. New issues (#33+) are appended at the end of
> this section.

### 1. MIDI import drops everything except notes

**Problem:** `workers/midiImportWorker.ts` parses only `noteOn`/
`noteOff`. Sysex is skipped, controller (`0xB0`), program change
(`0xC0`), channel pressure (`0xD0`), poly pressure (`0xA0`), and
pitch-bend (`0xE0`) events are read but never converted. The
handler-level "MIDI import" feature looks complete to the user; the
imported file is missing every controller event.

**Representative files:**

- `src/modules/MIDI/workers/midiImportWorker.ts:144-179`
- `src/modules/MIDI/useCases/importMidiFile.ts:11-12` (response
  contract has no CC / pb fields)

**Needed:** Extend the worker response with `cc`, `pitchBend`,
`programChange`, `channelPressure`, `polyPressure`. Parse all status
bytes the spec defines. Update `importMidiFile`'s caller path
(Arrangement) to push CC into `ccByClipId` and pitch-bend into
`pitchBendByClipId`. Add a round-trip test (export a fixture, import
it back, assert CC/pb events match).

**Verified (2026-04-28):** `midiImportWorker.ts:155-179` — the worker
reads `data1` and `data2` for every status byte, but only
`eventType === 0x90` (with `data2 > 0`) and `eventType === 0x80` (or
`0x90` with vel 0) emit notes. CC (`0xB0`), pitch-bend (`0xE0`), poly
pressure (`0xA0`), program change (`0xC0`), channel pressure (`0xD0`)
bytes are consumed but never converted. Severity: **High** — the
export side _does_ write CC bytes (`exportMidiFile.ts:57-62`), so
round-trip is guaranteed-asymmetric: a user opens a file, sees their
CCs missing, drags the clip back to disk, the .mid still has no CCs.
The asymmetry makes this worse than mere "missing feature".

### 2. Same-pitch overlapping notes are lost on import

**Problem:** `activeNotes: Map<number, …>` keyed by pitch
short-circuits when a second `noteOn` arrives for an already-active
pitch. The first start tick is overwritten; the next `noteOff` closes
the second note; the first note is silently lost. Common in MPE,
sustained pad parts, and any file that re-attacks a pitch before
release.

**Representative files:**

- `src/modules/MIDI/workers/midiImportWorker.ts:111,163-178`

**Needed:** Use `Map<number, { tick: number; velocity: number }[]>`
(stack of active notes per pitch). On `noteOff`, pop the **oldest**
(LIFO is incorrect for SMF; FIFO matches typical hardware behaviour
where `noteOn(60)`-`noteOn(60)`-`noteOff(60)`-`noteOff(60)` releases
the first attack first).

**Verified (2026-04-28):** `midiImportWorker.ts:111` —
`activeNotes = new Map<number, { tick: number; velocity: number }>()`
keyed by pitch. Line 164: `activeNotes.set(data1, …)` overwrites any
existing entry without preserving the prior start tick. There is no
"already active?" branch and no queue. Severity: **High**. Edge case
worth noting: if a noteOn comes in for an already-active pitch and
the new vel is **0** (i.e. some MIDI dialects use vel-0 noteOn as
noteOff), the import path falls into the `eventType === 0x90 &&
data2 === 0` branch at line 165 and closes the prior note correctly.
But two real `noteOn` events with non-zero velocity still drop one.

### 3. Note-on/note-off ordering at zero-tick adjacency

**Problem:** `exportMidiFile.buildTrackEvents.events.sort((a, b) =>
a.tick - b.tick)` is a stable sort but the input order at equal
ticks is the insertion order of the `notesByClipId[clipId]` array.
At a tied note-off → note-on boundary (note B starts at the same tick
note A ends), conformant SMF practice is _note-off first_ so the
synth voice releases before the next allocation.

**Representative files:**

- `src/modules/MIDI/useCases/exportMidiFile.ts:64`

**Needed:** Pre-tag each event with a tie-breaker (`0` for note-off,
`1` for CC, `2` for note-on, `3` for everything else) and sort by
`(tick, kind)`. Add a test with two adjacent same-pitch notes that
asserts the export ordering.

**Verified (2026-04-28):** `exportMidiFile.ts:64` —
`events.sort((alpha, b) => alpha.tick - b.tick)`. Confirmed: pure
tick-only sort. Notably, `Array.prototype.sort` in V8/SpiderMonkey is
**stable** since ES2019, so insertion order is preserved at equal
ticks. But insertion order in `buildTrackEvents` is "all noteOn
events for a note before its noteOff" (lines 53-54 push start then
end, but if A.endTick === B.startTick, the iteration order in
`for (const note of notes)` produces noteOn(A), noteOff(A), noteOn(B),
noteOff(B) sequentially — so the noteOn(A) at tick 0 comes before
noteOff(A) at tick T (good), but noteOff(A) at T comes before
noteOn(B) at T because A is iterated first. This is **lucky** for the
common case (A→B sequential) but breaks if note B is _earlier_ in the
notes array than A, where the same notes produce noteOn(B), noteOff(B),
noteOn(A), noteOff(A) — and at tick T, noteOn(B) precedes noteOff(A).
Confirmed undefined behaviour. Severity: **Medium** (intermittent on
real files, dependent on store insertion order which is not
guaranteed across CRDT replays — see #5/#22). Add the kind-based tie
break.

### 4. `MidiNote` has no channel; export is pinned to 0

**Problem:** The model carries no `channel`. On import the channel is
read from the status byte (`statusByte & 0x0f`) but discarded
(`midiImportWorker.ts:155, 163`). On export the status bytes are
hard-coded `0x90` / `0x80` (`exportMidiFile.ts:53-54`). Multi-channel
files cannot round-trip. Every imported note is on channel 1 (zero-
indexed).

**Representative files:**

- `src/modules/MIDI/models/MidiNote.ts:1-11`
- `src/modules/MIDI/workers/midiImportWorker.ts:155-163`
- `src/modules/MIDI/useCases/exportMidiFile.ts:53-54`

**Needed:** Add `channel: number` to `MidiNote` (default 0). Forward
in import, OR `0x0f` into status bytes on export. Migrate existing
project state (assume channel 0). Coordinate with the audio engine
which currently routes _all_ MIDI to a single channel per device.

**Verified (2026-04-28):** `models/MidiNote.ts:1-11` confirms no
`channel` field on `MidiNote`. `exportMidiFile.ts:53-54` writes
`{ data: [0x90, pitch, vel] }` and `{ data: [0x80, pitch, 0] }` —
status bytes pinned. CC export at `exportMidiFile.ts:61` _does_ OR
the channel into the status byte (`0xb0 | ((cc.channel ?? 0) & 0x0f)`),
demonstrating awareness of channel, but notes are inconsistent.
Severity: **High**. Note: `MidiCC` and `MidiPitchBend` in
`models/MidiNote.ts:13-26` _do_ carry `channel: number`, so the model
inconsistency is internal too — three event types in the same file
have heterogenous channel handling.

### 5. Stuck-note hazard in step recording

**Problem:** A missing `noteOff` (device drops a packet, or the user
toggles step-rec while a note is held) leaves the pitch in
`activeNotes` indefinitely. The cursor never advances because
`nextActive.size === 0` is never true. There is no janitorial
timeout, no panic-clear key, no "release all on toggle".

**Representative files:**

- `src/modules/MIDI/useCases/stepRecording/stepRecordNoteOff.ts:5,14`
- `src/modules/MIDI/useCases/stepRecording/toggleStepRecording.ts:24`

**Needed:** On toggle-off (and on session start/end), clear
`activeNotes`. Add a 5-second watchdog that releases any pitch held
longer than the threshold. Surface "all notes off" as a step-rec
action.

**Verified (2026-04-28):** `stepRecordNoteOff.ts:14` —
`if (state.advanceOnNoteOff && nextActive.size === 0 && state.activeNotes.size > 0)`.
Trace: A pressed (size=1), B pressed (size=2). B-off arrives:
`nextActive = {A}` (size 1), guard fails, cursor doesn't advance.
A's noteOff is dropped (device disconnect, packet loss): A stays in
`activeNotes` forever. `toggleStepRecording.ts:24` calls
`stepRecordStore.set(null)` — this _does_ wipe `activeNotes` because
the entire state is null. So toggle-off recovers, but a stuck note
during an active session still freezes the cursor. **The audit is
correct, with one nuance: toggle-off does clear the set (because the
state is nulled), so the recovery path is "toggle off, toggle on" —
but during active recording the user has no way out without
toggling.** Severity: **High** for live recording UX. Worse:
`toggleStepRecording.ts:24` setting `null` triggers the type
inconsistency — see new issue #36 below.

### 6. Note id collision via 32-bit UUID slice

**Problem:** `crypto.randomUUID().slice(0, 8)` truncates to 32 bits.
At ~65 535 unique notes per project, the birthday-paradox collision
probability passes 50%. Collisions silently corrupt selection, undo,
MIDI Learn id-keyed lookups, per-id React memos.

**Representative files:**

- `src/modules/MIDI/models/MidiNote.ts:36,47,58`
- `src/modules/MIDI/models/ChordEvent.ts:21`
- `src/modules/MIDI/useCases/patternInstance/createPatternInstance.ts:54`
- `src/modules/MIDI/useCases/patternInstance/propagateParentChanges.ts:43`

**Needed:** Use the full UUID, or a monotonic counter scoped to the
project (`midiStore.nextNoteId++`). Migrate existing projects via a
versioned migration (already a pattern in the module).

**Verified (2026-04-28):** `models/MidiNote.ts:36, 47, 58` — all three
factories (`createMidiNote`, `createMidiCC`, `createMidiPitchBend`)
truncate via `crypto.randomUUID().slice(0, 8)`. 8 hex chars = 32 bits.
Birthday-paradox 50% collision at √(2³²) ≈ 65 536. Sites confirmed:
`patternInstance/createPatternInstance.ts:54` (`note-inst-…slice(0, 8)`),
`patternInstance/propagateParentChanges.ts:43` (same), `arpeggiator.ts:95`
(`arp-${clipId}-${stepIndex}` — actually deterministic and **bug-free**
on collisions but introduces a different problem: arpeggiate twice on
the same clip at the same step produces _the same id_, breaking
selection state). `chordTrackStore`/`addChordEvent` also use slice(0, 8)
(`models/ChordEvent.ts:21`). Severity: **High** for projects with >10k
notes; **Critical** for generative content. The migration is
straightforward (extend on first read).

### 7. `humanizeNotes` seed dropped at the handler

**Problem:** `humanizeNotes` accepts `seed?` and **returns the seed
used** so the caller can store it for replay (per the function's own
docstring). `handleHumanizeNotes` discards the return value and
forwards no `velocityAmount` or `seed`. Undo→redo of humanize
produces a fresh shuffle; the seed parameter is dead at the action
contract.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes.ts:10-23`
- `src/modules/MIDI/handlers/noteTransform/handleHumanizeNotes.ts:7`

**Needed:** (a) Plumb `seed` and `velocityAmount` through the
`AppAction` payload. (b) Store the returned seed so undo replays
deterministically. (c) Add a test that asserts redo produces the same
note positions as the first execute.

**Verified (2026-04-28):** `humanizeNotes.ts:10-23` returns `usedSeed`.
`handleHumanizeNotes.ts:7`:
`humanizeNotes(action.payload.clipId, action.payload.amount)`.
Confirmed: only `clipId` and `amount` (treated as both timing and
velocity). The returned seed is dropped on the floor; the
`velocityAmount` parameter is silently aliased to `timingAmount` via
`vAmount = velocityAmount ?? timingAmount` at line 11. Both undo and
redo will call `humanizeNotes` with no seed → fresh `generateSeed()`
each time → different output every replay. Severity: **High** —
violates undo determinism, which is a core invariant. Worse, the
function's docstring claims "Returns the seed used, so callers can
store it for replay" but no caller stores it.

### 8. `migrateAbsoluteMidiNotes` runs on every load with no version flag

**Problem:** The migration heuristic `/melody|chords|drums|copy/i`
matches user-imported clip names. There is no `migration_version`
field on `midiStore.value`, so the migration runs **on every store
hydration**. A clip named "Drums Copy" is migrated repeatedly until
its `startBeat` reaches 0.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteCrud/migrateAbsoluteMidiNotes.ts:10-50`

**Needed:** Add a `schemaVersion` field to `MidiStoreState`. Run the
migration once when `schemaVersion < 1`, then bump to 1. Drop the
clip-name regex; the version flag is the trigger.

**Verified (2026-04-28):** `migrateAbsoluteMidiNotes.ts:32` —
`/melody|chords|drums|copy/i`. `MidiStoreState` (`stores/midiStore.ts:8-12`)
has no `schemaVersion`. The migration's idempotency check is
`clip.startBeat === 0` (line 22 — skips clips at beat 0) AND
`minStart >= clip.startBeat` (line 34 — only migrates if all notes
are after the clip start). After one migration, `minStart` is reduced
by `clip.startBeat`, and on the next load `minStart < clip.startBeat`
(unless `clip.startBeat` itself changed), so subsequent migrations
typically no-op for that clip. **Re-evaluating audit's claim:** "A
clip named 'Drums Copy' is migrated repeatedly until its `startBeat`
reaches 0" — this is **wrong**. After migration, `clip.startBeat`
stays the same; `minStart` is now < `clip.startBeat`, so the next run
skips. The bug is **a clip importing fresh between sessions**:
import a "drums" clip with notes at absolute coords, the migration
fires; export the project; reload from CRDT in another tab where the
migration runs first, then notes get shifted twice if the import path
runs after. Severity: **Medium** — the trigger condition is narrower
than the audit claims, but a `schemaVersion` flag is still the right
fix. Update the audit text.

### 9. Pattern-instance child note ids regenerate on every parent edit

**Problem:** `propagateParentChanges` always assigns fresh UUIDs to
the child clip's notes. Any handle held by selection state, undo
stacks, MIDI Learn, or per-id memos becomes stale on the next parent
edit.

**Representative files:**

- `src/modules/MIDI/useCases/patternInstance/propagateParentChanges.ts:39-46`

**Needed:** Compute a stable child id from `parentNoteId + childClipId`
(e.g. `note-${parentNoteId}-${childClipId.slice(0, 8)}`). Reuse
existing child note ids when they map to the same parent note.
Diff parent → child so notes deleted upstream stop emitting child
notes.

**Verified (2026-04-28):** `propagateParentChanges.ts:39-46` —
`id: \`note-inst-${crypto.randomUUID().slice(0, 8)}\``. Confirmed:
ids are minted fresh on every push. Bonus: this also _doubles down_ on
issue #6 — child clips get their own slice(0,8) ids, narrowing the
collision space _within a single parent edit_. Severity: **High**.

### 10. MIDI Learn `(channel, cc)` collision and value-range chaos

**Problem:** `completeMidiLearn` searches by `(channel, cc)` and
overwrites only one matching mapping. If the user already has _two_
targets bound to that CC, only one is replaced — the other still
fires alongside the new binding. `VALUE_RANGES` uses three different
conventions:
`trackGain` `[0, 1]` (linear), `trackPan` `[-50, 50]` (third
convention vs the rest of the codebase), `deviceParam` and
`fermenterGlobalParam` `[0, 1]` regardless of the device's actual
parameter range. `scaleMidiValue` is linear-only; gain is conventionally
log-dB.

**Representative files:**

- `src/modules/MIDI/useCases/midiLearn/completeMidiLearn.ts:6-55`
- `src/modules/MIDI/useCases/midiLearn/handleMidiMessage.ts:5-23`

**Needed:** (a) Fail learn-completion with a notification if more
than one mapping for `(channel, cc)` exists. (b) Standardise pan to
the codebase convention. (c) Add a `scale: 'linear' | 'log' |
'exp'` field to `MidiMapping`; default `trackGain` to `'log'`. (d)
Pull `min`/`max` from the actual device parameter contract for
`deviceParam`.

**Verified (2026-04-28):** `completeMidiLearn.ts:6-11` —
`VALUE_RANGES` confirmed: `trackGain { 0, 1 }`, `trackPan { -50, 50 }`,
`deviceParam { 0, 1 }`, `fermenterGlobalParam { 0, 1 }`.
`completeMidiLearn.ts:24-45` finds **first** matching `(channel, cc)`
via `findIndex`, replaces it. If two pre-existing entries share the
same `(channel, cc)`, the second one survives intact alongside the
new mapping. `handleMidiMessage.ts:5-7` is `min + (raw / 127) * (max
- min)` — pure linear, no log/exp option, no 14-bit (MSB+LSB) CC
support. Severity: **High** for trackGain (audible quality issue —
linear gain feels jumpy at the bottom of the fader); **Medium** for
the rest.

### 11. Quantization swing depends on grid-size rounding

**Problem:** `stepIndex = Math.round(node.startBeat / gridSize)` then
`isOffbeat = stepIndex % 2 !== 0`. The `Math.round` direction depends
entirely on the note's distance to the nearest grid line — at
`gridSize = 0.25`, a note at 0.4 has `stepIndex = 2` (even = on-beat);
at `gridSize = 0.5`, the same note has `stepIndex = 1` (odd = offbeat).
Same note, different swing direction.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/quantizeNotes.ts:6-13`

**Needed:** Define "offbeat" relative to the **bar / beat structure**,
not relative to the rounding direction. For a 4/4 bar at `gridSize =
0.25`, beats 1.5, 2.5, 3.5, 4.5 (8th-note offbeats) are the swing
targets. The grid index modulo `(beatsPerBar / gridSize / 2)` is the
correct test. Add a test that asserts the same note swings
identically at multiple grid sizes when its position is on the
shared subdivision.

**Verified (2026-04-28):** `quantizeNotes.ts:6-13` — confirmed
`stepIndex = Math.round(node.startBeat / gridSize); isOffbeat =
stepIndex % 2 !== 0`. The `% 2` decision is "is the nearest grid line
odd-indexed" — not "is the note on a musical offbeat". Cross-grid
reproduction: `gridSize=0.25, startBeat=0.4` → `round(1.6)=2` → even
(on-beat). `gridSize=0.5, startBeat=0.4` → `round(0.8)=1` → odd
(offbeat). Same note, different swing direction. Severity: **High**
for any feature that quantizes _then_ re-quantizes. Worse:
`stepIndex` is computed before strength is applied, so even at
`strength=0` the swing offset is added in full
(`newStartBeat = node.startBeat + (targetStartBeat - node.startBeat)
* strength`) — wait, swing IS applied at full strength because it's
inside `targetStartBeat`. So `strength=0` sets `newStartBeat =
node.startBeat`, OK. But `strength=0.5` adds half the swing too.
Strength interpolation is correct.

### 12. `startBeat < 0` is not clamped consistently

**Problem:** Several transforms permit notes to drift to negative
`startBeat`:
- `humanizeNotes` (random offset, no floor)
- `quantizeNotes` with `swing < 0` and notes near beat 0
- `retrogradeNotes` if any note's duration exceeds the clip span
- `legatoNotes` and `joinNotes` are safe (durations only).
A note at negative `startBeat` is invisible in the piano roll and
unplayable (the playhead never reaches it).

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes.ts:18`
- `src/modules/MIDI/useCases/midiNoteTransforms/quantizeNotes.ts:14-16`
- `src/modules/MIDI/useCases/midiNoteTransforms/retrogradeNotes.ts:24`

**Needed:** Add `Math.max(0, …)` to every transform that touches
`startBeat`. Better: a single `clampNote(note, clipDuration)` helper
that runs at the end of every transform and asserts `0 <= startBeat`,
`0.0625 <= duration`, `0 <= pitch <= 127`, `1 <= velocity <= 127`,
optional fields in their own ranges.

**Verified (2026-04-28):** Confirmed in:
- `humanizeNotes.ts:18` — no `Math.max(0, …)`.
- `quantizeNotes.ts:13-16` — `targetStartBeat = stepIndex * gridSize
  + swingOffset` can be negative if `stepIndex` is 0 and swing is
  irrelevant; but with notes near beat 0 and negative swing values
  (the function accepts swing < 0 implicitly), result is negative.
- `retrogradeNotes.ts:24` — `startBeat: minStart + totalLength -
  (node.startBeat - minStart) - node.duration`. If a note's `duration
  > totalLength` (a single long-tail note), result is negative.
- `moveMidiNote.ts:5` — **NEW**: no clamp at all on either pitch or
  startBeat; the caller is trusted. The piano roll's drag handler
  could send pitch=-3 or startBeat=-2 and `moveMidiNote` writes them
  unchanged. See new issue #38 below.
- `resizeMidiNote.ts:9-12` — clamps `duration` to `>= 0.0625`, but
  does **not** clamp `startBeat >= 0`. New finding (#38).
- `splitMidiNotesAtBeat.ts` — never moves startBeat below the
  original; safe.
- `legatoNotes`/`joinNotes` — safe (durations only).
Severity: **Medium** module-wide — silent invariant violation.

### 13. Chord-track `localStorage` persistence is synchronous and non-CRDT

**Problem:** `chordTrackStore.subscribe(() =>
localStorage.setItem(JSON.stringify(state)))` runs on every drag tick.
`JSON.stringify` is synchronous; `localStorage.setItem` blocks the
main thread; there is no cross-tab sync; the chord track is **not**
part of the project document, so saving the project to a file
omits the chord track.

**Representative files:**

- `src/modules/MIDI/stores/chordTrackStore.ts:24-34`

**Needed:** Either (a) use `createAutomergeStorage` like `midiStore`,
or (b) leave it in the project state directly (chord-track is
project-scoped data, not user-preferences). Throttle/debounce if
localStorage is the right answer.

**Verified (2026-04-28):** `chordTrackStore.ts:24-34` — confirmed.
`loadFromStorage` runs at module-evaluate time (line 25), populating
the store synchronously before any other code runs. The subscriber
at lines 29-34 fires on every mutation, blocking on
`JSON.stringify(state)` and `localStorage.setItem`. No throttle, no
debounce, no cross-tab sync (no `storage` event listener). Worse:
because the load is at module-init, late-initialized AppLogger is
unavailable (the catch silently swallows errors). Severity: **High**
— in a real session, every chord drag is one main-thread block.

### 14. `arpeggiate` destroys source notes; uses `Math.random` (no seed)

**Problem:** `arpeggiate` overwrites `notesByClipId[clipId]` with
the generated arp pattern. The user loses the chord they were
arpeggiating from. The `random` pattern uses `Math.random()`, so
undo→redo produces a different shuffle.

**Representative files:**

- `src/modules/MIDI/useCases/arpeggiator.ts:64,104-110`

**Needed:** (a) Take an `output: 'replace' | 'merge'` flag, default to
`'merge'` (or write to a new clip); document destruction. (b) Use
`createSeededRandom`; thread the seed to the action payload as in
issue #7.

**Verified (2026-04-28):** `arpeggiator.ts:64` —
`Math.floor(Math.random() * (index + 1))`. Confirmed unsalted RNG.
`arpeggiator.ts:104-110` — `notesByClipId[clipId] = newNotes`
unconditionally replaces. **Additional finding:** `arpeggiator.ts:95`
mints ids as `arp-${clipId}-${stepIndex}` — **deterministic across
calls**. If the user invokes arpeggiate twice on the same clip, the
second run produces ids that collide with the first run's ids
(though the first set is replaced, so the collision is "previous-
state" only — UNDO history holds notes with ids that the next run
will mint identically, which on undo→redo→undo gives unstable id
graphs). The mix of "deterministic ids for this generator" and
"randomUUID elsewhere" is itself a hidden footgun. Severity: **Medium**.

### 15. `MidiNote` model factory does not validate inputs

**Problem:** `createMidiNote` is the only place that constructs a
note, but it accepts arbitrary `pitch`, `velocity`, `duration`,
`probability` without clamping. Some call sites clamp; many do not.
The model factory should be the boundary.

**Representative files:**

- `src/modules/MIDI/models/MidiNote.ts:28-43`

**Needed:** Clamp at the factory: `pitch ∈ [0, 127]`, `velocity ∈ [1,
127]`, `duration ∈ [MIN_NOTE_DURATION_BEATS, ∞)`, `probability ∈ [0,
100]`. Drop the per-call-site clamping in `addMidiNote`,
`batchAddMidiNotes`, `duplicateClipNotes`. Add a `MIN_NOTE_DURATION_BEATS`
constant in `models/`.

**Verified (2026-04-28):** `models/MidiNote.ts:28-43`,
`createMidiCC.ts` lines 45-53, `createMidiPitchBend` 55-62 — none of
the three factories clamp. Callers that clamp:
`addMidiNote.ts:17-20`, `batchAddMidiNotes.ts:32-35`,
`duplicateClipNotes.ts:16-18`. Callers that **do not** clamp: every
transform via `updateNotesForClip` (humanize/quantize/retrograde/
invert/transpose/scaleVelocities/legato/join), `stampChord.ts:30`,
`splitMidiNotesAtBeat.ts:58`, `splitNoteAtBeat.ts:37`,
`createPatternInstance.ts:52`. `setNoteVelocity.ts:5` clamps to
`[0, 127]` but every other site uses `[1, 127]` — see new issue #34
below. Severity: **High** for vel=0 inconsistency (vel-0 noteOn ≡
noteOff in MIDI wire spec).

### 16. CC/pitch-bend `beat` semantics ambiguous (relative vs absolute)

**Problem:** The note-migration converted notes from absolute to
clip-relative. CC and pitch-bend events were not migrated. Operations
like `shiftMidiNotesAfterBeat` compare `event.beat >= atBeat` against
notes (relative) and CC (absolute, possibly). The reference frames
disagree.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteCrud/shiftMidiNotesAfterBeat.ts:33-47`
- `src/modules/MIDI/useCases/midiNoteCrud/migrateAbsoluteMidiNotes.ts`

**Needed:** Audit all CC writers (`addMidiCC`, hardware controller
flow, MIDI import) for the coordinate they're using. Document the
contract on `MidiCC` / `MidiPitchBend` (`/** beat is clip-relative,
matches MidiNote.startBeat */`). Add a migration if any CC was
written absolute.

**Verified (2026-04-28):** `shiftMidiNotesAfterBeat.ts:11-19` — the
docstring now reads "Notes and CC/pitch-bend events are stored with
**absolute beat positions**". This **contradicts** the post-migration
clip-relative invariant for notes (every other use case treats
`note.startBeat` as clip-relative — `addMidiNote.ts:19`, the piano-roll
view, etc.). Either the docstring is wrong, or notes are written
relative everywhere except in this file's mental model. Worse: the
function applies the same `>= atBeat` check to notes, CC, and pb
without any reference-frame translation. If notes are clip-relative,
`note.startBeat >= atBeat` is meaningless — atBeat is timeline-
absolute (per the docstring of issue #16). The bug hides behind the
docstring's incorrect claim that everything is absolute. Severity:
**Critical** — fundamental coordinate-system bug that produces
silent data corruption when arrangement-level shifts are applied to
clips with notes at relative coordinates.

### 17. `controller-scripting.worker.ts` runs untrusted user code

**Problem:** `new Function('DAW', code)(DAW)` evaluates user-supplied
controller scripts in the worker. The eslint-disable acknowledges
this is "not a full secure sandbox". A hostile script can flood
`postMessage` with `setParam` events, locking the main thread; abuse
the `sendMidi` API to send System Real-Time messages; consume CPU
indefinitely without a timeout.

**Representative files:**

- `src/modules/MIDI/workers/controller-scripting.worker.ts:13-37`

**Needed:** (a) Add a per-script `timeout` (workers can be terminated
from the main thread). (b) Rate-limit `postMessage` from the worker
(token bucket). (c) Validate `setParam` against an allowlist of known
device IDs. (d) Document the threat model — if scripts are
**personal-use only** and never shared, the current implementation is
fine; if scripts are shared (J2's intent per the comment), a real
sandbox (QuickJS in WASM, or Realms-shim) is needed.

**Verified (2026-04-28):** `controller-scripting.worker.ts:30-32` —
confirmed `new Function('DAW', code)` with no rate limit, timeout,
or sandbox. The `DAW` shim exposes `setParam` and `sendMidi` —
`sendMidi` accepts arbitrary `bytes: number[]`, including system
real-time bytes (0xFA-0xFC, start/continue/stop) which can desync
hardware connected to the user's setup. The eslint-disable comment
acknowledges the "not a full secure sandbox" caveat. Severity:
**High** if scripts ever propagate via project files; **Low** as a
local-only tool.

### 18. No module root `index.ts`; type leakage and model isolation

**Problem:** `src/modules/MIDI/` has no top-level `index.ts`.
External consumers reach into `stores/`, `useCases/`, `presentations/views/`
individually. `useCases/index.ts:6,103` exports types
(`ArpPattern`, `ArpRate`, `MidiLearnDependencies`). Other modules
import `MidiNote` directly from `models/` (AGENTS.md "Model
isolation").

**Representative files:**

- `src/modules/MIDI/` (no `index.ts`)
- `src/modules/MIDI/useCases/index.ts:6,103`
- `src/modules/Arrangement/stores/__tests__/arrangementMiscStores.spec.ts:9`
- `src/modules/Arrangement/handlers/clip/handleArpeggiate.ts:1`

**Needed:** (a) Create `src/modules/MIDI/index.ts` re-exporting only
from `useCases/`, `stores/`, `events/`, `presentations/views/` per
AGENTS.md. (b) Drop type re-exports from `useCases/index.ts`;
external consumers must define their own types or use `Parameters<typeof
fn>`. (c) Audit cross-module callers for `import type { MidiNote }`
and replace with locally-defined view types (per `models/TrackViewTypes.ts`
pattern already in use).

**Verified (2026-04-28):** `ls src/modules/MIDI/index.ts` → MISSING.
`useCases/index.ts:6` exports `type ArpPattern, ArpRate`; `:103`
exports `type MidiLearnDependencies`. `stores/index.ts:5,10,13,16`
re-exports state/learning types. **AudioAnalysis** and **Arrangement**
modules _do_ have root `index.ts` files (verified via
`grep -l "modules/.*index.ts"`). Severity: **Medium** — architectural
drift, but no functional bug.

### 19. Quantize length & no-strength: silently elongates short notes

**Problem:** `quantizeNoteLengths(clipId, gridSize)` does
`Math.max(gridSize, Math.round(d / gridSize) * gridSize)`. A 1/64
note quantized at 1/4 grid becomes a quarter note. No `strength`
parameter. The handler dispatches with no warning.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/quantizeNoteLengths.ts:7`
- `src/modules/MIDI/handlers/noteTransform/handleQuantizeNoteLengths.ts:7`

**Needed:** Add `strength` (interpolate between original and rounded
duration) like `quantizeNotes`. Drop the `Math.max(gridSize, …)`
floor — let durations round naturally; clamp at
`MIN_NOTE_DURATION_BEATS` (1/64) instead.

**Verified (2026-04-28):** `quantizeNoteLengths.ts:7` —
`Math.max(gridSize, Math.round(node.duration / gridSize) * gridSize)`.
Confirmed: a 1/64 note (duration 0.0625) at gridSize 1.0 (quarter)
becomes `Math.max(1.0, Math.round(0.0625) * 1.0) = Math.max(1.0, 0)
= 1.0`. The note expands 16x, silently. `handleQuantizeNoteLengths`
forwards a single `gridSize` payload. Severity: **High** — destructive
without warning.

### 20. `legatoNotes` cross-pitch fallback is musically wrong

**Problem:** When no same-pitch successor exists, `legatoNotes`
extends the note to the next selected note _on any pitch_. For a
chord progression with multiple voices selected, every voice extends
to the next chord's onset of a _different_ voice — distorting voicing.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/legatoNotes.ts:42-52`

**Needed:** Change the fallback to "next note in time on any pitch in
the clip" (not just selection), or "leave as-is and warn". Add a
test with a 4-voice chord progression that asserts each voice
extends only to its own next chord-tone occurrence or the next
chord's same-voice onset.

**Verified (2026-04-28):** `legatoNotes.ts:42-52` — confirmed: when
no same-pitch successor exists, the function searches for the next
**selected** note on any pitch. Worse than the audit claims: the
fallback only considers selected notes, so a single unselected note
in between is ignored. A 4-voice chord at beat 0 (selected) followed
by a single unselected lead note at beat 0.5 followed by a 4-voice
chord at beat 1 (selected) — every voice in the first chord extends
to **beat 1** (next selected), passing right through the unselected
note at 0.5. Severity: **Medium** — the operation is musically
surprising; documenting the behaviour in the UI tooltip is the
minimum.

### 21. `stampChord` skips out-of-range chord tones

**Problem:** A chord stamped with a high root (`125`) at type `'9'`
(intervals `[0, 4, 7, 10, 14]`) silently drops 4 of 5 notes. The
user gets a single note where they expected a chord.

**Representative files:**

- `src/modules/MIDI/useCases/chordStamps/stampChord.ts:27-32`

**Needed:** Detect the out-of-range condition and either (a) shift
the chord down an octave to fit, or (b) refuse with a notification.
Silent dropping is the worst option.

**Verified (2026-04-28):** `stampChord.ts:27-32` — confirmed.
`pitch >= 0 && pitch <= 127` is the only filter; out-of-range tones
are silently skipped with no warning, no octave shift. For
`rootPitch=125, chordType='9'` (intervals `[0,4,7,10,14]`), only
pitch 125 (root) passes; the user gets a single-note "9th chord".
Severity: **High** UX. Bonus: `stampChord.ts:30` passes `velocity`
straight to `createMidiNote` with no clamp — caller could pass 200
and the model factory writes it. See issue #15.

### 22. `addMidiCC` allows duplicate `(beat, channel, controller)` events

**Problem:** Two calls produce two CC events at the same coordinate.
On export both are written; on playback the order is the store
insertion order (CRDT-replay-dependent). The store does not
de-duplicate; the use case does not check.

**Representative files:**

- `src/modules/MIDI/useCases/midiEvent/addMidiCC.ts:5-23`

**Needed:** Either (a) replace existing event at `(beat, channel,
controller)` if one exists, or (b) accept duplicates as a feature
but document the playback-order semantics.

**Verified (2026-04-28):** `addMidiCC.ts:5-23` — no de-duplication.
`addPitchBend.ts:5-23` — same; `addPitchBend` does NOT clamp the
`value` to `[-8192, 8191]` (whereas `movePitchBend.ts:24` and
`setNotePitchBend.ts:19` do clamp). New finding (#37 below):
`addPitchBend` accepts unbounded values; `addMidiCC` accepts
unclamped `value` and `controller`. Severity: **Medium**. The
duplicate-event problem also affects pitch-bend: rapid hardware
controller sweeps generate hundreds of events at the same beat.

### 23. Function signatures take positional parameters (AGENTS.md)

**Problem:** ~20 functions in this module take positional parameters
(see Findings #37). AGENTS.md mandates a single object param for
multi-param functions.

**Representative files:** see Findings #37.

**Needed:** Mechanical refactor to `{ ... }` parameters with
`<FunctionName>Input` types. Highest-impact cases to do first:
public surface (`createMidiNote`, `addMidiNote`, `addMidiCC`,
`stampChord`, `quantizeNotes`, `humanizeNotes`,
`createPatternInstance`).

**Verified (2026-04-28):** Listing of positional functions confirmed
across the module. Note: `shiftMidiNotesAfterBeat.ts:21` _does_ take
a single object, so the architecture is in transition; mixed style
adds churn for callers. Severity: **Medium** — AGENTS.md violation,
but the most painful failures are in user-facing entry points
(`stampChord` 6 positionals, `humanizeNotes` 4 positionals).

### 24. Type assertions in `handleAddChordEvent` and `importHardwareMappings`

**Problem:** `handleAddChordEvent.ts:11` uses `as ChordType` after a
runtime `Set.has` check. `importHardwareMappings.ts:37–48` chains
`(entry as Record<string, unknown>).controlType as string` to coerce
unknowns into typed fields. AGENTS.md "TypeScript — soundness"
forbids both.

**Representative files:**

- `src/modules/MIDI/handlers/chordTrack/handleAddChordEvent.ts:11`
- `src/modules/MIDI/useCases/hardware/portableMappings.ts:33-48`

**Needed:** (a) Replace `as ChordType` with a type guard
(`isChordType(quality)`) that narrows. (b) Replace the
import-hardware-mappings cast chain with Zod (`ControllerMapping`
schema → `parsed.success`). Surface failures via `notifyUser`.

**Verified (2026-04-28):** `handleAddChordEvent.ts:11` —
`(alpha.payload.quality as ChordType)` after `Set.has()`. Confirmed.
`portableMappings.ts:37-48` — five repeated
`(entry as Record<string, unknown>).field as <type>` casts. AGENTS.md
"TypeScript — soundness" forbids both. Worse:
`portableMappings.ts:54-56` swallows JSON errors with
`console.error` — the user has no signal that import failed.
Severity: **High** for sound-typing violations (AGENTS.md hard
rule); **Medium** for the silent failure path.

### 25. Async-for-no-reason in pattern-instance handlers

**Problem:** Both `handleCreatePatternInstance` and
`handleDetachPatternInstance` are `async` with an
`eslint-disable @typescript-eslint/require-await` justification. They
call sync use cases. Pollutes call sites with `await`.

**Representative files:**

- `src/modules/MIDI/handlers/patternInstance/handleCreatePatternInstance.ts:7`
- `src/modules/MIDI/handlers/patternInstance/handleDetachPatternInstance.ts:7`

**Needed:** If `createHandler` requires `async execute`, make the
sync use cases run inside a sync wrapper that returns
`Promise.resolve()`; or change the handler interface to accept
sync. Either way, drop the eslint-disable.

**Verified (2026-04-28):** Both files at `:6-9` use the disable
comment. `createHandler<'createPatternInstance'>` and `<'detachPatternInstance'>` — the
generic dispatcher must accept the async signature, but a sync use
case wrapped in async pollutes call sites. Severity: **Low** —
minor, but indicates the handler interface is misshapen.

### 26. Duplicate `MidiLearnButton` views

**Problem:** Two files exist:
`MIDI/presentations/views/MidiLearnButton.tsx` and
`Arrangement/presentations/views/MidiLearnButton.tsx`. Both consume
the same MIDI store and use cases.

**Representative files:**

- `src/modules/MIDI/presentations/views/MidiLearnButton.tsx`
- `src/modules/Arrangement/presentations/views/MidiLearnButton.tsx`

**Needed:** Pick one (the MIDI module is the natural owner). Update
`Arrangement` to import from `#/modules/MIDI`. Delete the duplicate
**only with explicit instruction** (per CLAUDE.md hard rule).

**Verified (2026-04-28):** `find … -name "MidiLearnButton.tsx"` →
both files exist:
- `src/modules/Arrangement/presentations/views/MidiLearnButton.tsx`
- `src/modules/MIDI/presentations/views/MidiLearnButton.tsx`
Severity: **Medium** — duplicate UI, two sources of truth.

### 27. Duplicate chord-type definitions

**Problem:** `models/ChordTypes.ts:6-24` and
`useCases/chordStamps/helpers.ts:1-22` define `CHORD_TYPES`
identically. `models/ChordEvent.ts:1` imports `ChordType` from
`useCases/chordStamps/helpers.ts` — model importing from a use case
is the wrong dependency direction.

**Representative files:**

- `src/modules/MIDI/models/ChordTypes.ts`
- `src/modules/MIDI/useCases/chordStamps/helpers.ts`
- `src/modules/MIDI/models/ChordEvent.ts:1`
- `src/modules/MIDI/useCases/chordStamps/CHORD_TYPE_KEYS.ts`

**Needed:** Keep `models/ChordTypes.ts` as the single source.
`useCases/chordStamps/helpers.ts` and
`useCases/chordStamps/CHORD_TYPE_KEYS.ts` re-export from
`../../models/ChordTypes`. Update `ChordEvent.ts` to import from
`./ChordTypes`. Delete the duplicates **only with explicit
instruction**.

**Verified (2026-04-28):** Read-confirmed: `models/ChordTypes.ts:6-24`
and `useCases/chordStamps/helpers.ts:1-21` are byte-identical (same
chord intervals, same key order). `models/ChordEvent.ts:1` imports
`type ChordType` from `useCases/chordStamps/helpers.ts` — model
depending on use case, **wrong direction** per AGENTS.md.
`useCases/chordStamps/CHORD_TYPE_KEYS.ts:5` is also duplicated in
`models/ChordTypes.ts:28`. Three sources for the same data.
Severity: **High** for the inverted dependency
(model → use case); **Medium** for the duplication.

### 28. `duplicateClipNotes` lives in `stores/`, not `useCases/`

**Problem:** `stores/duplicateClipNotes.ts` is a use case (read
state, write state) misplaced under `stores/`. It is exported via
`stores/index.ts:9`. AGENTS.md: stores re-export data and
boundaries, not operations.

**Representative files:**

- `src/modules/MIDI/stores/duplicateClipNotes.ts`
- `src/modules/MIDI/stores/index.ts:9`

**Needed:** Move to `useCases/midiNoteCrud/duplicateClipNotes.ts`
and re-export from `useCases/index.ts`. Update callers (the
external import path will change). **Only with explicit instruction.**

**Verified (2026-04-28):** `stores/duplicateClipNotes.ts:5-31` —
this file reads from `midiStore`, transforms, writes back. Pure use
case. Listed in `stores/index.ts:9`. Bonus finding: the
implementation **drops** the original notes' `probability`,
`pressure`, `slide`, `pitchBend` (it only forwards `pitch`,
`startBeat`, `duration`, `velocity` to `createMidiNote`). Duplicating
a clip with expression data loses every expressive parameter. New
issue #35 below.

### 29. No round-trip test for MIDI import/export

**Problem:** `__tests__/exportMidiFile.spec.ts` and
`__tests__/importMidiFile.spec.ts` exist as separate specs. Neither
composes the two. Round-trip (export → import → assert event
equality) is the only safe check for the SMF byte-level encoding,
note pairing, channel preservation, and ordering invariants.

**Representative files:**

- `src/modules/MIDI/useCases/__tests__/exportMidiFile.spec.ts`
- `src/modules/MIDI/useCases/__tests__/importMidiFile.spec.ts`

**Needed:** Add a `roundTrip.spec.ts` that:
1. Builds a fixture with notes spanning 2 channels, overlapping
   same-pitch notes, CC, pitch-bend, tempo change.
2. Exports via `downloadMidiFile`.
3. Re-parses via `parseMidiFile` (worker function exported for test).
4. Asserts every note returns to the same `(channel, pitch, startBeat,
   duration, velocity)` and every CC/pb survives.
This single test catches issues #1, #2, #3, #4 simultaneously.

**Verified (2026-04-28):** `find … -name "*.spec.ts"` shows 83 test
files; `grep "roundTrip\|round-trip"` → empty. Confirmed.
`parseMidiFile` is not exported from the worker file (lines 80, 188)
— the only callable is `self.onmessage`. Adding the round-trip test
also requires either exporting `parseMidiFile` or constructing a
worker harness in tests. Severity: **High** — a single round-trip
fixture catches the entire I/O class of bugs.

### 30. CC `addMidiCC` returns the constructed CC; the rest of the API does not

**Problem:** `addMidiCC` and `addPitchBend` return the new event;
`addMidiNote` returns the new note; `batchAddMidiNotes` returns the
array; but `setNoteVelocity*`, `moveMidiNote`, `removeMidiNote`,
`resizeMidiNote`, `setNoteProbability`, `setNotesForClip`,
`shiftClipMidiNotes`, `splitMidiNotesAtBeat` all return `void`.
`stampChord` returns `MidiNote[]` (used by the test). `arpeggiate`
returns `void` despite generating notes. `applyGrooveToClip` returns
the originals map for undo. `strumNotes` returns the originals map.
The shape of "what gets returned" is per-author guesswork.

**Representative files:** entire `useCases/midiNoteCrud/` and
`midiNoteTransforms/` folders.

**Needed:** Adopt one rule. Suggested: return `void` for all
transforms; return the created note(s) for `add*` use cases; return a
`{ undo: () => void }` from anything that needs custom undo (groove,
strum). Document.

**Verified (2026-04-28):** Spot-checked: `addMidiNote` returns
`MidiNote` (line 33), `setNoteVelocity` returns void, `arpeggiate`
returns void, `humanizeNotes` returns `number` (the seed),
`stampChord` returns `MidiNote[]`, `removeMidiNote` returns void.
Severity: **Low** — API smell, not a bug per se.

### 31. `getChordAtBeat` linear scan in a hot path

**Problem:** Iterates the full sorted events array end-to-start.
Called per-frame from the chord-track-aware playback layer.

**Representative files:**

- `src/modules/MIDI/useCases/chordTrack/getChordAtBeat.ts:12-18`

**Needed:** Binary search by `beat`, then check duration. With a
sorted events invariant maintained by `addChordEvent` and
`moveChordEvent`, this is O(log N) per query.

**Verified (2026-04-28):** `getChordAtBeat.ts:12-18` — confirmed
end-to-start linear scan. `addChordEvent.ts:12` sorts after insert
(`.sort((a, b) => a.beat - b.beat)`), so the invariant is
maintained. Severity: **Low** for typical chord-track sizes (<100
events); **Medium** if used per audio block in playback path.

### 32. `controller-scripting.worker` console.log per script run

**Problem:** `console.log('Running controller script...')` runs every
time the script executes (potentially every MIDI message).

**Representative files:**

- `src/modules/MIDI/workers/controller-scripting.worker.ts:17`

**Needed:** Drop the log or gate behind a debug flag.

**Verified (2026-04-28):** `controller-scripting.worker.ts:17` —
confirmed `console.log('Running controller script...')`. Severity:
**Low**.

---

## New issues (added in 2026-04-28 adversarial review)

### 33. `readMidiFile` has no parse timeout (worker hang → forever-pending promise)

**Problem:** `readMidiFile` (`importMidiFile.ts:20-51`) creates a
promise that resolves only when the worker posts `'parsed'` or
`'error'`. If the worker is in an infinite loop (malformed file
where `readVarLen` never sees the high bit clear, see audit point
about `readVarLen` bound checks at `midiImportWorker.ts:57-65`), the
promise never resolves. Callers `await` indefinitely; the user sees
a spinner that never completes.

**Representative files:**

- `src/modules/MIDI/useCases/importMidiFile.ts:20-51`
- `src/modules/MIDI/workers/midiImportWorker.ts:57-65`

**Needed:** Add `setTimeout(() => { worker.terminate(); reject(...) },
10_000)` (or similar) to bound the parse. Better: bound-check
`readVarLen` against `buffer.byteLength` at the worker level so
malformed files fail fast with a meaningful message.

### 34. `setNoteVelocity` clamps to `[0, 127]`; rest of module clamps to `[1, 127]`

**Problem:** `setNoteVelocity.ts:5` writes
`Math.max(0, Math.min(127, velocity))`. Every other site
(`addMidiNote.ts:18`, `batchAddMidiNotes.ts:33`,
`exportMidiFile.ts:50`, `humanizeNotes.ts:19`) uses
`Math.max(1, …)`. MIDI's wire spec treats velocity 0 in a noteOn as
**noteOff** — silent corruption.

A user setting velocity to 0 via the velocity edit lane gets a note
that the synth interprets as a release. The piano-roll renders the
note (it's stored), but the audio engine emits noteOff and the note
plays inaudibly.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteCrud/setNoteVelocity.ts:5`

**Needed:** Change to `Math.max(1, Math.min(127, velocity))`. Add a
test that asserts velocity-edit-to-0 produces velocity=1.

### 35. `duplicateClipNotes` drops expression data (`probability`, `pressure`, `slide`, `pitchBend`)

**Problem:** `stores/duplicateClipNotes.ts:15-19` calls
`createMidiNote(safePitch, note.startBeat, safeDuration, safeVelocity)`
— forwards only the four positional core fields. The optional
`probability`, `pressure`, `slide`, `pitchBend` fields on the source
note are silently dropped on duplicate.

A user duplicating a clip with MPE expression or per-note pitch-bend
loses every expressive parameter.

**Representative files:**

- `src/modules/MIDI/stores/duplicateClipNotes.ts:15-19`

**Needed:** Spread the source note: `{ ...createMidiNote(...),
probability: note.probability, pressure: note.pressure, slide:
note.slide, pitchBend: note.pitchBend }`. Add a test that asserts
expression data round-trips on duplication.

### 36. `stepRecordStore.set(null)` violates the typed contract

**Problem:** `toggleStepRecording.ts:24` calls
`stepRecordStore.set(null)`. The store is typed as
`createStore<StepRecordState>` (`stepRecordStore.ts:27`), and
`Store.set` accepts `T | null`, but every other consumer assumes a
non-null state. `stepRecordNoteOn.ts:5`, `stepRecordNoteOff.ts:4`,
`stepRecordNavigation.ts:7,20,32,66` all guard with
`if (!state || !state.active)` — the null check is mandatory at
every read site, where a single `defaultStepRecordState` reset would
remove the special case.

This is also why issue #5's "step-recording cursor wedge" is
recoverable via toggle-off: the entire state is wiped to null, not
preserved.

**Representative files:**

- `src/modules/MIDI/useCases/stepRecording/toggleStepRecording.ts:24`
- `src/modules/MIDI/stores/stepRecordStore.ts:15-25`

**Needed:** Replace `stepRecordStore.set(null)` with
`stepRecordStore.set(defaultStepRecordState)` and tighten consumers
to read `state.active` (already exists). Removes one branch from
every consumer.

### 37. `addPitchBend` and `addMidiCC` accept unbounded inputs

**Problem:**
- `addPitchBend.ts:11` forwards `value` straight to
  `createMidiPitchBend`, no `[-8192, 8191]` clamp. Compare with
  `movePitchBend.ts:24` which clamps explicitly.
- `addMidiCC.ts:11` forwards `value` and `controller` to
  `createMidiCC`, no `[0, 127]` clamp. Compare with
  `moveMidiCC.ts:20` which clamps `value` (but neither function
  clamps `controller` to `[0, 127]`).

A hardware controller with a glitched 14-bit pitch wheel can write
`value=42_000` to the store. Export then truncates the value into a
14-bit field, producing a wrap-around or bit-stuck.

**Representative files:**

- `src/modules/MIDI/useCases/midiEvent/addPitchBend.ts:11`
- `src/modules/MIDI/useCases/midiEvent/addMidiCC.ts:11`
- `src/modules/MIDI/useCases/midiEvent/moveMidiCC.ts:20`
- `src/modules/MIDI/models/MidiNote.ts:45-62`

**Needed:** Clamp at the model factory. `createMidiPitchBend` clamps
to `[-8192, 8191]`; `createMidiCC` clamps `value` and `controller`
to `[0, 127]`, `channel` to `[0, 15]`. Drop the per-call-site
clamping from the move functions.

### 38. `moveMidiNote` and `resizeMidiNote` skip clamping entirely

**Problem:**
- `moveMidiNote.ts:5` writes
  `{ ...node, pitch: newPitch, startBeat: newStartBeat }` — no clamp
  on either parameter. The piano-roll drag handler is the only
  defence; if it's bypassed (a programmatic action, a misbehaving
  view component, or a test fixture), `pitch=200` or
  `startBeat=-5` are committed verbatim.
- `resizeMidiNote.ts:9-12` clamps `duration` to `>= 0.0625`, but
  does NOT clamp `startBeat >= 0`. Resize-by-left-edge can drag the
  start past beat 0.

This is the symmetric counterpart to issue #12 (transforms don't
clamp): the **CRUD** layer doesn't either. Combined: there is no
single chokepoint that enforces `MidiNote` invariants.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteCrud/moveMidiNote.ts:3-7`
- `src/modules/MIDI/useCases/midiNoteCrud/resizeMidiNote.ts:3-16`

**Needed:** Add the clamp at the model factory (issue #15) and at
the CRUD entry points; or refactor so every CRUD function
constructs a fresh note via `createMidiNote` (which will then clamp
universally).

### 39. `migrateAbsoluteMidiNotes` does not migrate CC or pitch-bend events

**Problem:** The migration converts notes from absolute to relative
coordinates (`migrateAbsoluteMidiNotes.ts:38-41`). It does **not**
touch `ccByClipId` or `pitchBendByClipId`. If older project files
ever wrote CC/pb at absolute coordinates (the audit's #16 leaves
this open), those events are now in a different coordinate frame
than the notes in the same clip.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteCrud/migrateAbsoluteMidiNotes.ts:38-41`

**Needed:** Audit the project's CRDT history to determine whether
CC/pb were ever stored absolute. If yes, extend the migration. If
no, document the contract as "always clip-relative" and add a
schema-version flag (issue #8) to prove no further migration is
needed.

### 40. Pattern instance write-then-append race

**Problem:** `createPatternInstance.ts:49-64`:
1. `setNotesForClip(instanceId, clonedNotes)` — writes notes for a
   clip that does not yet exist in `trackStore`.
2. `if (!state.tracks.some(...)) return null;` — guard returns AFTER
   the note write; the orphan notes stay in `notesByClipId`.
3. `appendClipToTrack(targetTrackId, instance);` — finally inserts
   the clip.

Subscribers to `midiStore` between steps 1 and 3 see a clip-id with
notes but no clip. Failing the targetTrackId check at step 2 leaks
notes to the orphan id forever (no cleanup).

**Representative files:**

- `src/modules/MIDI/useCases/patternInstance/createPatternInstance.ts:49-64`

**Needed:** Reorder: validate `targetTrackId` first, append the clip
first, then write notes. Or batch both writes inside a single
projection-bridge transaction.

### 41. `arpeggiator` mints deterministic ids that collide on re-run

**Problem:** `arpeggiator.ts:95` —
`id: \`arp-${clipId}-${stepIndex}\``. The id is deterministic in
`(clipId, stepIndex)`. If the user invokes arpeggiate again with
**any** different parameters but the same `clipId`, the new ids are
exactly the same as the old ids — and because step 1 in
`arpeggiator.ts:104-110` replaces the entire clip's notes, the new
ids replace the old.

This is OK for the current "replace" semantic but interacts poorly
with undo: after redo of the second arpeggiate, the undo stack holds
notes whose ids the next "redo" will re-mint identically. Selection
state keyed on these ids becomes ambiguous.

**Representative files:**

- `src/modules/MIDI/useCases/arpeggiator.ts:89-101`

**Needed:** Use `crypto.randomUUID()` (full, not sliced — see #6).
Each invocation gets fresh ids. Combined with #14 ("merge vs
replace"), the destructive semantic disappears.

### 42. `joinNotes` adjacency tolerance is too tight (0.001 beats)

**Problem:** `joinNotes.ts:40-41` —
`Math.abs(sorted[j].startBeat + sorted[j].duration -
sorted[j+1].startBeat) < 0.001`. After `quantizeNotes` with
`strength < 1`, the residual offset can exceed 0.001 even when notes
are visually adjacent. After `humanizeNotes`, the residual is
guaranteed to exceed 0.001 (timing offsets are drawn from a uniform
distribution scaled by `timingAmount * 0.25` — typical value 0.05
beats).

The user selects a "humanized" run of notes, presses join, and
nothing happens. Silent no-op.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/joinNotes.ts:40-41`

**Needed:** Use a beat-grid-aware tolerance: e.g.,
`Math.abs(...) < gridSize / 2` where `gridSize` is the user's current
grid (read from `transportStore` or passed in). Or detect "visually
adjacent" by looking at piano-roll geometry rather than raw beats.

### 43. `legatoNotes` re-evaluates targets without using sorted indices

**Problem:** `legatoNotes.ts:18-60` — for each selected note, scans
the entire `notes` array twice (same-pitch successor, then any-pitch
successor). For a clip with N notes and S selected, the operation is
O(N × S). With 1000 notes and 200 selected, that's 200_000 scans on
a single user action.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/legatoNotes.ts:18-60`

**Needed:** Pre-sort once by `(pitch, startBeat)`, then for each
selected note look up the next same-pitch note via binary search.
O((N + S) log N).

### 44. `getMidiLearnDependencies()` is module-mutable global state

**Problem:** `useCases/midiLearn/midiLearnDependencies.ts` (read in
`handleMidiMessage.ts:20`) is a module-level mutable singleton set
via `setMidiLearnDependencies` (re-exported in
`useCases/index.ts:102`). Any caller of `setMidiLearnDependencies`
swaps the deps in-place; all subsequent MIDI messages route through
the new deps.

A test suite that calls `setMidiLearnDependencies(testStubs)` and
forgets to restore the original deps in `afterEach` will leak stubs
into other tests. Same risk for hot-module reload during dev.

**Representative files:**

- `src/modules/MIDI/useCases/midiLearn/midiLearnDependencies.ts`
- `src/modules/MIDI/useCases/midiLearn/handleMidiMessage.ts:20`

**Needed:** Inject deps via `inject({ deps: getMidiLearnDeps })`
pattern (already used in `completeMidiLearn.ts:13`), or make the
deps argument explicit on every call. Mutable globals are a
test-isolation hazard.

### 45. `chordTrackStore` `loadFromStorage` runs at module-evaluate time

**Problem:** `chordTrackStore.ts:25` —
`initialData: loadFromStorage()`. The `loadFromStorage` call
executes the moment the module is imported. Side effects:
- Browser localStorage read happens before the rest of the app
  initializes; if `window` is unavailable (SSR, worker context,
  test JSDOM with `localStorage` mocked late), the catch silently
  returns `defaultChordTrackState` and the user's stored chord
  track is **silently lost**.
- The catch swallows JSON parse errors with no logging, so a corrupt
  `sourdaw_chord_track` key never surfaces.
- Module-init side effects break tree-shaking and test setup.

**Representative files:**

- `src/modules/MIDI/stores/chordTrackStore.ts:12-26`

**Needed:** Defer `loadFromStorage` to a hydrate function called
after `appInitializer` runs. Surface load failures via the logger.

### 46. `propagateParentChanges` ignores child clip's `overrides.notes` flag without re-checking after edit

**Problem:** `propagateParentChanges.ts:36-38` skips child clips
where `clip.overrides?.notes` is truthy. But `overrides.notes` is a
boolean-like flag, not a list of overridden note ids. If the user
edits **a single note** on the child clip, then `overrides.notes`
becomes truthy and ALL parent edits are now ignored on this child —
even for notes the user never touched.

The audit doesn't cover this granularity bug.

**Representative files:**

- `src/modules/MIDI/useCases/patternInstance/propagateParentChanges.ts:36-38`
- `src/modules/MIDI/models/TrackViewTypes.ts` (Clip.overrides shape)

**Needed:** Track per-note overrides:
`overrides.notes: Set<string>` of overridden note ids. On
propagation, propagate every parent note **except** those whose ids
appear in the child's override set. Add a "reset overrides" action.

### 47. MIDI Learn lacks a "panic" / "all-mappings-cleared" recovery

**Problem:** No use case clears all MIDI Learn mappings at once. If
a user accidentally binds 50 CCs to a runaway hardware controller,
the only recovery is to remove each mapping individually (no UI
verified by audit). The store has `mappings: MidiMapping[]` but no
`clearAllMappings` use case.

**Representative files:**

- `src/modules/MIDI/useCases/midiLearn/` (no `clearAllMappings.ts`)
- `src/modules/MIDI/stores/midiLearnStore.ts:5-16`

**Needed:** Add `clearAllMappings()` use case and a UI command
binding. Severity: **Low** (UX), but cheap to add.

### 48. `formatChordName` does not handle negative `event.root` values gracefully

**Problem:** `models/ChordEvent.ts:14` —
`ROOT_NAMES[event.root % 12] ?? 'C'`. JS `%` is not modulo: `-1 % 12
=== -1`, so `ROOT_NAMES[-1]` is `undefined`, falls back to `'C'`.
But `-13 % 12 === -1` too, same fallback. The function silently
returns `'C'` for any negative root. `createChordEvent.ts:23` does
`root: root % 12` (same JS-modulo bug), so a caller passing
`root=-3` for a Bb gets `root: -3` in the store; subsequent
`formatChordName` returns `'C'`.

`handleAddChordEvent.ts:13` does `Math.max(0, Math.min(11, …))` —
clamps. So this is only reachable from direct
`addChordEvent` calls bypassing the handler.

**Representative files:**

- `src/modules/MIDI/models/ChordEvent.ts:14, 19-26`
- `src/modules/MIDI/useCases/chordTrack/addChordEvent.ts:5-16`

**Needed:** Use `((root % 12) + 12) % 12` (the standard JS modulo
fix) in `createChordEvent`. Same in `formatChordName`.

### 49. `humanizeNotes` ignores `velocityAmount` when called via the handler

**Problem:** Already mentioned indirectly in audit #7. Confirming as
its own issue:
- `humanizeNotes.ts:11` —
  `const vAmount = velocityAmount ?? timingAmount`. When
  `velocityAmount` is `undefined`, the function silently aliases
  velocity to timing.
- `handleHumanizeNotes.ts:7` calls
  `humanizeNotes(action.payload.clipId, action.payload.amount)` —
  passes only timing.

So the action payload has no way to specify velocity humanization
independently. The action contract is missing the `velocityAmount`
field.

**Representative files:**

- `src/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes.ts:11`
- `src/modules/MIDI/handlers/noteTransform/handleHumanizeNotes.ts:7`
- The `humanizeNotes` AppAction payload type (likely
  `src/modules/Command/...` — out of audit scope).

**Needed:** Extend the AppAction payload with `velocityAmount?:
number` and `seed?: number`. Update the handler to forward both.
Combined with #7's fix.

### 50. Worker file extension `.worker.ts` vs `.ts` inconsistency

**Problem:** Two worker files in the module:
- `workers/midiImportWorker.ts` (no `.worker` suffix, but is a
  worker — referenced via `new URL('../workers/midiImportWorker.ts',
  import.meta.url)` in `importMidiFile.ts:24`).
- `workers/controller-scripting.worker.ts` (uses `.worker.ts`).

Vite/Rollup conventions and the worker plugin sometimes treat
`.worker.ts` specially (auto-bundling as a worker). Inconsistent
naming risks build-tool surprises and confuses humans about
"is this a worker?".

**Representative files:**

- `src/modules/MIDI/workers/midiImportWorker.ts`
- `src/modules/MIDI/workers/controller-scripting.worker.ts`

**Needed:** Pick one convention. If `.worker.ts` is the project
standard (the controller-scripting file uses it), rename
`midiImportWorker.ts` → `midiImport.worker.ts` and update the URL
reference. If `WorkerName.ts` is the convention, rename the other.
Severity: **Low** — naming consistency only.

---

## Open questions

- [ ] Is the chord-track meant to be project-scoped (saved with the
      project) or session-scoped (per-browser)? Affects whether issue
      #13 is a bug or a deliberate UX.
- [ ] Are MIDI files round-tripped to disk a real user flow, or is
      "import" used only for one-shot ingestion? Determines the
      severity of issues #1, #4. (The presence of `downloadMidiFile`
      and a UI export action implies round-trip is intended.)
- [ ] What is the intended scope of `controller-scripting.worker.ts`?
      Personal-use scripts (low-trust user, ok), or shared marketplace
      (high-trust, must sandbox)?
- [ ] Is there a `migration_version` in `midiStore`'s Automerge
      document? If yes, issue #8 is half-fixed; if not, the heuristic
      runs on every load.
- [ ] What is the correct `MidiCC.beat` coordinate (relative or
      absolute)? Documentation needed.

---

## Risks

- **Coordinate-frame contradiction (NEW, see #16).** The
  `shiftMidiNotesAfterBeat` docstring claims absolute beats; the
  rest of the module treats notes as clip-relative. An arrangement-
  level operation that inserts time silently rebases notes against
  the wrong frame. Today this is a latent bug; the moment a user
  hits "insert beats at playhead" on a project with multiple clips
  on the right of the playhead, MIDI desyncs.
- **No invariant chokepoint for `MidiNote`.** Issue #38 (CRUD
  doesn't clamp) plus issue #12 (transforms don't clamp) plus issue
  #15 (model factory doesn't clamp) means there is **no point** in
  the module where note invariants are guaranteed. Every code path
  is on the honour system.
- **Velocity 0 silently disables notes (NEW, #34).**
  `setNoteVelocity` clamps to `[0, 127]`; vel-0 noteOn is noteOff
  on the wire. The piano-roll renders the note (it's stored), but
  it never sounds. User-visible "ghost note" — the note appears in
  the editor but does not play.
- **MIDI I/O credibility loss.** If a user can't open their old DAW
  files in the app and re-save without losing channels, CCs, and
  controller automation, the MIDI module is shippable for note-
  drawing but not for users with existing libraries.
- **Silent corruption from id collisions.** A 100k-note generative
  project hits ~50% birthday collision. Selection state, undo
  history, and pattern-instance propagation all key on these ids.
  Bugs surface days later as "this note jumped pitch on undo".
  Plus arpeggiator's deterministic ids (NEW finding under #14)
  collide on re-run.
- **Pattern-instance write-then-append race (NEW, #40).** Notes
  written for a clip-id before the clip exists; subscribers see
  orphan state. If the target-track validation fails, the orphan
  notes never get cleaned up.
- **Stuck notes in step recording.** A dropped note-off freezes the
  cursor. There is no recovery during active recording (only
  toggle-off recovers, by nulling the entire state).
- **Pattern-instance over-protection.** The `overrides.notes`
  flag is boolean; one user-edit flip blocks all parent
  propagation forever (NEW, #46).
- **Expression data dropped on duplicate (NEW, #35).** MPE
  pitch-bend, pressure, slide, probability all wiped when a clip is
  duplicated. Silent feature loss.
- **Module-init side effects (NEW, #45).** `chordTrackStore`
  reads localStorage at module-evaluate time; SSR / late-mock test
  setups silently lose user data.
- **Migration heuristic.** Clips matching `/melody|chords|drums|copy/i`
  trigger migration; user-named "drums copy" matches by accident.
  No schema-version flag. (Audit's "runs forever" claim is
  overstated — see #8 verification — but the underlying lack of a
  version flag remains.)
- **Pattern-instance regression.** The id-regenerate-on-propagate
  bug means every parent edit invalidates every child note's
  identity. Users typing notes on a parent see their selection on
  the child clear silently.
- **MIDI Learn fan-out and gain non-linearity.** Two mappings on
  the same CC fire both targets; track-gain is a linear map (not
  log-dB) so the bottom of the fader is unusable.
- **Quantization semantics drift.** Same notes, same swing
  parameter, different grid size → different musical result.
  "Quantize" is supposed to be predictable.
- **Test isolation hazard (NEW, #44).** `setMidiLearnDependencies`
  is a module-mutable global. A test that swaps deps and forgets to
  restore them leaks stubs into other tests. Same risk for HMR.
- **Architectural drift.** No root `index.ts`; types leaking from
  `useCases/index.ts`; models imported across boundaries; positional-
  parameter functions; `as` escapes. Unaddressed, these normalise
  AGENTS.md violations across the module.

---

## Suggested approaches

- **Land the round-trip test first (issue #29).** A failing
  round-trip catches #1, #2, #3, #4 simultaneously and forces a
  correct schema for `MidiNote.channel`. From a failing test, the
  fixes can be driven test-first.
- **Bump `midiStore.schemaVersion` and bake a migration (issue #8).**
  Drop the regex-based heuristic. Add an explicit `migrationVersion`
  field to the persisted shape; only run migrations when version
  bumps.
- **Replace the truncated UUIDs (issue #6).** Mechanical change;
  add a versioned migration to extend existing 8-char ids.
- **Centralise note clamping at the model factory (issues #12, #15,
  #21).** `createMidiNote` becomes the only place values are
  validated. Drop per-call-site clamping.
- **Standardise quantization swing (issue #11).** Define "offbeat"
  by musical position, not rounding direction. Add a test asserting
  cross-grid-size invariance.
- **Plumb seed/velocity through humanize (issue #7).** Coordinated
  with the AppAction contract change.
- **Split the architectural pass into two waves.** Wave 1: create
  module root `index.ts`, drop type re-exports from
  `useCases/index.ts`, replace `as` casts with type guards. Wave 2:
  positional → object parameters across the public surface.
- **Pattern-instance stable ids (issue #9).** Compute child ids
  from `(parentId, childClipId)`; reuse on subsequent propagations.
- **Step-recording panic clear (issue #5).** On toggle-off, on
  session start, clear `activeNotes`. Watchdog ≥ 5 s.
- **Chord-track storage decision (issue #13).** Decide between
  Automerge and project-scoped state; the current localStorage
  middle-ground is wrong.

---

## Recommendation

**Updated 2026-04-28 after adversarial review.**

**Step 0: settle the coordinate-frame contradiction (issue #16).**
Before any other fix, determine whether `MidiNote.startBeat` is
clip-relative (the migration suggests yes) or absolute (the
`shiftMidiNotesAfterBeat` docstring claims yes). Fix the docstring
or fix the function; the current state silently corrupts data on
arrangement-level shifts. This blocks every other I/O fix.

**Step 1: round-trip test (issue #29).** Empirically demonstrates
issues #1, #2, #3, #4 with a failing fixture, and unblocks the I/O
fixes test-first. Export `parseMidiFile` from the worker for test
access (or build a worker harness).

**Step 2: clamping chokepoint at the model factory (issues #15,
#34, #37, #38, plus #12).** Clamp at `createMidiNote`,
`createMidiCC`, `createMidiPitchBend` — the **single** point that
enforces invariants. Drop per-call-site clamping. Fix
`setNoteVelocity` to use `[1, 127]`. Add clamp to `moveMidiNote`
and `resizeMidiNote`. After this, transform-layer drift becomes
self-correcting on next CRUD touch.

**Step 3: id collision fix (issue #6).** Mechanical change with
high silent-corruption risk. Use full UUIDs or a
project-scoped monotonic counter. Migrate existing 8-char ids on
load (versioned migration — combine with step 4).

**Step 4: schema version + migration cleanup (issues #8, #39).**
Add `schemaVersion` field to `MidiStoreState`. Drop the regex
heuristic in `migrateAbsoluteMidiNotes`. Audit CC/pitch-bend for
historical absolute coordinates and migrate if needed. Document the
contract.

**Step 5: stuck-note panic clear (issue #5).** Smallest fix with
highest user-visible impact. On toggle-off, on session start, clear
`activeNotes`. Add a 5s watchdog. Add a "panic / all notes off"
action.

**Step 6: humanize seed plumbing (issues #7, #49).** Extend the
`humanizeNotes` AppAction payload with `velocityAmount` and
`seed`. Update the handler to forward both. Add a redo-determinism
test.

**Step 7: pattern instance correctness (issues #9, #40, #46).**
Stable child ids; reorder write-then-append in
`createPatternInstance`; per-note overrides instead of boolean
flag.

**Step 8: architecture sweep (issues #18, #23, #24, #25, #26, #27,
#28, #50).** Single mechanical pass. Create
`src/modules/MIDI/index.ts`. Drop type re-exports. Replace `as`
casts with type guards. Convert positional functions to object
parameters. Move `duplicateClipNotes` from `stores/` to
`useCases/midiNoteCrud/`. Consolidate `MidiLearnButton` and
`ChordTypes` duplicates. Standardise worker file naming.

After these steps, the remaining issues (#10, #11, #13, #19, #21,
#22, #41-48) are independent and can be tackled in priority order.

---

## Resolved

_No issues resolved yet._
