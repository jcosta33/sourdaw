# Review stance: test validity

Dispatch guidance for the test-validity stance. Per the Review section of `AGENTS.md`, an escape —
a defect that reached `main` which this stance should have caught — is recorded here as a lesson,
and every future dispatch of this stance carries this file's lessons. Lessons state the escape, the
blind spot, and the probe that would have caught it. Keep each lesson short enough to paste into a
dispatch.

## Standing probes

- Apply the standard mechanical probe the Review section of `AGENTS.md` defines; this file does not
  restate it.
- A spec-only diff that turns red to green is the highest-risk diff class: for every hunk, read the
  product code the spec observes at head and decide stale-spec versus laundered defect.
- Exact-count and exact-shape assertions: verify the pinned value derives from the thing it claims
  to observe, not from whatever the code currently produces.

## Lessons from escapes

### 2026-08-29 — a refactor that rewrites its own witnesses (escaped via PR #2988)

PR #2988 extracted render-retry execution, claimed in its body that it kept exact revision, budget,
continuation, chat, and no-replay behavior, and in the same diff rewrote its own handler spec's
call-count assertion from a two-pass pin to a single-flight pin — an observable contract change
shipped under a preservation claim. Two end-to-end witnesses (`drumBusPromptWorkflow`,
`backingVocalPlateWorkflow`) were edited by that same diff yet only partially realigned: their
stale attempt-count expectations survived the edit and were left failing on `main`, diagnosed from
scratch later (#3060).

Blind spot: the stance checked that the diff's own specs discriminate, but not that the diff's spec
edits were consistent with the body's preservation claim — and in files the diff touched, partial
realignment passed as realignment; assertions the diff left standing in edited files were never
re-checked against the new behavior, and untouched witnesses of the same surface were never run.

Probe that would have caught it: when a refactor's body claims behavior preservation, diff every
assertion the refactor itself rewrites — a changed expected value under a preservation claim is a
contradiction to raise, not context to accept; in every spec file the diff touches, re-check the
assertions it did NOT change against the new behavior; and search the repository for other specs
observing the same call surface, running the nearest ones.
