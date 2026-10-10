# Audio source time

An offset stored in beats names a position in an audio source only after the
clip-start tempo converts it to seconds. A project base tempo is insufficient
when a tempo-map change precedes or lands at the clip start. Live and offline
playback already use the clip-start tempo; every source reader must agree.

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

## Recording terminal parity

Drive both manual recording and automatic punch through the real scheduler,
recording finalizer, Arrangement commit, Command history, and CRDT. Begin capture
inside a nonzero loop, let the scheduler emit two wraps and stage their source
depths, then move punch-out inside the loop. Select the second pass from the loop
start and read its resolved buffer at a known PCM frame. Assert the clip's media
origin, paired pass anchor and depth, raw document/store agreement, and one real
undo/redo unit. A mocked commit cannot prove source placement.

Hold capture completion across Stop's published-clock reset and a tempo-map or
latency change. Correlate producer sample zero with the immutable admission
beat/context pair and per-track latency; callback time, the store's resting
playhead, and the scheduler's look-ahead position cannot identify sample zero.

## Recording capture escape

PR #4987, landed as `62a116ee0073b1cb62d7c8ebf239b3cd93524533`, made
`commitRecording` place audio clips and loop passes only when its caller supplied
capture timing. It wired the manual terminal but left the automatic punch
terminal's one-argument call unchanged. The connected #5050 reproduction passed
manual recording while punch placed a selected second pass at beat 10 instead of
loop start 8 and sought source second 1 instead of 1.1. The missed review
obligation was capture-origin parity across audio terminals: manual placement
coverage and a scheduler test with a mocked commit did not observe the automatic
terminal's actual comped source.

## Captured pass timing across terminal waits

Hold the audio terminal after two loop passes at 120 BPM, Stop near beat 11,
change tempo to 60 BPM, then release the terminal and select the second pass
from loop start 8. The source seek must still address the captured lap: 1.1 s
with 100 ms latency after admission at beat 10, sample 52800 at 48 kHz. Read
paired pass fields, actual selected PCM, raw CRDT/project projections, and real
Undo/Redo for both manual and punch terminals. Changing timeline placement must
not reconstruct a captured pass's physical depth from the later tempo map.

The first pass can begin at the record point or after a run-up; a staged pass
ends at the scheduled or late-wrap seam, while a later pass starts at the
previous seam. Review the producer clock for each, and retire witnesses by
recording identity on commit or discard so a stale terminal cannot affect a
successor. Hold recorder permission and native transport admission while changing
tempo, then advance context time after rolling begins but before the awaiting
continuation resumes. The first pass must use the scheduler's actual published
rolling beat/context pair and its roll-time map, rather than callback time or a
map frozen before the hold. Keep the probe's worker tick below the scheduler's
ordinary advancement cap, or account separately for its delayed physical seam.
PR #4987 introduced completion-time depth conversion; the #5050
review of PR #5165 initially checked only sample-zero origin after the tempo
edit. It missed selection of a later pass, which sought 7.1 s rather than 1.1 s.

## Recording starts on either side of roll and editable first entry

