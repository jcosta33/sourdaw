# Review stances

This directory is a lesson library keyed by defect class: the standing probes, escape lessons,
and shared principles that bind them.

## Stance derivation and the lesson library

Stances are derived per task, never selected from this directory. Enumerate the material risks the
diff creates, name one stance per risk, and record the dispatched set with each stance's admission
evidence in the bundle's `stances.json`; the root `AGENTS.md` Review section carries the rule.

This directory is a lesson library, not a menu. Each file collects standing probes and escape
lessons for one defect class, and the matching key is the risk the stance attacks — never the
files the diff touches. A stance carries the most specific matching file and never a broader one
in addition; a stance matching no file dispatches without one. An escape attaches to every file
whose probes participate in what would have caught it, or mints a new file for a defect class
none covers.

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
