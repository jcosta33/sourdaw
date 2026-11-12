# Standing probes: moving coordinate inverses

Defects where an edit changes the basis used to wrap, clamp, normalize or number coordinates (a duration-derived loop
length, a loop origin, a partial bar) and its recorded inverse, Redo, macro replay or live reader is computed against a
different basis than the one that produced the forward figures. Drive the real recorded Command inverse composed
with surrounding edits, on both inferred and explicitly configured bases, and assert raw stored figures (offsets,
every note, controller and pitch-bend beat) rather than audible relatives. A fixture that always configures the
normalization basis cannot cover a moving basis. Each probe names the input, the check that must go red and the
mutation that must fail it.

## Standing probes

1. **A trim inverse recomputed against a different loop length (#5022, #5512).** A start trim that wraps its
   offset against the post-trim loop length and translates stored MIDI notes by the wrap distance changes an
   inferred loop length (it comes from clip duration), so the opposite trim normalizes against another basis and a
   surrounding slip inverse cannot reverse the displacement; fixtures configuring `loopLength: 8` miss it. For a
   duration-derived loop, slip left one beat, trim the start across a wrap boundary, then undo the trim and the
   slip; assert the captured raw offset and every note, controller and pitch-bend beat at the intermediate inverse
   boundary and after the complete undo/redo chain. Preserve unrelated rows, clip geometry and configured-loop
   behavior, and check scheduler admission too. Removing the inverse's captured offset, or reversing the restoring
   row translation, must fail the inferred-basis case on its raw figures while the explicit-basis control still
   describes its own preserved behavior.
2. **Finite captures overflow their derived row translation (#5578).** Finite current and captured offsets can
   produce an infinite restoring displacement, and a finite displacement can overflow a finite note, controller or
   pitch-bend beat; sanitization then removes rows while the trim reports a write. Preflight the displacement and
   every translated row before either owner writes. Probe opposite finite extremes, then overflow each row type
   separately with a finite displacement: owner refusal, handler `conflict`, unchanged clip and all row types, with
   raw-document and history preservation through the real command wherever the fixture codec admits the input.
   Keep ordinary and zero captures, the configured-loop control and keyless replay intact.
3. **A legacy inverse without a coordinate capture is refused, not replayed (#5022, #5578).** A trim inverse that
   carries no `midiOffsetBeats` cannot be completed from loop phase, which cannot recover the discarded quotient or
   row displacement. Keep a saved capture-free inverse with its original document and session-history bytes, and
   hydrate through the current production reader: an unauthenticated MIDI inverse leaves the document, rows and
   pending history unchanged, with a warning. Zero distance is not proof: slip to an unnormalized whole-loop offset
   while looping is off, enable looping, then trim at the unchanged start (the forward trim can normalize the
   offset and translate every row); refuse both normalized and unnormalized zero-distance inverses without a
   capture. The current loop mode cannot authenticate the old one: disable looping on the saved duration-derived
   case and require the same refusal with the peer state intact. Keep the loop-disabled MIDI fixture as a
   conservative refusal control and audio plus capture-bearing zero-distance Undo/Redo controls (zero and
   whole-loop captures). Removing replay admission must fail the unsafe saved case; deleting a capture field from a
   modern fixture cannot establish historical compatibility.
4. **A fresh macro command discards inverse restoration hints (#5495, #5578).** Public action-history reversion
   can record the slip inverse's `rowLiftBeats`, the trim inverse's `loopOriginBeat` and `midiOffsetBeats` into a
   macro, and verbatim playback then applies the old restoration basis instead of a fresh command's current wrap
   and anchor laws. Record a real slip or trim and public history reversal, serialize the macro, then change an
   eight-beat loop to four beats; compare the full clip and every row with fresh public requests executed from the
   identical prestate. Repeat on the same basis, with looping disabled and on audio; include zero-valued
   restoration keys and an anchorless recording whose inverse carries `null`, followed by a current anchor. A fresh
   macro copy discards every restoration-only hint while preserving public request fields and stored macro bytes,
   and its own executed history still restores each before-figure exactly through saved Undo and Redo (fresh macro
   arithmetic is not dynamic Undo or a byte-exact net-zero promise). Leave coordinate captures stripped but restore
   scalar-hint forwarding: the unchanged fresh-producer comparisons must fail; an expected value computed from the
   old inverse displacement merely repeats the defect.
5. **Fractional row coordinates and reciprocal history captures restore exactly (#5495, #5578).** Integer fixtures
   miss floating-point loss: `0.1 + 8 - 8` is not the stored `0.1`. Require exact raw note, controller and
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
6. **Partial-bar carries change the mounted ruler's basis (#5247, #5440).** Insert 2 at 4 in 4/4 produces
   physical bar pieces at 0, 4, 6 and 10, the pieces at 4 and 6 both reading as bar 2; a distinct-bar inverse
   cannot enumerate the physical ruler, and a flat `bar * numerator` reader leaves bar 3 at 8 after its clip moves
   to 10. Reuse the meter model's segment origins and metrical walk, retaining each physical piece and its
   canonical number. Compose the actual recorded Command inverse and Redo with complete raw and projected map and
   clip snapshots and the same mounted reader: fresh post-operation paint figures in both directions, a downstream
   meter change and non-quarter denominators included. A correct initial mount cannot prove later basis changes;
   the flat-query and removed-subscription mutations must independently break geometry and freshness.
7. **A fragment writer that re-bases a looping clip restarts its loop at the cut (#5198, #5495).** Re-basing a
   looping MIDI split, Delete Time, excise or bounce fragment's notes to zero and restamping its anchor at the
   fragment's own head starts the loop over at the cut; a pin comparing the fragment with the anchor-free
   projection of its own new state agrees with any self-consistent rewrite and cannot see it. An edit that cuts a
   looping clip must keep every beat's sound; probe with an off-grid split and compare passes before and after.
   Score the source through the real projection (`projectMidiClipPlayback`) on a fine grid, recording the struck
   notes with their probability, the sounding pitches and the controller values the track holds; the shared helper
   is `src/modules/Arrangement/__tests__/midiClipScore.ts`. The score of the surviving clips must equal the
   source's score, shifted by the deleted span where time closes up. Cut off the loop grid on a loop-4 clip (2, 5,
   9), on a start-trimmed clip, on a clip anchored before its start, on a whole-length loop with `loopLength`
   absent, and on an unanchored looping clip, keeping a note that crosses a pass boundary and a 50 % row. Reverting
   the fragment writer to the restamp must fail every off-grid row. A non-looping clip's re-based fragment and the
   audio twins are controls that must stay green.
