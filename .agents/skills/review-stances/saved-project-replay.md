# Standing probes: saved projects and replay

Defects where a saved project, saved history entry or imported file reloads, replays or splits into something other
than what was committed: identity namespaces across reload, saved inverse authority, lossy imports. Split out of
`correctness.md`; a stance matching this class carries this file instead of it.
Each probe names the failure mode, the input, state or mutation to run, and the check that must go red.
Report the concrete break or none.

## Standing probes

1. **Identity namespaces across reload and replay.** Produce entries through real Command, save and
   load the Automerge document, reset every projection and hydrate the session mirror, then require a
   global ID census, exact values and real Undo/Redo. Split before surviving points: retained copied
   IDs must reserve the live namespace, including a preoccupied preferred ID under another owner, an
   ID claimed by a peer after Undo (zero-write refusal), nested points and cross-domain owners
   (#4036), at a dyadic and a non-dyadic cut. Producer-local scopes stay local: canonical clip-local gain point IDs repeat across clips
   and equal a track ID, while same-envelope duplicates, track/clip/device collisions and repeated
   arrangement IDs stay repair-required. For a batch-admitted restored clip preceding a split, compare
   captured IDs with the committed IDs before reloading and replaying twice; a live execution that
   remints a preflight capture is not replay-stable. Read executable entries from the full history
   owner, not its label-only view; draw is singleton-only, so a rejected draw/split proves admission only.
2. **Saved inverse authority.** Probe a saved inverse through production hydration before any write:
   duplicate note identities, malformed CC or bend rows, a missing capture, one side of a mirrored
   optional satellite absent (present empty is distinct), and a durable-head change alone must not
   refresh a removal inverse (#5064). Add Redo after unrelated same-track growth (#1425 slot), a
   cross-track move's source order after a peer removal (#515), and split Redo with a recreated target
   identity. Mocked minimal rows cannot show the restore owner admits what Arrangement already wrote.
3. **Lossy import accounts for the whole source.** Enumerate the legal source grammar and account for
   every preserved, omitted or partially kept element, including named descendants under rejected
   owners and malformed, nonnumeric, nonfinite, empty and whitespace-only values against the actual
   parser fallback (DAWproject, #5656/#5795). Assert warning identity, owner, order, cardinality beside
   playable siblings; remove each accounting branch and its case must fail.
