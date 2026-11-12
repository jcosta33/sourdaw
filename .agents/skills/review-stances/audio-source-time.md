# Standing probes: audio source time

Defects where a reader, edit or publication selects a different audio source sample than playback does. An
offset stored in beats names a position in an audio source only after the clip-start tempo converts it to
seconds; a project base tempo is insufficient when a tempo-map change precedes or lands at the clip start. Live
and offline playback use the clip-start tempo, and every source reader, edit helper, inverse and saved history
entry must agree with them to the exact source frame. Tempo projection to automation and scheduler terminal
bindings is `audio-timing-format-laws.md` probe 1. Each probe names the input, the check that must go red and
the mutation that must fail it. Report the concrete break or none.

## Standing probes

1. **Every source reader converts at the clip-start tempo (#4570, #1109).** Flat-tempo fixtures pass a reader
   that converts at the project base tempo. Set project tempo to 120 BPM, place an instant 90 BPM change at an
   offset-bearing clip's start, and put a transient at the source sample playback seeks. Compare the exact
   waveform peak sample requests in Canvas and GPU rendering, the Strip Silence scan and its audible fragments
   within that flat tempo region, the transcribed audio-to-MIDI onset and the zero-crossing target with live and
   offline playback. Then change only the tempo map and require cached waveform models to refresh; drag-preview
   the clip across the change and require its projected source window to change. Include zero and negative
   offsets so pre-roll is retained. Converting any reader at the base tempo must fail its parity case. A change
   inside the clip's audible span needs integrated source-to-timeline mapping and separate edit-history review;
   a clip-start conversion alone does not prove it.
2. **Source geometry survives storage hydration (#2169).** Publication normalizes an unsupported tempo (600 BPM
   becomes 120 BPM), so a fixture at that tempo disagrees with the published project once a storage flush exposes
   hydration. Exercise the analysis path through the real storage flush and hydration with supported geometry
   (300 BPM at 50 Hz: one beat is exactly 10 samples) and require the same source-frame window and Strip Silence
   fragments before and after hydration. An unsupported-tempo fixture cannot stand in for a source-time probe.
3. **Crossfade preserves a negative media origin (#4236, #4987).** A negative `audioOffsetBeats` is a valid
   recording result; a zero clamp in crossfade compensation turns a clip at beat 4 with offset -1, unity stretch
   and a one-beat crossfade into offset 0 with no pre-roll movement. Seed a recording-shaped negative-offset clip,
   crossfade through the real use case and the registered handler through Command and real Undo/Redo, inspecting
   the captured inverse and redo with authoritative document and store state: the signed offset and media origin
   survive, for unity and stretched clips with present and absent loop anchors. Reinstating either consumer's
   zero clamp must fail its own forward or history assertion; keep positive-offset, zero-offset, stretch and
   loop-region controls.
4. **A local-tempo inverse converges across a complete excursion (#4987).** An unbracketed inverse in
   `renderTempoTimeline` alternates between segments on a 180 to 60 to 180 BPM excursion at beats 0.25 and 0.5
   and maps a source ending at frame 8320 to frame 320. Invert that map through the real render callback at
   48 kHz, then resolve the same finite captured pass through live and offline readers with comp entry at beat
   zero and inside the slow segment: exact exclusive ending at frame 8320 and last audible frame 8319, stretched
   playback included. Restoring only the unbracketed inverse must fail the owning inverse spec and the reader
   parity spec; keep zero and negative-time probes so the repair cannot drop run-up.
5. **An integrated prefix landing on a frame boundary keeps the exact frame (#263, #2078).** A segment
   integrator without compensation gives, for instant changes of 120 BPM at beat 0, 240 at 0.25 and 120 at 0.45,
   `S(0.5) = 0.19999999999999998`, so source entry `-0.1 s` selects frame 4799 at 48 kHz instead of 4800
   (changing multiplication order alone stays wrong). Split through the registered action at beat 0.5 and require
   raw and projected source entry `0.1 s` / frame 4800 through binary reopen, Undo and Redo. Removing only the
   compensation must fail at frame 4799; keep a genuinely fractional-frame endpoint, negative pre-roll and its
   inverse, and a constant-tempo linear segment so rounding or a substituted source clock cannot pass.
6. **A legacy cut keeps physical source seconds across an interior tempo event (#645, #5495).** Advancing the
   right survivor's offset in beats reinterprets it under the post-deletion clock: a beat-only clip over beats
   0-8 at 120 BPM through beat 2, then 60 BPM, enters source second 3 at beat 4; deleting beats 1-4 must keep
   second 3, not enter second 4. Cut through selected UI and global Command routes and compare offline and native
   playback projection before and after (first source frame, exclusive ending, stretch, finite loop phase).
   Reopen the binary project: Undo restores exact optional-field absence, Redo the identical physical source,
   and global typed history replays after saved-session rehydration (selected callback history is #5126). A
   source-cut helper returning no fields because canonical seconds are absent must fail; keep strict
   malformed-present-source refusals and unaffected-peer admission while a valid legacy cut captures its source
   under the clock that existed before deletion.
7. **The first raw composite publication keeps a fractional source second.** Automerge bulk hydration infers an
   integer when a positive rounded value is within `f64::EPSILON` and casts the original, so
   `0.9999999999999999` becomes integer zero on a newly inserted or relocated source row (strict Undo then
   refuses) while editing the same field on an existing row passes. Exercise nested map assignment, collection
   replacement, new entity insertion and an actual row move through reconciliation, then save/load: the exact
   fraction in raw source fields and unchanged peer object IDs and fields. Keep direct scalar edits, ordinary
   fractions, integers and negative-zero controls (rewriting every numeric leaf through scalar assignment loses
   the bulk path's negative zero); inspect only just-assigned composites and actually inserted rows. Preserve
   per-row conflicts and changed-owned-row identity in the existing concurrent storage probes. The guard covers
   future publications only; it does not repair already-truncated data. Do not round the producer, relax strict
   source snapshots, or put Float64 wrapper objects into bulk payloads.
8. **Recording birth evidence comes from the first-publication receipt.** An outer storage scope does not hold
   `startRecording` unpublished: its own transaction publishes clip and take together, so a later identical peer
   append tests duplicate detection, not the first-publication predicate. Probe through the real recording
   observer and public receipt/CRDT seam with zero matching raw rows before and exactly one after, the owned
   receipt and bound incarnation, and paired owned and foreign publications; removing only the owned-birth check
   must fail the foreign case. A recreation case changes the Automerge object ID while preserving geometry; a
   rectangle edit retains it. Assert each mutation occurred before reading a rejected tempo command as ownership
   evidence.
9. **A left trim moves the raw owner's canonical entry, not only the comp programme.** A selected comp snapshot
   can keep audible source correct while the raw clip's entry stays at its old head. Trim a canonical .1-second
   entry from beat 1.5 to 1.75 under 120 BPM: the owner entry becomes .225 seconds and the exclusive source
   ending stays .35 seconds, through the real gesture, preview and typed save/reopen Undo/Redo; updating legacy
   beats alone must fail. Cover exact optional-field restoration, signed pre-roll, bounded stretch and finite or
   implicit loops whose first entry differs from later entries. Captured Undo state follows the `restoreClip`
   trust boundary: validate a lawful captured before-state, its exact forward projection, the paired history
   actions and current retained-owner authority. Reject malformed or mismatched retained tuples and wrong owners
   before writes; preserve unrelated clip facets, peer rows and independent comp anchors. A later audible
   fragment does not authenticate a first entry discarded across a seam.
10. **Saved split history authenticates its source window against the forward publication.** Paired history
    snapshots can agree on an invented source window. Corrupt both copies with finite valid source seconds (zero
    included), or replace their media, loop reset or pass origin while keeping the genuine forward proof; borrow
    a different real split's member and change only the entry ID as controls. Split through the real command,
    save the binary root and session mirror, reopen, Undo and Redo: the selected 48 kHz source frame and original
    loop reset hold through later publications and grouped tempo edits; a source or clock intervention before
    publication leaves the intervening root intact and publishes no source member, and a reported split success
    without its source effect publishes none. Removing historical source verification must fail the paired
    finite-source corruption case. A late take retirement proof does not attest the split's window. Keep the
    unmodified beat-only `Undo5812` fixture in `clipSessionMirrorRoundTrip.spec.ts` as a compatibility control:
    wholly beat-only history keeps its producer's law, and complete removal of every modern field, marker and
    proof is the declared legacy ambiguity; these checks do not establish arbitrary history authenticity.
11. **A whole-source Reverse preserves the cyclic source window (#3288, #6069, #6077).** A linear whole-buffer
    mirror is wrong for a looped span. At 48 kHz, use nonperiodic eight-second PCM, a clip over beats 0–5 at
    60 BPM, entry 0 and period 4: its last audible frame is 47999, while the linear mirror reads 239999. Refuse
    before allocation, cache, clip, analysis or history effects and tell the musician to bounce the loop first.
    Preserve a lawful complete-period positive through raw Command, exact PCM, provenance and repeated Undo/Redo.
    An advanced anchor alone is no oracle: entry 1, period 4 and pass origin 1 over beats 1–5 is a continuous
    complete period. Also test retained handles: entry 0, period 4 with visible span 2 and duration 8 mirrors the
    visible samples at entry 6, but an unchanged four-beat repeat would reach source 10 beyond the buffer. A
    visible-span-only admission must fail that extension probe.
12. **Both selected-bounce survivors retain canonical source authority (#621, #5888).** A survivor branch that
    advances only the beat alias diverges from physical source seconds. At 60 BPM, bounce beats 2–6 from a
    canonical loop [0, 10) with entry 1, period 4 and origin 0, and repeat with the selection beginning at 0 to
    enter the other branch. The right survivor must read source 3 at beat 6 and reset to 1 at beat 8. Compare the
    actual common reader and kept outside/left material, source PCM and real callback Undo/Redo; changing either
    branch back to the beat-only advance must fail its own case. Preserve the looping-MIDI carry and
    row-partition law rather than restamping all fragments. A shortened audio left survivor must retain an
    implicit original period: exercise spanning and left-crossing branches, extend the survivor through the
    original repeat boundary, and require its original source entry. Undo restores exact optional-field absence;
    nonlooping clips gain no loop metadata.
13. **A held render authenticates the source it sampled through publication (#226).** A source-blind
    await-then-write lets an old render publish over a newer source. Hold a real typed Bounce or Consolidate while
    a public same-ID clip slip commits: the newer raw source, projection and history survive, with no cache or
    callback publication from the old render. Source or tempo edits followed by a restoration still invalidate
    the sample; a same-bytes replacement root is a different authority. Preserve unrelated peer name, selection
    and save writes. Include actual sidechain, send and child source contributors and global compensation
    dependencies, detach material object and publication facts rather than comparing a live cache to itself, and
    hold a late source intervention at the actual commit boundary. Refusal publishes no callback or material; a
    committed ambiguous result retains exactly the material and inverse it published. This does not establish audible DSP or transient per-device
    preview state (#6305).
14. **Reverse captures optional beat-alias presence (#3288).** An inverse producer using
    `audioOffsetBeats ?? 0` turns unset into 0. A canonical WAV import can carry source seconds with no beat
    alias. Reverse it, then run actual Command Undo/Redo twice: absent returns absent, explicit 0 remains present
    0, and nonzero restores exactly alongside source, fades and analysis. Modern inverses need an explicit
    present/value capture; an older restore payload that omits the alias still means leave live, not delete.
    Reject malformed capture unions at serialized argument admission. A default-zero fixture or an equality that
    drops absent keys cannot prove this contract.

## Relocated

- Queued loop passes keeping their own media authority across a main-thread stall (#6277): merged into
  `audio-timing-format-laws.md` probe 13.
