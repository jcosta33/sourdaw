# Present custody of an existing pull request

An explicitly released stale pull request can acquire a **new present-day author
checkout**, without reconstructing its original worktree or branch birth:

```bash
pnpm lane:open --adopt-pr <pr> --expected-head <full-lowercase-sha> --model <public-model>
```

Run this opt-in from the protected primary checkout after the capability has
landed. Normal `lane:open` retains its existing behavior: after its main fetch,
it performs local setup without calling GitHub or minting a credential. Only the
explicit adoption mode reads GitHub. It reads the installed reader's credential
through `gh`, mints no App token, and performs no GitHub write. It never executes
code from the adopted checkout.

Adoption verifies a defined, single `origin/main` source pin before observing
public PR state or changing custody. It requires one open, same-repository PR
by the immutable author App, exactly one complete all-state head-branch candidate,
and independent matching source and base refs. The expected head is mandatory.
Missing, ambiguous, changed or foreign evidence refuses.

The local branch, destination and worktree must be absent. A non-force,
create-if-absent ref operation reserves the exact remote head; Git owns the
worktree branch reservation. The resulting checkout is clean, author-locked and
stamped with the author App's commit identity and the adopting model. Dependencies
are not installed by adoption; install them into this checkout's own
`node_modules` when needed. Redirected installs, retained stack evidence, Git
grafts/replacements, and unresolved guard failures for this branch refuse.
The command never edits a pre-existing or parent worktree.

The immutable `.agents/lane-adoptions/` receipt records present custody, the
original PR identity and live base, head, source pin and nonce. Its native reflog
message explicitly describes present adoption. Neither is original birth or
historical stack evidence. No stack descriptor, fork marker or historical
admission receipt is created. A current adoption time cannot satisfy the
historical reader's requirement that branch birth precede the existing child PR.

A matching interruption retains its record and local state. Repeat the exact
adoption command to continue only when the branch birth, worktree identity and
clean head still match. A completed replay makes no local changes. A dirty or
partially extracted checkout, contradictory record, foreign branch or moved PR
refuses and retains evidence; the command never repairs it destructively. A
failure after local setup may leave an owned branch or worktree, so inspect the
retained record and reported failure before proceeding.

## Publish one additive successor

Make ordinary additive commits/merges in the newly owned checkout. Preserve the
original head; do not rebase, reset, amend published history or force push. Then
publish through the protected primary route:

```bash
pnpm lane:publish --lane <absolute-adopted-lane>
```

Before pushing, the publisher writes an immutable one-successor intent. It
binds the custody nonce, old source head and exact intended successor. Publication
continues to require clean work, canonical author identity, real source ancestry,
resolved real bases and guard evidence. Adoption grants no new base exclusions.

The publisher may update only the adopted immutable PR and its recorded base.
Disappearance, closure, reuse, retargeting, changed base target, unexpected remote
head or a second intended successor refuses. It cannot create a replacement PR
or retarget the original. The source ref must still hold the frozen old head,
or the exact intended head from an already pushed attempt. A matching pushed-head
replay skips the source push and can finish remaining ordinary metadata updates.
An arbitrary descendant does not qualify. Further source publications require a
future native continuation capability; this bounded mode admits one successor.

Public PR/ref identity and local custody are checked before each remote write
and afterward. A failed or raced write reports that publication may be partial;
preserve its intent and replay only the identical head. These client observations
cannot exclude a change arriving after the final read. Non-force Git push remains
the remote history boundary.

Adoption supplies no review, Gate, delivery, historical lineage, finding closure
or product acceptance. For supersession of a child whose parent was closed
unmerged, keep the original base, add actual final-parent ancestry when necessary,
and deliver the real main-based replacement through the existing native gates.
Only then can unchanged `pr:supersede` validate parent completion, immutable
ancestry and the total finding lineage. A publication alone proves none of those
completion obligations.
