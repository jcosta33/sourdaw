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
