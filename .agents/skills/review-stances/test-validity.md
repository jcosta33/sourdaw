# Review stance: test validity

Dispatch guidance for the test-validity stance. Per the Review section of `AGENTS.md`, an escape —
a defect that reached `main` which this stance should have caught — is recorded here as a lesson,
and every future dispatch of this stance carries this file's lessons. Lessons state the escape, the
blind spot, and the probe that would have caught it. Keep each lesson short enough to paste into a
dispatch.

## Standing probes

- Name the mutation that should fail each changed check, and check it would. A spec that stays
  green under the revert of the behavioural hunk has failed the stance.
- A spec-only diff that turns red to green is the highest-risk diff class: for every hunk, read the
  product code the spec observes at head and decide stale-spec versus laundered defect.
- Exact-count and exact-shape assertions: verify the pinned value derives from the thing it claims
  to observe, not from whatever the code currently produces.

## Lessons from escapes

### 2026-08-29 — a refactor that rewrites its own witnesses (escaped via PR #2988)

PR #2988 extracted render-retry execution, claimed in its body that it kept "exact budget behavior",
and in the same diff rewrote its own handler spec's call-count assertion from a two-pass pin to a
single-flight pin — an observable contract change shipped under a preservation claim. Two
end-to-end witnesses elsewhere (`drumBusPromptWorkflow`, `backingVocalPlateWorkflow`) were left
failing on `main` and had to be diagnosed from scratch (#3060).

Blind spot: the stance checked that the diff's own specs discriminate, but not that the diff's spec
EDITS were consistent with the body's preservation claim, and not whether witnesses OUTSIDE the
diff still passed against the new behavior.

Probe that would have caught it: when a refactor's body claims behavior preservation, diff every
assertion the refactor itself rewrites — a changed expected value under a preservation claim is a
contradiction to raise, not context to accept — and search the repository for other specs observing
the same call surface, running the nearest ones.
