# Lesson library: one-shot asynchronous result authority

Lesson library for one-shot asynchronous requests that compete to populate the same result
slot — imports, preset loads, and file selections. This class concerns a request's authority
to commit a result after newer work starts; it is distinct from the lifetime of a long-lived
runtime session.

## Standing probes

- Name the result slot and the winner rule. If the newest request owns the slot, prove that
  ownership is checked after every real await, on both resolution and rejection, before a
  state mutation or user-facing notice. Project-lifetime authority is a separate fence: it
  rejects work for a replaced project but does not order requests within one project.
- Hold request A at each real await boundary, start B for the same slot in the same project,
  let B finish, then resolve and reject A. Observe B's stored result, no stale user-facing
  success or error notice, and no mutation from A. Make an unrelated project edit while B is
  pending and prove the result commit preserves it.
- Pair the overlap probe with current-request success and error controls. Check cancellation
  against the declared contract, including whether canceling the newest request leaves an
  older pending request eligible; do not infer that policy. Replacing the project must fence
  late results and notices, while a new request in the replacement project remains current.
- Distinguish user-facing notices and state writes from diagnostic-only logging. Verify that
  stale work cannot present its result as current or mutate the slot; do not ban diagnostic
  logging without a contract reason.

## Lessons from escapes

### PR #5516 — a project-lifetime fence did not order same-project requests

PR #5516 fixes stale completion and notice handling for overlapping Scala imports. The
project-lifetime fence in landed PR #5397 rejects work after project replacement, but A and B
started in the same unchanged project both retain that authority. If B finishes first, A can
otherwise resume later and overwrite B's result or report an obsolete outcome.

The earliest inspected history marker, commit `0960a493`, has no associated pull request. It
does not establish the first introduction of the ordering gap. The exact introducing change
and historical reviewer stance, prompt, and tier are unknown.

Probe that would have caught it: at every actual picker, read, and parse await, hold A; start B
in the same project and complete B; then resolve A and separately reject A. Require B's result
to remain stored, no stale user-facing success or error notice, and no mutation by A, while an
unrelated project edit survives. Reverting the request-generation guard must make the existing
same-project overlap case fail. Keep current-only success and error, cancellation under its
declared semantics, and project-replacement cases as controls. Controlled native transport
tests prove the exercised request path only; they do not establish live N-API behavior or
manual desktop acceptance.
