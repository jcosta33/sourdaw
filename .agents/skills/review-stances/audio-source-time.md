# Audio source time

An offset stored in beats names a position in an audio source only after the
clip-start tempo converts it to seconds. A project base tempo is insufficient
when a tempo-map change precedes or lands at the clip start. Live and offline
playback already use the clip-start tempo; every source reader must agree.

## Escape: Strip Silence fixture changed source geometry after hydration (PR #2169)

PR #2169 (`bfbf1dd69b18c2a843472a04815ccab773a4b364`) introduced a Strip Silence fixture at
600 BPM; real publication normalizes that tempo to 120 BPM. A macro pre-step storage flush made
the real hydration path observable and exposed that fixture-time source geometry did not match
the published project state. The missed risk was source-clock equivalence after storage hydration.

Exercise the analysis path through the real storage flush and hydration with supported geometry:
at 300 BPM and 50 Hz, one beat is exactly 10 samples. Require the same source-frame window and
Strip Silence fragments before and after hydration. Keep the clip geometry real; the unsupported
600 BPM fixture cannot stand in for a valid source-time probe.

## Standing probe

Set project tempo to 120 BPM, place an instant 90 BPM change at an offset-bearing
clip's start, and put a transient at the source sample that playback seeks.
Compare the exact waveform peak sample requests in Canvas and GPU rendering,
the Strip Silence scan and resulting audible fragments within that flat tempo
region, the transcribed MIDI onset, and the zero-crossing target with live and
offline playback. Then change only the tempo map and verify cached waveform
models refresh; drag-preview the clip across the change and verify its projected
source window changes. Include zero and negative offsets so pre-roll is retained.

## Escape

PR #4570 made audio-to-MIDI honor trimmed source windows but converted the
offset with the project base tempo. Earlier waveform and Strip Silence readers
did the same; PR #1109 made tempo maps govern the transport without requiring
these readers to match. The missed review stance was source-entry parity across
the same offset-bearing clip at a nonbase clip-start tempo. Flat-tempo fixtures
could pass while the waveform, analysis, and edit helpers inspected different
source samples than playback. A change inside the clip's audible span requires
integrated source-to-timeline mapping and separate edit-history review; a
clip-start conversion alone does not prove that case.

## Crossfade must preserve a negative media origin

PR #4236 added crossfade source-offset compensation with a zero lower bound.
PR #4987 later made negative `audioOffsetBeats` a valid recording result when
its clip begins before captured media. That producer transition made the old
consumer clamp incompatible: a clip at beat 4 with offset -1, unity stretch,
and a one-beat crossfade gets no pre-roll movement, then its offset becomes 0,
shifting the media origin. Historical reviewer prompts are unavailable, so
which exact stance was missing or mis-prompted cannot be established.

Probe: seed a recording-shaped clip with a negative offset, crossfade through
the real use case, and require the signed offset and media origin to survive.
Include unity and stretched clips with present and absent loop anchors. Dispatch
the registered handler through Command and real Undo/Redo, inspecting its
captured inverse and redo along with authoritative document and store state.
Reinstate either consumer's zero clamp independently; its own forward or
history assertion must fail. Keep positive-offset, zero-offset, stretch, and
loop-region controls to distinguish source preservation from geometry changes.

## Escape: inverse convergence across a short tempo excursion

