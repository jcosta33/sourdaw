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
