# Review stances

This directory holds dispatch guidance for each review stance: the probes each reviewer applies, the lessons from escapes, and the shared principles that bind them.

## Reviewer isolation

A reviewer holds no writable tree. It reads the head with `git show <sha>:<path>` from the primary checkout and the bundle under `.agents/review-bundles/<pr>-<sha>/`. A reviewer never edits, installs, or runs a check in a live lane; when it must execute code, it works in a scratch clone at the head sha with the primary checkout's `node_modules` symlinked in and never runs `pnpm install` there. Findings go to the orchestrator, never to GitHub.

**Why:** A reviewer that mutates the lane changes the head it is judging and can strand the author's push.
