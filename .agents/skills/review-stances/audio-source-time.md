# Standing probes: audio source time

Defects where a reader, edit or publication selects a different audio source sample than playback does. An
offset stored in beats names a position in an audio source only after the clip-start tempo converts it to
seconds; a project base tempo is insufficient when a tempo-map change precedes or lands at the clip start. Live
and offline playback already use the clip-start tempo, and every source reader, edit helper, inverse and saved
history entry must agree with them to the exact source frame. Tempo projection to automation and scheduler
terminal bindings is `audio-timing-format-laws.md` probe 1. Each probe names the input, the check that must go
red and the mutation that must fail it. Report the concrete break or none.

## Standing probes

1. **Every source reader converts at the clip-start tempo (#4570, #1109).** #4570 made audio-to-MIDI honor
   trimmed source windows but converted the offset at the project base tempo; earlier waveform and Strip
   Silence readers did the same, and #1109 let tempo maps govern the transport without requiring these readers
   to match, so flat-tempo fixtures passed. Set project tempo to 120 BPM, place an instant 90 BPM change at an
   offset-bearing clip's start, and put a transient at the source sample playback seeks. Compare the exact
   waveform peak sample requests in Canvas and GPU rendering, the Strip Silence scan and resulting audible
   fragments within that flat tempo region, the transcribed MIDI onset and the zero-crossing target with live
   and offline playback. Then change only the tempo map and require cached waveform models to refresh;
   drag-preview the clip across the change and require its projected source window to change. Include zero
   and negative offsets so pre-roll is retained. A change inside the clip's audible span needs integrated
   source-to-timeline mapping and separate edit-history review; a clip-start conversion alone does not prove it.
2. **Source geometry survives storage hydration (#2169).** A Strip Silence fixture at 600 BPM, which real
   publication normalizes to 120 BPM, made fixture-time geometry disagree with the published project once a
   storage flush exposed hydration. Exercise the analysis path through the real storage flush and hydration
   with supported geometry (300 BPM at 50 Hz: one beat is exactly 10 samples) and require the same
   source-frame window and Strip Silence fragments before and after hydration. The unsupported 600 BPM
   fixture cannot stand in for a source-time probe.
3. **Crossfade preserves a negative media origin (#4236, #4987).** #4236's crossfade compensation clamped
   the source offset at zero; #4987 made negative `audioOffsetBeats` a valid recording result, so a clip at
   beat 4 with offset -1, unity stretch and a one-beat crossfade got no pre-roll movement and an offset of 0.
   Seed a recording-shaped negative-offset clip, crossfade through the real use case and the registered
   handler through Command and real Undo/Redo, inspecting the captured inverse and redo with authoritative
   document and store state: the signed offset and media origin survive, for unity and stretched clips with
   present and absent loop anchors. Reinstating either consumer's zero clamp must fail its own forward or
   history assertion; keep positive-offset, zero-offset, stretch and loop-region controls.
4. **A local-tempo inverse converges across a complete excursion (#4987 `62a116ee00`).** The unbracketed
   inverse in `renderTempoTimeline` alternated between segments on a 180 to 60 to 180 BPM excursion at beats
   0.25 and 0.5 and mapped a source ending at frame 8320 to frame 320. Invert that map through the real render
   callback at 48 kHz, then resolve the same finite captured pass through live and offline readers with comp
   entry at beat zero and inside the slow segment: exact exclusive ending at frame 8320 and last audible frame
   8319, stretched playback included. Restoring only the unbracketed inverse must fail the owning inverse spec
   and the reader parity spec; keep zero and negative-time probes so the repair cannot drop run-up.
5. **An integrated prefix landing on a frame boundary keeps the exact frame (#263, #2078).** The segment
   integrator accumulated durations without compensation: instant changes of 120 BPM at beat 0, 240 at 0.25
   and 120 at 0.45 give `S(0.5) = 0.19999999999999998`, and source entry `-0.1 s` then selects frame 4799 at
   48 kHz instead of 4800 (changing multiplication order alone stays wrong). Split through the registered
   action at beat 0.5 and require raw and projected source entry `0.1 s` / frame 4800 through binary reopen,
   Undo and Redo. Removing only the compensation must fail at frame 4799; keep a genuinely fractional-frame
   endpoint, negative pre-roll and its inverse, and a constant-tempo linear segment so rounding or a
   substituted source clock cannot pass.
6. **A legacy cut keeps physical source seconds across an interior tempo event (#645 `e2795259dc`, #5495).**
   Selected-range deletion advanced the right survivor's offset in beats: a beat-only clip over beats 0-8 at
   120 BPM through beat 2, then 60 BPM, enters source second 3 at beat 4; deleting beats 1-4 reinterpreted the
   four-beat offset at 60 BPM and entered second 4. Cut through selected UI and global Command routes and
   compare offline/native playback projection before and after (first source frame, exclusive ending,
   stretch, finite loop phase). Reopen the binary project: Undo restores exact optional-field absence, Redo
   identical physical source, global typed history replays after saved-session rehydration (selected callback
   history is the separate #5126 obligation). A source-cut helper returning no fields because canonical
   seconds are absent must fail; keep strict malformed-present-source refusals and unaffected-peer satellite
   admission while a valid legacy cut captures its source under the clock that existed before deletion.
7. **The first raw composite publication keeps a fractional source second (Automerge 3.5.0 bulk hydration,
   upstream `4d2a8f6`).** Bulk hydration infers an integer when a positive rounded value is within
   `f64::EPSILON` and casts the original, so `0.9999999999999999` became integer zero on a newly inserted or
   relocated source row (strict Undo then refused) while editing the same field on an existing row passed.
   Exercise nested map assignment, collection replacement, new entity insertion and an actual row move through
   reconciliation, then save/load: the exact fraction in raw source fields and unchanged peer object IDs and
   fields. Keep direct scalar edits, ordinary fractions, integers and negative-zero controls (rewriting every
   numeric leaf through scalar assignment loses the bulk path's negative zero); inspect only just-assigned
   composites and actually inserted rows; an unchanged root or peer tuple is not this write's to inspect. Preserve
   per-row conflicts and changed-owned-row identity in the existing concurrent storage probes. This prevents
   corruption on those accepted future publications. It neither repairs already-truncated data nor claims a
   general repair for every numeric input or every direct dependency import route. Do not round the producer,
   relax strict source snapshots, or put Float64 wrapper objects into bulk payloads.
8. **Recording birth evidence comes from the first-publication receipt.** An outer storage scope does not
   hold `startRecording` unpublished: its own transaction publishes clip and take together, so a later identical
   peer append tests duplicate detection, not the first-publication predicate. Probe through the real recording
   observer and public receipt/CRDT seam with zero matching raw rows before and exactly one after, the owned
   receipt and bound incarnation, and paired owned/foreign publications; removing only the owned-birth check
   must fail the foreign case. A named recreation case changes the Automerge object ID while preserving
   geometry; a rectangle edit retains it. Assert each mutation occurred before reading a rejected tempo command
   as ownership evidence.
9. **A left trim moves the raw owner's canonical entry, not only the comp programme.** A selected comp
   snapshot can keep audible source correct while the raw clip's entry stays at its old head. Trim a canonical
   .1-second entry from beat 1.5 to 1.75 under 120 BPM: the owner entry becomes .225 seconds and the exclusive
   source ending stays .35 seconds, through the real gesture, preview and typed save/reopen Undo/Redo; updating
   legacy beats alone must fail. Cover exact optional-field restoration, signed pre-roll, bounded stretch and
   finite or implicit loops whose first entry differs from later H/W entries. Captured Undo state follows the
   `restoreClip` trust boundary: validate a lawful captured before-state, its exact forward projection, the
   paired history actions and current retained-owner authority. Reject malformed or mismatched retained tuples
   and wrong owners before writes; preserve unrelated clip facets, peer rows and independent comp anchors. A later
   audible fragment does not authenticate a first entry discarded across a seam.
10. **Saved split history authenticates its source window against the forward publication.** Paired history
    snapshots can agree on an invented source window. Corrupt both copies with finite valid source seconds
    (zero included), or replace their media, loop reset or pass origin while keeping the genuine forward proof;
    borrow a different real split's member and change only the entry ID as controls. Split through the real
    command, save the binary root and session mirror, reopen, Undo and Redo: the selected 48 kHz source frame
    and original loop reset hold through later publications and grouped tempo edits; a source or clock
    intervention before publication leaves the intervening root intact and publishes no source member, and a
    reported split success without its source effect publishes none. Removing historical source verification
    must fail the paired finite-source corruption case. A late take retirement proof does not attest the split's
    window. Keep the unmodified beat-only audio fixture emitted by Undo5812 as a compatibility control: wholly
    beat-only history keeps that producer's law, and complete removal of every modern field, marker and proof
    remains the declared legacy ambiguity; these checks do not establish arbitrary history authenticity or
    classify erased and renamed events. Keep that characterization separate from the historical fixture and from
    positive modern source authentication.
