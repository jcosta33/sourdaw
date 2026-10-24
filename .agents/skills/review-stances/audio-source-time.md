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
