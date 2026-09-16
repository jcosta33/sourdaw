# Review stances

This directory holds dispatch guidance for each review stance: the probes each reviewer applies,
the lessons from escapes, and the shared principles that bind them.

## Reviewer isolation

A reviewer holds no writable tree. It reads the head with `git show <sha>:<path>` from the primary checkout and the bundle under `.agents/review-bundles/<pr>-<sha>/`. A reviewer never edits, installs, or runs a check in a live lane; when it must execute code, it works in a scratch clone at the head sha with the primary checkout's `node_modules` symlinked in and never runs `pnpm install` there. Findings go to the orchestrator, never to GitHub.

**Why:** A reviewer that mutates the lane changes the head it is judging and can strand the author's push.

## Review language

Every approval, acceptance, and review body is a review finding written for a human teammate,
not a pipeline log. State what the change does, what was attacked, what held, and any remaining
concerns. The posting identity already carries the authority — never announce the role ("on
behalf of", "as orchestrator", "in the capacity of"). Never cite check counts, hash footers,
or tool-generated provenance artifacts. If the sentence could appear unchanged in a CI log,
it does not belong in a review body.

**Why:** across the September 2026 batch-fix campaigns, every approval body announced the
orchestrator's identity chain, cited Gate check counts, and relied on the auto-generated
evidence hash footer for substance. A teammate reading the PR saw process narration, not a
review. The evidence prose was in the bundle all along — the failure was writing the body
as an execution log instead of as the finding it should have been.