Hold the real recorder worker ready until after the native transport rolls,
then drive the first nonempty recording processor block at a known
`currentFrame`. With roll at context second 50.2 / beat 10, sample zero at
50.4, latency 0.1, and stop at 50.6 at 120 BPM, retained PCM must span beats
10.2–10.6. The existing one-beat carrier minimum (#4994) ends that short clip
at 11.2; it cannot fabricate PCM beyond the measured sample count.
A prepared recorder's successful boolean can precede that input;
placement must retain the signed sample-zero-to-roll distance, not clamp it.

Begin capture at beat 6 with loop [8, 12], let beat 8 sound, and move the loop
start to 10 before beat 10 or the first wrap. Select the first pass at beat 10:
its source depth must be 2.1 seconds with 0.1-second latency, not the old entry's
1.1 seconds. A backwards edit that the scheduler reports as a relocation
uses that receipt's physical clock, never a reconstructed past crossing.
After a seam actually sounds, an entry edit cannot redate the completed pass.
Check the selected PCM, raw document/store agreement, and one Undo/Redo.
The PR #5165 review initially covered edits before the old entry and capture
before roll; it missed both late first input and an edit after the old entry
but before the first completed seam.

The PR #5165 new-roll first-frame probe also missed Record joining playback:
that route has no `onRoll` callback. Probe both start routes through the real
first nonempty processor block, retaining the immutable playing beat/context
correlation across worker readiness and a tempo edit. Distinguish the short
clip's carrier from its actual sample count, and prove the same placement and
PCM survive real Command/CRDT Undo/Redo.

Drive both Record joining playback and automatic punch while the first input is pending across a sounded wrap.
Delay first input while Record joins beat 11.8 in loop [8, 12] at 120 BPM.
Drive the real scheduler through one and several sounded wraps before the
producer's first nonempty frame, then through another wrap after that frame.
With sample zero at beat 8.05 and 100 ms latency, media begins at beat 7.85;
linear projection from admission places it four beats late. Also publish the
first frame before a seam and sound a planned seam between the last tick and
Stop. Freeze the frame's traversal when its owner-bound producer witness first
becomes observable, retain only bounded unresolved correlations, and detach
readers on cancellation, failed admission, Stop and settlement. A cancelled
future seam is no receipt; every admitted seam retains its own destination.

First input can arrive after an old pass opened or completely ended. Trim its
uncaptured head, discard a pass with no captured span, and assert nonnegative
selected source depth, signed placement, raw/store equality and exact PCM.
After one completed pass, edit the loop entry from 8 to 10 at beat 8.2. The
completed pass keeps depth 1.1 s, while the new entry sounds at depth 4.1 s,
sample 196800 at 48 kHz. Reanchor only the open pass. The PR #5165 review had
held admission and checked first-entry edits, but missed a seam before sample
zero and an edited entry after a completed pass; neither admission projection
nor the most recent completed seam identifies those captures.

## Captured ending must bound uncomped playback

Stop an audio capture before a planned seam, keep the capture tempo unchanged,
and let the producer deliver excess PCM during its delayed drain. Read the
unselected base clip through real comp resolution and live source scheduling,
then prove its source stops at the frozen gesture ending. Repeat before any
planned seam and through automatic finalization. Assert the original buffer's
complete PCM is retained as an editable handle, one real Command/CRDT Undo/Redo
restores the same clip and takes, and completed passes still span their captured
loop geometry after the last lap wraps backwards. Preserve the deliberately
minimum-length carrier for short recordings separately from captured PCM.

The PR #4987 capture-origin escape recurred in PR #5165's automatic first-frame
route: manual relocation readers were wired, but automatic punch froze only the
admission pair. Its deferred-input probe must assert the base clip's first-media
origin as well as selected PCM; pass depth can be correct while base placement
is one traversal late. Trace every selected take to the pass it actually stages:
a scheduled seam ends the dying pass, rather than opening an incoming partial
lap. A source oracle for that nonexistent lap cannot prove this defect.

The pending-tail repair in PR #5165 bounded a take but left the base clip derived
from the entire delayed buffer. Its original check changed tempo during the
flush and never inspected uncomped playback. That omitted consumer, rather than
forwarded finalizer arguments or a green take-bound assertion, is the required
ending probe.

## A sounded final lap must own its captured tail

PR #5165's recorder fixture confused the continuous media's unwrapped end
with the loop carrier's end and omitted the final open lap. After a sounded
seam, Stop must retain a selectable take for the incoming lap's captured PCM,
bounded by both the producer extent and the frozen gesture. Prove the dying
and final takes separately through comp resolution and actual source scheduling,
including known first/last PCM frames and the recording's single Undo/Redo.
An unsounded or cancelled seam, or PCM ending before the incoming entry, must
create no phantom final lap. An empty sounded final lap must also retire its original provisional identity,
so that identity cannot duplicate the completed dying take in comp selection.
Keep ordinary first takes and unsounded planned replacement identities intact.
Initialize the same gesture-clock port as app
bootstrap and drive settled ticks to Stop; a stale beat paired with a later
context time is not an ending receipt. The deliberate minimum carrier and
physical producer cutoff remain a separate obligation.

## Equal tempo projection must preserve a sounded seam

Commit `7de4d3ddd9018c9e766ea1d801aeadf927f3cee2` treated every replacement
tempo-map array as an edit. PR #4897 later made a pending loop seam carry the
recording pass boundary. Together, an equal-valued CRDT re-projection could
tear down that already-sounded seam and stage a positive-depth final take from
an empty lap.

While a real recorder crosses a loop seam, flush the production projection's
deferred animation-frame callbacks and prove the ordered tempo entries remain
equal even though their array identity changes. Stop just after the seam and
assert there is no final take beyond the measured PCM, while the dying pass
remains selectable through source scheduling and Command/CRDT Undo/Redo.
Changing an entry's id, beat, tempo, or curve, and changing the loop region,
must still invalidate and re-anchor the pending seam.

## Effective tempo before first input and completed-pass source extent

PR #5165's admission reader retained the original tempo integration even while
a pending first input crossed a seam sounded under a new tempo. Its original
#4987 capture placement and later #5050 repair controls froze post-frame timing,
but omitted effective pre-frame edits on both manual and automatic admission.
Change tempo through Command while input is pending, then assert the sounded
traversal's media origin and selected source frame; repeat before any seam and
with an unresolved producer publication. Frozen first frames remain immutable.
An effective tempo epoch's placement anchor can precede the edit itself. Probe
a first frame between those instants before its first observer runs; captured,
torn and not-yet-admitted readers must reject the later epoch, while a pending
frame after the edit adopts it. A loop seam uses its actual sounding instant.

A seam completing a pass is not proof that its whole musical extent has PCM.
Begin Record at beat 10/context 51 at 120 BPM, deliver sample zero at 51.6
with 100 ms admission latency, retain 0.4 seconds, sound the seam at 52, and
Stop during an empty incoming lap. The retained pass ends at beat 11.8;
beat 11.9 must not select source second 0.45 from a 0.4-second buffer. Trace
each retained extent through the same conversion the comp reader uses.

PR #5165 introduced the missing per-pass source end in its physical placement
repair (`4322a209206`), while its admission reader freeze (`c40c02ac255`) left
pre-PCM effective tempo edits on the old coordinate system. The source-time
stance escaped both by observing starts and current tails without selecting a
completed tail after empty incoming PCM. A retained audio pass needs an exclusive end in its own recorded source, as well as
its media-relative anchor and depth. Intersect the sounded pass ending, frozen
intended terminal and real producer extent before commit. Check that selecting a
completed pass after an empty final lap never seeks a successor or unavailable
frame. Move, slip, trim, tempo projection, hydration and replay must carry this
source interval; static take geometry alone cannot bound those readers. A later
tempo conversion must not grow the original recording carrier past its intended
ending, and excess producer drain is not permission to extend a take.