PR [#4987](https://github.com/jcosta33/sourdaw/pull/4987), merged as
`62a116ee0073b1cb62d7c8ebf239b3cd93524533`, introduced the unbracketed
local-tempo inverse in `renderTempoTimeline`. A 180 to 60 to 180 BPM excursion
at beats 0.25 and 0.5 alternated between segments and mapped a source ending
at frame 8320 to frame 320. The public approval described tempo-map attacks;
the exact historical stance, prompt and tier are unestablished. The missed
failure mode was convergence when a local step crosses a complete excursion.

Invert that map through the real render callback at 48 kHz, then resolve the
same finite captured pass through live and offline readers with comp entry at
beat zero and inside the slow segment. Require the exact exclusive ending at
frame 8320 and last audible frame 8319, including stretched playback. Restoring
only the unbracketed inverse must fail the owning inverse spec and reader parity
spec. Keep zero and negative-time probes so convergence repair cannot drop run-up.

## Escape: short tempo segments lost an exact source frame

The segment integrator introduced by PR [#263](https://github.com/jcosta33/sourdaw/pull/263)
and used for shared scheduling by PR [#2078](https://github.com/jcosta33/sourdaw/pull/2078)
accumulated durations without compensation. Instant changes of 120 BPM at beat
0, 240 at 0.25, and 120 at 0.45 produced `S(0.5) = 0.19999999999999998`.
Adding source entry `-0.1 s` selected frame 4799 at 48 kHz instead of 4800.
Changing segment multiplication order alone remained insufficient. The missed
input was an integrated prefix landing exactly on a source-frame boundary;
historical review prompt, model, and tier are unestablished.

Use that map and signed source entry, split through the registered action at
beat 0.5, and require raw and projected source entry `0.1 s` / frame 4800
through binary reopen, Undo, and Redo. Remove only the compensation and require
this probe to fail at frame 4799; a passing unmutated suite does not establish
that discrimination. Retain a genuinely fractional-frame endpoint, negative
pre-roll and its inverse, and a constant-tempo linear segment so the repair
cannot pass by rounding or substituting another source clock.

## Escape: legacy cut source entry crossed an interior tempo event

PR [#645](https://github.com/jcosta33/sourdaw/pull/645), merged as
`e2795259dc52842a7cecb04a6655ba9d8dec7e68`, introduced selected-range deletion
with a right survivor's source offset advanced in beats. PR #5495 carried that
law forward. A beat-only clip spanning beats 0–8 at 120 BPM through beat 2,
then 60 BPM, enters source second 3 at beat 4. Deleting selected beats 1–4
retained beat 4 but reinterpreted its advanced four-beat offset at 60 BPM,
entering source second 4. The missed probe was physical source seconds across
an interior tempo event for a legacy live cut; flat-tempo geometry and loop
phase assertions could pass. Historical prompt, model and tier are unestablished.

Cut the same source through selected UI and global Command routes. Compare the
actual offline/native playback projection before and after, including first
source frame, exclusive ending, stretch and finite loop phase. Reopen the binary
project and require exact original optional-field absence on Undo and identical
physical source on Redo. Global typed history must replay after saved-session
rehydration; selected callback history remains the separate #5126 obligation.
A source-cut helper that returns no fields merely because canonical seconds are
absent must fail this probe. Keep strict malformed-present-source refusals and
unaffected-peer satellite admission controls while allowing a valid legacy cut
to capture its source under the clock that actually existed before deletion.

## Escape: first composite publication changed a fractional source second

The inherited dependency defect is present in Automerge 3.5.0 bulk hydration at upstream commit
[`4d2a8f6`](https://github.com/automerge/automerge/blob/4d2a8f6bfecfb7f1e4fca126e6d2122ac526f903/rust/automerge-wasm/src/interop.rs#L1148-L1153)
infers an integer when a positive rounded value is within `f64::EPSILON`, then
casts the original value. The finite noninteger `0.9999999999999999` becomes
integer zero. The native scalar proxy instead supplies an explicit f64 datatype
and preserves its bits. Inserting or relocating a newly canonicalized source
row could therefore change its first sample and make strict Undo refuse, while
editing the same field on an existing row passed. Its first affected Sourdaw
action is unestablished. The missed probe was the first
raw composite publication, rather than producer arithmetic or binary load alone.

Exercise nested map assignment, collection replacement, new entity insertion
and an actual row move through reconciliation, then save/load. Require the exact
fraction in raw source fields and unchanged peer object IDs/fields. Keep direct
scalar edits, ordinary fractions, integers and negative-zero controls: rewriting
all numeric leaves through scalar assignment loses the bulk path's negative
zero. Only just-assigned composites and actually inserted rows are this write's
to inspect; an unchanged root or peer tuple is not. Preserve per-row conflicts
and changed-owned-row identity in the existing concurrent storage probes.

This prevents corruption on those accepted future publications. It neither
repairs already-truncated data nor claims a general repair for every numeric
input or every direct dependency import route. Do not round the producer, relax
strict source snapshots, or put Float64 wrapper objects into bulk payloads.

## Recording ownership probe preconditions

A recording birth probe must show the raw matching-row count before and after
publication, the actual owned receipt and the bound incarnation. An outer
storage scope does not hold startRecording unpublished: its own transaction
publishes clip and take together. A later identical peer append therefore tests
duplicate detection, not the first-publication receipt predicate. Probe that
predicate directly through the real recording observer and public receipt/CRDT
seam, with zero matching raw rows initially, exactly one afterward, and paired
owned/foreign publications. Removing only the owned-birth check must fail the
foreign case. A named recreation case must change the Automerge object ID while
preserving geometry; a rectangle edit must retain the ID. Assert each mutation
occurred before interpreting a rejected tempo command as ownership evidence.

## Trim owner and captured replay

A selected comp snapshot can keep the audible source correct while a left trim
leaves the raw clip's canonical entry at its old head. Assert both the raw owner
and its independent comp programme. Trim a canonical .1-second entry from beat
1.5 to 1.75 under 120 BPM: the new owner entry is .225 seconds and the exclusive
source ending stays .35 seconds. Exercise the real gesture, preview and typed
save/reopen Undo/Redo; updating legacy beats alone must fail.

Probe exact optional-field restoration, signed pre-roll, bounded stretch and
finite or implicit loops whose first entry differs from later H/W entries.
Captured Undo state follows the existing restoreClip trust boundary: validate a
lawful captured before-state, its exact forward projection, the paired history
actions and current retained-owner authority. Do not pretend the later audible
fragment authenticates a first entry deliberately discarded across a seam.
Reject malformed or mismatched retained tuples and wrong owners before writes,
and preserve unrelated live clip facets, peer rows and independent comp anchors.

## Saved split source authority

Paired history snapshots can agree on an invented source window. Corrupt both
copies with finite valid source seconds, including zero, or replace their media,
loop reset or pass origin while retaining the genuine forward proof. Hydration
must compare the originating entry and source facets with the actual forward
publication before aliasing replay holders. Borrow a different real split's
member and change only the entry ID as independent controls. A proof of a late
take retirement does not attest the forward split's source window.

Split through the real command, save the binary root and session mirror, reopen,
Undo and Redo. Require the selected 48 kHz source frame and the original loop
reset through later ordinary publications and grouped tempo edits. A source or
clock intervention before publication must leave the intervening root intact
and publish no source member. A reported split success without its actual
source effect must also publish none. Removing historical source verification
must make the paired finite-source corruption case fail.

Keep the unmodified beat-only audio fixture emitted by Undo5812 as a compatibility
control. Wholly beat-only history retains that producer's law. Complete removal
of every modern field, marker and proof remains the declared legacy ambiguity;
these checks do not establish arbitrary history authenticity or classify erased
and renamed events. Keep that characterization separate from the historical
fixture and from positive modern source authentication.
