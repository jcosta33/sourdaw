# Historical child admission

An owner-released, clean author child with neither stack descriptor nor fork marker can recover
its original parent through the protected primary route:

```bash
pnpm lane:sync-parent --lane <absolute-child-lane> --admit-historical --child-pr <child> --parent-pr <parent> --expected-head <full-child-sha>
```

For a child with no descriptor or admission receipt but exactly one legacy fork marker, append
`--legacy-fork <full-lowercase-fork-sha>` after the complete admission arguments. This opt-in must
name both the sole existing marker and the independently proven native creation anchor. It never
replaces, adds, deduplicates or removes a marker. Missing, duplicate, foreign or contradictory
markers refuse; a descriptor without a receipt still refuses. Omitting the option keeps the original
marker-only refusal. A matching receipt or completed admission may replay with the option, but the
named fork and sole marker must still match the independently proven anchor on every invocation.

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

Legacy-marker admission writes the same version-1 immutable receipt first and the same descriptor
last, preserving the existing marker and native histories. There is no new stored format, so old
readers remain compatible and refuse incomplete registration. A failure retains the journal for
forward replay with the exact admission arguments; never delete partial records to retry. Rolling
back the tooling leaves existing data unchanged and may leave admission incomplete. Removing any
retained evidence would require a separate owner-controlled decision outside this procedure; this
recovery has no destructive rollback or contraction stage.
