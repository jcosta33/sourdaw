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

1. **MIDI import data loss (#1, #2, #4, #30)** — the import path is
   monophonic-channel-zero-only. Any user MIDI file with channels,
   CCs, pitch-bend, or overlapping same-pitch notes silently loses
   data on import.
2. **MIDI export channel pinned to 0 (#4, #3)** — exports are not
   round-trippable; multi-channel files cannot be opened, edited,
   and re-exported. Combined with #1, the entire I/O contract is
   broken for non-trivial files.
3. **Stuck-note risk in step recording (#9)** — missing note-off
   keeps a pitch in `activeNotes` indefinitely; the cursor never
   advances; no recovery.
4. **Note id collision (#47)** — 32-bit-truncated UUIDs collide at
   ~65k unique notes per project. Collisions are silent corruption
   in selection, undo, MIDI Learn.
5. **`humanizeNotes` seed dropped by handler (#55, #56)** — undo/redo
   produces non-deterministic output; the seed parameter is dead
   code at the action contract level.
6. **`migrateAbsoluteMidiNotes` migrates on every load (#46)** — no
   version flag; user-named clips named "drums" / "copy" can be
   shifted on every page load until `clip.startBeat == 0`.
7. **Pattern-instance id regeneration (#25)** — every parent edit
   invalidates every child note id; selection / undo / per-id memos
   break silently.
8. **`MidiLearn` channel/CC fan-out and value-range mismatch (#7,
   #51, #52)** — duplicate mappings fire all targets; track-pan
   `[-50, 50]` is a third convention; gain is linear, not dB.
9. **Quantization swing instability (#13)** — "is offbeat" depends
   on rounding, so `quantizeNotes` with `gridSize = 0.25` and
   `gridSize = 0.5` produce different swing for the same notes.
10. **`startBeat < 0` not consistently clamped (#3, #12)** — humanize,
    quantize, retrograde, scale-velocities and friends can drift
    notes off the timeline.
11. **`workers/controller-scripting.worker.ts` runs unsandboxed user
    code (#11)** — feature is fine for personal use but is silently
    a remote code execution vector if scripts are ever shared.
12. **No module root `index.ts`; type leakage from `useCases/index.ts`
    and model imports across boundaries (#33, #34, #36)** — AGENTS.md
    architectural violations that have hardened with time.

---

## Open issues

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

### 21. `stampChord` skips out-of-range chord tones

**Problem:** A chord stamped with a high root (`125`) at type `'9'`
(intervals `[0, 4, 7, 10, 14]`) silently drops 4 of 5 notes. The
user gets a single note where they expected a chord.

**Representative files:**

- `src/modules/MIDI/useCases/chordStamps/stampChord.ts:27-32`

**Needed:** Detect the out-of-range condition and either (a) shift
the chord down an octave to fit, or (b) refuse with a notification.
Silent dropping is the worst option.

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

### 31. `getChordAtBeat` linear scan in a hot path

**Problem:** Iterates the full sorted events array end-to-start.
Called per-frame from the chord-track-aware playback layer.

**Representative files:**

- `src/modules/MIDI/useCases/chordTrack/getChordAtBeat.ts:12-18`

**Needed:** Binary search by `beat`, then check duration. With a
sorted events invariant maintained by `addChordEvent` and
`moveChordEvent`, this is O(log N) per query.

### 32. `controller-scripting.worker` console.log per script run

**Problem:** `console.log('Running controller script...')` runs every
time the script executes (potentially every MIDI message).

**Representative files:**

- `src/modules/MIDI/workers/controller-scripting.worker.ts:17`

**Needed:** Drop the log or gate behind a debug flag.

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

- **MIDI I/O credibility loss.** If a user can't open their old DAW
  files in the app and re-save without losing channels, CCs, and
  controller automation, the MIDI module is shippable for note-
  drawing but not for users with existing libraries.
- **Silent corruption from id collisions.** A 100k-note generative
  project hits ~50% birthday collision. Selection state, undo
  history, and pattern-instance propagation all key on these ids.
  Bugs surface days later as "this note jumped pitch on undo".
- **Stuck notes in step recording.** A dropped note-off freezes the
  cursor. There is no recovery. Users reset the project.
- **Migration runs forever.** Clips named with the magic regex are
  shifted on every project load until `startBeat == 0`. A user who
  imported their library yesterday opens it today and finds half
  their clips at beat 0.
- **Pattern-instance regression.** The id-regenerate-on-propagate
  bug means every parent edit invalidates every child note's
  identity. Users typing notes on a parent see their selection on
  the child clear silently.
- **MIDI Learn fan-out.** Two mappings on the same CC fire both
  targets. The user thinks they replaced the binding; they doubled
  it.
- **Quantization semantics drift.** Same notes, same swing
  parameter, different grid size → different musical result.
  "Quantize" is supposed to be predictable.
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

Start with **issue #29 (MIDI round-trip test)** because it
empirically demonstrates issues #1, #2, #3, #4 with a failing
fixture, and unblocks the I/O fixes test-first.

Land the **id-collision fix (issue #6)** in parallel — it is a
mechanical change with high silent-corruption risk, and any fix to
issue #29 (`MidiNote.channel`) will ride alongside a schema-version
migration that can include the id widening.

Then pick **issue #5 (step-recording stuck-note hazard)** — the
smallest fix with the highest user-visible impact, and a natural
property test (`stepRecordNoteOn × N → toggleStepRecording → assert
activeNotes.size === 0`).

After those three land, the architecture pass (#18, #23, #24, #25,
#26, #27) is a single mechanical sweep that should land in one
commit.

---

## Resolved

_No issues resolved yet._
