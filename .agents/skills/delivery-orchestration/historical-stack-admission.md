# Historical child admission

An owner-released, clean author child with neither stack descriptor nor fork marker can recover
its original parent through the protected primary route:

```bash
pnpm lane:sync-parent --lane <absolute-child-lane> --admit-historical --child-pr <child> --parent-pr <parent> --expected-head <full-child-sha>
```

This explicit mode records lineage only. Then use ordinary `lane:sync-parent --lane <child>` to
merge parent history. Both PRs must remain open, same-repository author-App PRs. Complete all-state
head-ref queries must identify exactly those original PRs. The child's original parent link is
its explicit base repository/ref plus a complete timeline with no retargeting, force-push, deletion,
restoration, closure or reopening. The parent's head history must have no lifecycle ambiguity;
changes to the parent's own base are allowed. Missing or truncated evidence refuses admission.

The actual creation anchor comes from the child's initial zero-OID native branch reflog entry.
Both named branch logs must retain continuous, chronological author-App history, without reset or
rename records. The named parent must hold exactly that anchor strictly before and after the child
creation instant; equal-second transitions refuse. Its unique parent PR must already exist, the
child PR must be created later, and both present histories must retain the anchor. This combines
independent identity and creation witnesses under the existing same-account native trust boundary.
Local reflogs are mutable operational records, not cryptographic attestations. Shared ancestry,
merge-base, cached base SHA, workflow associations and prose cannot substitute for a missing witness.

Admission revalidates remote facts, clean child ownership/head, native logs and cycles before each
mutation. It atomically retains an immutable `.admission.json` receipt beside the descriptor, writes
the marker next, and installs the descriptor last. Receipt-only and marker-only interruptions refuse
ordinary publication, review, closure and synchronization through their common registered-lineage
reader. Repeat the exact admission to finish a matching interruption or replay matching completion;
conflicting records are never overwritten. The receipt remains as evidence, while ordinary native
sync may advance the descriptor's parent head without changing its recorded parent/fork/PR identity.
