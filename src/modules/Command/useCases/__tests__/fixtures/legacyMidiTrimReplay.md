# Historical trim replay fixtures

These synthetic document/session pairs were produced by revision
`50e61f334eb3902aa3fa0eab97e8ac63d6bd0e56`, the first parent of the #5578
capture-field change. Its original `handleTrimClipStart.describe` naturally
records the old start and anchor without `midiOffsetBeats`.

The producer initialized a real CRDT root, registered the production command
handlers, executed the listed actions through `executeAppAction`, persisted
through `persistCrdtProject`, and exported the actual IndexedDB document bytes
and witness-stamped `sourdaw-undo-session` value. No modern inverse field was
removed. The test checks each document's SHA-256 before loading the records
through the current persistence and production hydration paths.

The JSON fixture uses base64 only as a lossless transport for the exported
document bytes. The session mirror strings and action payloads are unchanged.
The cases cover duration-derived and configured loops, loop-off MIDI,
audio, and zero-distance trims from normalized and unnormalized offsets.
A session undo mirror is separate from a `.sdaw` document; opening a `.sdaw`
alone does not supply these history entries.

The `unnormalized-zero` case slips to offset 8 while looping is off, enables
an eight-beat loop, then trims at the unchanged start. That forward trim wraps
offset 8 to 0 and translates notes 0/1/2/3 to -8/-7/-6/-5, with controller
and pitch-bend beats moving from 0 to -8. Its original document bytes and
mirror were exported by the same historical revision. The saved mirror
retains only the trim entry although all listed setup commands ran. Hydrated
entry counts come from the actual saved mirror, never the setup action count.

A normalized current phase does not authenticate the pre-trim offset, even
when the start did not move. Both historical zero-distance looped MIDI cases
therefore require conservative refusal with pending history and every raw
coordinate unchanged. The current loop mode cannot authenticate the original
mode either: a peer may disable looping after the old trim displaced its rows.
All legacy MIDI trim inverses without an offset capture therefore refuse,
including the independently produced loop-disabled control. Current trims
capture the prior offset, including zero
and an unnormalized whole-loop offset, so their Undo and Redo restore exact
stored coordinates. Historical audio entries retain replay.

Historical source hashes (SHA-256):

- `src/modules/Arrangement/handlers/clip/handleTrimClipStart.ts`:
  `2cdd52eac8bdec5e1576bd393c4b99b0986904f3f1e27d1c526366788ce0aee5`
- `src/modules/Arrangement/useCases/clipEditing/trimClipStart.ts`:
  `3ed509866285fc250c7ef4791f3d2639c85a8cec077b329de935b914460e470b`

Trim and slip handlers in this producer are singletons. Supplying a group ID
does not produce a saved group; `executeAppAction` deliberately omits that
metadata. The internal `restoreClip` and `restoreClipLoop` contracts are also
absent from the production session mirror registry at that revision. These
fixtures therefore establish persisted singleton replay, not saved grouped
restore-prefix admission.
