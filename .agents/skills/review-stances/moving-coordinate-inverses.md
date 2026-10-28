# Lesson library: moving coordinate inverses

## 2026-10-25 — a trim inverse recomputed against a different loop length

PR #5022 (`abee0c2e8e936c3d06182554a82824d3669a14fc`) introduced start-trim offset
wrapping against the post-trim loop length and translated stored MIDI notes by the wrap
distance. Its loop fixtures explicitly configured `loopLength: 8`, keeping the wrap basis
constant. An inferred loop length comes from clip duration, which the trim changes. Replaying
the opposite trim therefore normalizes against a different basis and can leave the stored
offset and rows displaced. A surrounding slip inverse that restores its captured offset
does not reverse that displacement. Issue #5512 records the escaped composition.

The published approval attacked forward phase, window and scheduler admission, plus barrel
mocks. The historical reviewer prompts and tiers are unknown; that prose does not establish
that a duration-derived inverse composition was reviewed.

When an edit changes the basis used to wrap, clamp or normalize coordinates, compose its
real recorded inverse with the surrounding edits on both inferred and explicitly configured
bases. For a duration-derived loop, slip left one beat, trim the start across a wrap boundary,
then undo the trim and the slip. Assert the captured raw offset and every note, controller
and pitch-bend beat at the intermediate inverse boundary and after the complete undo/redo
chain. Preserve unrelated rows, clip geometry and configured-loop behavior. Check scheduler
admission as well: matching audible relatives alone cannot prove exact stored restoration.

The discriminating probe removes the inverse's captured offset, or reverses the restoring
row translation. The inferred-basis case must fail on its raw figures; the explicit-basis
control must still describe its own preserved behavior. A fixture that always configures the
normalization basis cannot cover a moving basis.

## 2026-10-25 — finite captures overflowed their derived row translation

Review of PR #5578 caught a captured trim inverse whose finite current and captured offsets
produced an infinite restoring displacement. A finite displacement could also overflow a
finite note, controller or pitch-bend beat. MIDI sanitization then removed those rows while
the trim reported a write. Checking only the incoming capture did not protect the derived
coordinates.

Preflight the displacement and every translated row before either owner writes. Probe opposite
finite extremes, then overflow each row type separately with a finite displacement. Require
owner refusal, handler `no-write`, and unchanged clip and all row types; exercise raw-document
and history preservation through the real command wherever the fixture codec admits the input.
Keep ordinary and zero captures, the configured-loop control and keyless replay behavior intact.

## Legacy inverse admission after a coordinate-capture repair

PR #5022 introduced the moving loop basis described above. PR #5578 captures the old
offset for new trims, but historical trim inverses produced before that repair carry no
`midiOffsetBeats`. A loop phase cannot recover the discarded quotient or the original row
displacement. Replaying the opposite trim can therefore consume Undo while restoring the
wrong offset and rows. Historical review prompts and model tiers are unverified.

Produce the old inverse with the real historical Command handler, preserve its original
document and session-history bytes, then hydrate through the current production reader.
Require an unauthenticated MIDI inverse to leave the document, rows and pending history
unchanged, with a warning. Zero distance is not proof of preservation: slip to an
unnormalized whole-loop offset while looping is off, enable looping, then trim at the
unchanged start. The forward trim can normalize the offset and translate every row;
its present normalized phase cannot authenticate the original figures. Refuse both
normalized and unnormalized legacy zero-distance inverses without a capture.
The current loop mode cannot authenticate the old mode: a peer can disable looping
after a trim has already wrapped its coordinates. Disable looping on the genuinely
saved duration-derived case, then require the same refusal with the peer state intact.
Keep the original loop-disabled MIDI fixture as a conservative refusal control.
Preserve audio and current capture-bearing zero-distance Undo/Redo controls, including
zero captures and whole-loop captures. Removing replay admission must fail the unsafe
historical case; deleting a capture field from a modern fixture cannot establish
historical compatibility.
