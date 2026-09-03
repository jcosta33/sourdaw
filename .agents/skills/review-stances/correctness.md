# Review stance: correctness

Dispatch guidance for the correctness stance: attack what the change does, not what it claims —
read the whole unit at head, state the invariant it must maintain, and try to construct the input
or state that breaks it. Per the Review section of `AGENTS.md`, an escape — a defect that reached
`main` which this stance should have caught — is recorded here as a lesson, and every future
dispatch of this stance carries this file's lessons. Lessons state the escape, the blind spot, and
the probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

## Standing probes

- Read the full unit the diff touches at head — the function, its callers, its callee contracts —
  never the hunk alone. A hunk shows what changed, not what the code now does.
- State the invariant the change maintains in one sentence, then construct the input or state that
  violates it. Report the concrete failure scenario or report that none survived; never hedge.
- Where the change models another component's state — a mirror, a shadow copy, a re-derivation —
  enumerate the owning component's contract clauses from its source and check the model against
  every clause, including the ones today's tests do not exercise.
- Probe every boundary the change establishes or relies on one quantum to each side: the value the
  bug report named, and the adjacent value the report did not name.
- A green gate is not evidence: name what would have to break for the existing checks to fail, and
  whether anything observes it.

## Lessons from escapes

### 2026-09-02 — a mirror that implements half of the engine's release law (escaped via PR #3363; clip repair in flight in #3437)

PR #3363 shipped fader, pan and send automation on the native live engine with the loop-end
starvation live: its clip keeps writes stamped at the loop end (`orderedWrites`,
`writeLandSeconds(write) <= span.endSeconds`). The post-merge correctness round found the writer's
own release mirror implements only the playhead half of the engine's `proven_popped` law: the seam
half — carried stamps released two wraps post-echo when the start frame precedes the span end
frame — is missing, so a step one poll interval below the loop end is never mirrored as released.
Reproduced by simulation (30 of 60 passes frozen with a step 1 ms below the loop end) and by a
lane-run probe of the starvation spec with its last step at 3.9999 (0.1 ms below the 4.0 s loop
end), frozen by pass 8. The open #3437 repairs the clip, and its outstanding review round covers the
mirror gap.

Blind spot: the mirror was checked against the half of the law the failing test exercised, not the
whole law — stances ran across five attacked heads and still enumerated only part of it. The specs
pinned the behavior at the boundary the bug report named and never one poll interval inside it.

Probe that would have caught it: when a fix maintains a mirror of another component's state,
enumerate every clause of the owning component's invariant from its source (the engine's
render-and-pop law) and require each clause in the mirror — a clause no current test exercises is
the finding. Then run the starvation scenario with the step one poll interval below the loop end
and require the write to be released.
