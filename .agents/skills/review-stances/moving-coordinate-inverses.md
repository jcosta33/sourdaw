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
