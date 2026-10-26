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
The five cases cover duration-derived and configured loops, loop-off MIDI,
audio, and zero-distance trim. A session undo mirror is separate from a `.sdaw`
document; opening a `.sdaw` alone does not supply these history entries.

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
