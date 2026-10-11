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

## Lesson from PR #826's numeric source-offset escape

Canonical source seconds need exact storage as well as correct arithmetic. PR #826 (`ec6a9c18f260536996af1c28f92be30636d33a62`) introduced composite writer routes that reach pinned Automerge 3.5's implicit numeric import; the upstream inference predicate itself was not introduced by that PR. A freshly imported offset of `0.9999999999999999` becomes zero before playback or strict Undo reads it. Fix `6e626aa2ecfbdbd062ee7d4a1d2b0c1471c24582` attaches empty containers before explicit scalar setters at both materialization terminals. Require exact raw, projected, binary-reloaded and unrelated-peer-merged source offsets through real storage. Restore both bulk-import terminals in an isolated committed probe and require `createAutomergeStorage.numericFidelity.spec.ts`'s exact-value cases to fail; plain-object mocks, rounded offsets and epsilon replay checks cannot carry this proof. This is an ordinary reconciler guarantee, not proof for custom raw callbacks or conflict repair (#5120).

## Lesson from #5048's comped split source-owner escape

Exercise sequential tempo and split children with the real tempo-source preparation port in both orders. The applied source plan and saved inverse/redo captures must describe the same current owner state, including canonical seconds introduced by an earlier child. Preserve the resolved seam while finalizing captures from the exact execution plan; a pre-batch geometry or take window cannot guard a later write after the earlier child changes it. Observe raw owner state and successful full replay, not only the forward seek.

The split-owner introduction at `c814389624bb16223b51dfee801ad265d2d94e4e` and comp-reader lineage at `e415a55cc406ba264dffbc229f4ac86f3e5caaab` have no associated PR in the commit-to-pulls lookup; the historical stance assignment is unknown. A split that only writes two clip rectangles can silence selected comp material because readers resolve each take inside the clip ID it names. At a tempo-changing seam, seed a nonzero clip entry and legacy or canonical take depth, then drive real Command and cut-tool routes. Observe live comp fragments and actual offline playback descriptors, not source counts: a clip `[2,8]`, seam 4, tempo 120→60, entry 0.5 s and take depth 1 s must retain seeks 1.5 s and 2.5 s on `[2,4]` and `[4,8]`. Partition at the actual zero-crossing result, resolve legacy take depth at the original clip start before rekeying, and treat canonical zero as authoritative over stale beat aliases. Remove the take partition in an isolated committed probe and require the right-side playback assertion to fail. Saved-session Undo/Redo, generated-right metadata and later right recordings need separate owner-state oracles; playback descriptors do not prove PCM output or hardware audio.
