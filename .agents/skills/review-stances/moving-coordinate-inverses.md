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
