# Lesson library: security and platform boundaries

Lesson library for defects in native authority, renderer trust, platform capabilities, IPC
exposure, filesystem access, secrets, or operating-system integration. Per the Review section of
`AGENTS.md`, this directory is a lesson library, not a stance menu: an escape — a defect that
reached `main` whose defect class matches this file — is recorded here as a lesson, and every
dispatch whose derived stance matches this file carries its lessons. Lessons state the escape, the
blind spot, and the probe that would have caught it. Keep each lesson short enough to paste into a
dispatch.

## Standing probes

- Enumerate every implicit authority root from the live implementation. For each one, prove why the
  application owns the whole root rather than an app-specific child.
- Put a synthetic ungranted sibling one component outside every claimed owned child and exercise
  each exposed access mode. Require refusal for the sibling, then require owned-child and explicit-
  grant positive controls to succeed.
- Trace internal native scratch producers separately from renderer-reachable file commands. An
  internal consumer of a broad platform directory does not grant the renderer authority over it.
- Follow canonical paths through existing symlinks and missing tails before evaluating a root or
  grant. Check component boundaries and platform spelling behavior rather than string prefixes.

## Lessons from escapes

### 2026-09-09 — hosted WASM control and source revisions were assumed identical (introduced via PR #4057)

PR #4057 validated artifact provenance when the workflow helper and checked-out source shared a
revision, but GitHub executes workflow YAML from the merge revision while the workflow may check out
an older PR head without that helper.

Blind spot: review inspected a same-head build and receipt path, not the actual control CLI against
two pinned roots with source-local hashes and pins.

Probe that would have caught it: execute the real control helper against a distinct clean source Git
root lacking both hosted helpers; exercise relevant and irrelevant source changes plus divergent
closure hashes and toolchain pins, and require invalid or dirty roots to fail before source-toolkit
import. For return verification, use a source toolkit sentinel and prove the verifier only reads the
clean source root and never imports it.

### 2026-09-05 — the OS temporary directory was called app-owned (introduced via PR #2; retained by PR #3404; fixed by #3642)

PR #2 introduced `std::env::temp_dir()` as an implicit built-in root in commit
`eaf9b0687a322f4adb9633f3e45c914b9d0d5e5f`. PR #3404 later narrowed user-directory authority but
retained that root even though the same module defined `sourdaw_ipc` as Sourdaw's app-owned child.
Its review attacked grant and private-directory spellings but never proved ownership of every
built-in root, so an authorized renderer could read, list and write unrelated same-user temporary
files.

Blind spot: the root list's description was accepted as ownership evidence. No test placed an
ungranted sibling outside the app-owned child while remaining inside the broader OS temporary
directory.

Probe that would have caught it: enumerate every implicit root, create a synthetic ungranted
sibling one component outside each owned child, and drive every exposed read, list and write route.
Require the sibling to be refused without mutation while the owned child and an explicit recursive
grant remain positive controls.

### 2026-09-19 — the reviewer confirm token could not perform its own mutation (introduced via PR #4411)

`review:confirm` resolved threads through a reviewer installation token minted `contents: read`;
GitHub gates `resolveReviewThread` on repository write access, so every confirm failed with
"Resource not accessible by integration" and every lane silently fell back to author-side `Done` —
the public record never showed a reviewer-resolved thread.

Blind spot: review verified the flow's records and idempotence but never executed the identity's
own GitHub mutation, so a permission-set/mutation mismatch shipped; the universal author-side
fallback masked it from every later session.

Probe that would have caught it: for every GitHub mutation a shipped script performs, prove the
minted permission set admits that mutation class — resolve or create one real thread under the
minted identity in a fixture repository and require the mutation to succeed before the flow lands.

### 2026-09-19 — repair ancestry used the live tip instead of the finding revision (introduced via PR #4411)

PR #4411 (`ae4793d05f`) rejected a repair equal to the live PR head, forcing an unrelated follow-up
commit for an ordinary one-commit fix, while accepting commits already present when the finding
was reviewed. Both author recording and reviewer confirmation used the same wrong revision bound.

Blind spot: review accepted commit inequality as proof of a post-finding repair, and tests encoded
the tip refusal without binding the root finding to its associated review's commit.

Probe that would have caught it: require a one-commit repair at the live tip to record and confirm;
refuse the reviewed commit, its predecessors, and a merged sibling that does not descend it, with
zero mutations for the whole confirmation batch. Read the root comment's review commit from GitHub
in both production queries, preserve it across pagination, and refuse missing provenance. A reply's
review or a comment's moving diff commit must never replace the revision that received the finding.
