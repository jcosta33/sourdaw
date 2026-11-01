# Lesson library: moving coordinate inverses

Defects where an edit changes the basis used to wrap, clamp, normalize or number coordinates (a duration-derived loop
length, a loop origin, a partial bar) and its recorded inverse, Redo, macro replay or live reader is computed against a
different basis than the one that produced the forward figures. Drive the real recorded Command inverse composed
with surrounding edits, on both inferred and explicitly configured bases, and assert raw stored figures (offsets,
every note, controller and pitch-bend beat) rather than audible relatives. A fixture that always configures the
normalization basis cannot cover a moving basis. Each probe names the input, the check that must go red and the
mutation that must fail it.

## Standing probes

1. **A trim inverse recomputed against a different loop length (#5022 `abee0c2e8e`, #5512).** #5022 wrapped the
   start-trim offset against the post-trim loop length and translated stored MIDI notes by the wrap distance; its
   fixtures configured `loopLength: 8`, but an inferred loop length comes from clip duration, which the trim
   changes, so the opposite trim normalized against another basis and a surrounding slip inverse could not reverse
   the displacement. For a duration-derived loop, slip left one beat, trim the start across a wrap boundary, then
   undo the trim and the slip; assert the captured raw offset and every note, controller and pitch-bend beat at the
   intermediate inverse boundary and after the complete undo/redo chain. Preserve unrelated rows, clip geometry and
   configured-loop behavior, and check scheduler admission too. Removing the inverse's captured offset, or reversing
   the restoring row translation, must fail the inferred-basis case on its raw figures while the explicit-basis
   control still describes its own preserved behavior.
2. **Finite captures overflow their derived row translation (#5578, pre-merge).** Finite current and captured
   offsets produced an infinite restoring displacement, and a finite displacement could overflow a finite note,
   controller or pitch-bend beat; sanitization then removed rows while the trim reported a write. Preflight the
   displacement and every translated row before either owner writes. Probe opposite finite extremes, then overflow
   each row type separately with a finite displacement: owner refusal, handler `conflict`, unchanged clip and all
   row types, with raw-document and history preservation through the real command wherever the fixture codec admits
   the input. Keep ordinary and zero captures, the configured-loop control and keyless replay intact.
3. **A legacy inverse without a coordinate capture is refused, not replayed (#5022, #5578).** Trim inverses produced
   before #5578 carry no `midiOffsetBeats`, and a loop phase cannot recover the discarded quotient or row
   displacement. Produce the old inverse with the real historical Command handler, keep its original document and
   session-history bytes, and hydrate through the current production reader: an unauthenticated MIDI inverse leaves
   the document, rows and pending history unchanged, with a warning. Zero distance is not proof: slip to an
   unnormalized whole-loop offset while looping is off, enable looping, then trim at the unchanged start (the
   forward trim can normalize the offset and translate every row); refuse both normalized and unnormalized legacy
   zero-distance inverses without a capture. The current loop mode cannot authenticate the old one: disable looping
   on the genuinely saved duration-derived case and require the same refusal with the peer state intact. Keep the
   original loop-disabled MIDI fixture as a conservative refusal control and audio plus current capture-bearing
   zero-distance Undo/Redo controls (zero and whole-loop captures). Removing replay admission must fail the unsafe
   historical case; deleting a capture field from a modern fixture cannot establish historical compatibility.
4. **A fresh macro command discards inverse restoration hints (#5495 `0f1e87dc8`, #5578 `e930f16eb`).** Public
   action-history reversion can record the slip inverse's `rowLiftBeats`, the trim inverse's `loopOriginBeat` and
   `midiOffsetBeats` into a macro, and verbatim playback applies the old restoration basis instead of a fresh
   command's current wrap and anchor laws. Record a real slip or trim and public history reversal, serialize the
   macro, then change an eight-beat loop to four beats; compare the full clip and every row with fresh public
   requests executed from the identical prestate. Repeat on the same basis, with looping disabled and on audio;
   include zero-valued restoration keys and an anchorless recording whose inverse carries `null`, followed by a
   current anchor. A fresh macro copy discards every restoration-only hint while preserving public request fields
   and stored macro bytes, and its own executed history still restores each before-figure exactly through saved Undo
   and Redo (fresh macro arithmetic is not dynamic Undo or a byte-exact net-zero promise). Leave coordinate captures
   stripped but restore scalar-hint forwarding: the unchanged fresh-producer comparisons must fail; an expected
   value computed from the old inverse displacement merely repeats the defect.
5. **Fractional row coordinates and reciprocal history captures restore exactly (#5495, #5578).** Integer fixtures
   missed floating-point loss: `0.1 + 8 - 8` is not the stored `0.1`. Require exact raw note, controller and
   pitch-bend figures through the real Command boundary on configured and duration-derived loops. Capture each
   executed translation by row identity; restore a saved number only while the current coordinate still equals the
   captured post-value; translate peer-moved and added rows keeping their current properties, and never recreate
   deleted rows. Plan every lane and finite displacement before either owner writes; a refused replay conflicts
   without consuming history. Undo refreshes the actual redo capture and Redo the actual inverse capture, peer edits
   before either direction included; persist and hydrate from both past and future, then repeat the cycle.
   Independently serialized captures need an owner-validated pair relationship (JSON keeps no aliases) that
   replay's discarded description must not detach. Failed commit compensation and owner abort rollback preserve the
   prior document, projections, history, tree and mirror; committed bookkeeping errors keep the capture matching the
   committed product. Mutate the exact-restoration branch, actual-counterpart refresh, hydration pair binding and
   abort metadata restoration independently: the connected fractional, peer-edit, saved-history and failed-commit
   cases must each fail; a pure planner round trip or integer-only fixture cannot.
6. **Partial-bar carries change the mounted ruler's basis (#5247; flat ruler `e415a55cc4`; carry lineage before
   #5440).** Insert 2 at 4 in 4/4 produces physical bar pieces at 0, 4, 6 and 10, the pieces at 4 and 6 both reading
   as bar 2; a distinct-bar inverse cannot enumerate the physical ruler, and a flat `bar * numerator` reader leaves
   bar 3 at 8 after its clip moves to 10. Reuse the meter model's segment origins and metrical walk, retaining each
   physical piece and its canonical number. Compose the actual recorded Command inverse and Redo with complete
   raw/projected map and clip snapshots and the same mounted reader: fresh post-operation paint figures in both
   directions, a downstream meter change and non-quarter denominators included. A correct initial mount cannot prove
   later basis changes; the flat-query and removed-subscription mutations must independently break geometry and
   freshness.
