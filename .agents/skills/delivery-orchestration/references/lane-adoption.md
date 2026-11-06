# Present custody through the pinned publisher

An explicitly released pull request can acquire a new present-day author
checkout without reconstructing its original worktree or branch birth:

```bash
pnpm lane:publish --adopt-pr <pr> --expected-head <full-lowercase-sha> --model <public-model>
```

Run this adoption-only alternative from the protected primary checkout after
the capability has actually landed. The existing package route loads the
publisher and its complete verified dependency closure from one pinned
`origin/main` snapshot. Physical primary publisher/common files can remain
older; no primary fast-forward, file copy or installer is required. The stable
primary launcher itself must still match its selected source pin, as every
existing publication requires. An unavailable fetch warns and may use the
existing cached pin; this is not a guarantee of fresh remote main.

The local alternative accepts only the three shown flags. Combining them with
an ordinary issue, lane selector, title, body or metadata option refuses. It
reads public PR state using the frozen reader executable and its existing
reader credential, then creates local custody. It does not initialize an App
session, read App role credentials, mint a new App token, push source or notes,
or create/edit/label/review/close a PR. Normal publication remains a separate
operation. Ordinary `lane:open` retains its original offline/no-GitHub contract.

The snapshot entry verifies its defined executing source pin, primary cwd,
common repository and frozen tool paths before any adoption observation or
mutation. The custody receipt records that actual executed pin, even if a
concurrent fetch later moves the local `origin/main` ref. Only one open,
same-repository PR by the immutable author App qualifies, with exactly one
complete all-state head-branch candidate and independent matching head/base
refs. Missing, ambiguous, changed or foreign evidence refuses.

The local branch, destination and worktree must be absent. A non-force,
create-if-absent ref update reserves the exact remote head, an atomic directory
creation reserves the destination, and Git admits its worktree branch. Checkout
materializes data with hooks, fsmonitor and configured content filters disabled;
no adopted package, hook or filter code executes. The final checkout must be
clean, author-locked and stamped with the App commit identity and current model.
Dependencies are not installed; use the new checkout's own install when needed.
Redirected installs, retained stack evidence, Git grafts/replacements and
unresolved guard failures for the branch refuse. Foreign and parent worktrees
remain untouched.

The immutable `.agents/lane-adoptions/` receipt and native reflog explicitly
record present custody, not original birth or historical stack association.
No stack descriptor, fork marker or historical admission receipt is created.
A matching interrupted operation can continue only while its native birth,
worktree identity and clean head still match. A completed replay changes no
custody record/config/ref; the ordinary launcher still performs its main fetch.
Concurrent matching callers can replay the same custody or lose an atomic
reservation and refuse; they never overwrite another claim. A dirty or partially
materialized checkout refuses and retains evidence instead of destroying edits.

## Publish one additive successor

Preserve the original source head with ordinary additive commits/merges in the
newly owned checkout. Then use the existing protected primary route:

```bash
pnpm lane:publish --lane <absolute-adopted-lane>
```

Before pushing, publication binds an immutable intent to the custody nonce,
frozen old head and exact successor. All normal clean-work, real ancestry,
canonical author and guard checks remain; custody grants no author-exclusion
base. The publisher may update only the original immutable PR and recorded base.
Disappearance, closure, reuse, retargeting, moved base target, unexpected remote
head or a second successor refuses. It cannot create a replacement PR.

The source ref must hold the frozen old head or the exact intended head from an
already pushed attempt. An exact pushed-head replay skips the source push and
can finish ordinary idempotent metadata operations. An arbitrary descendant
cannot inherit the intent. Further source publication requires a future native
continuation capability; this bounded mode admits one successor.

Public identity and local custody are checked before and after remote writes.
A failed or raced write reports a possibly partial publication; preserve the
intent and replay only the identical head. Client reads cannot exclude changes
after their last observation. This route inherits no delivery process-owner
fence: its local concurrency controls are the immutable journal, atomic
reservations and Git worktree admission. Non-force push remains the source
history boundary for ordinary publication.

Custody grants no historical evidence, approval, Gate, delivery, finding closure
or product acceptance. For cross-base supersession, retain the original base,
add actual final-parent ancestry when necessary, and deliver the real main-based
replacement through existing review and Gate controls before unchanged
`pr:supersede` validates native completion, ancestry and total finding lineage.
