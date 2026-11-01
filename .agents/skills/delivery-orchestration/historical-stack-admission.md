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

## Original parent already superseded

On Darwin, a child whose original parent was closed without merge can explicitly register that
original association when the main-based parent has a completed native supersession:

```bash
pnpm lane:sync-parent --lane <absolute-child-lane> --admit-historical --child-pr <child> --parent-pr <original-parent> --expected-head <full-child-sha> --superseded-parent-replacement <merged-parent-successor> [--parent-origin-main]
```

The selected successor must actually be merged into `main`. The original parent must retain
exactly one canonical author-App supersession receipt and one canonical lineage covering its
complete live finding set, naming that successor. The child remains open with its original base
and no lifecycle events; the parent has exactly one author-App closure, no reopening, deletion,
restoration or force-push, and still targets `main`. Existing actor, all-state PR uniqueness,
creation chronology, continuous native history, ownership, clean-child and cycle checks remain.
The cached child base must belong to both immutable histories. These are current-head and
original-fork witnesses: a plain supersession receipt does not attest the parent's historical
head at closure, or prove semantic replacement. The recorded parent remains the original PR;
ordinary publication and synchronization still refuse that closed parent.

`--parent-origin-main` is a separate parent-only opt-in for the exact native initial reflog
message `branch: Created from origin/main`. Its zero old OID, concrete new OID, author actor,
chronology and continuous history remain required. Present `origin/main` is never substituted
for that recorded new OID. The child still requires an exact-SHA native birth. Omitting this
option keeps exact-SHA parent birth validation, and every existing OPEN admission is unchanged.
The closed-parent options cannot combine with `--legacy-fork`.

Admission obtains canonical completion evidence through an internal read-only inspection mode
of the existing `pr:supersede` executable, independently launched by the verified primary
bootstrap. That mode uses the same native receipt, lineage and full-root readers as closure,
finishes with fresh parent and successor core witnesses, takes no mutation lock, and performs
no repository mutation. Its isolated author authentication remains ephemeral. No lane helper,
ambient package manager, caller proof file or duplicate marker parser supplies authority. The
nested Darwin launcher admits fixed `/bin/ps` alongside the frozen tool directories; an unsupported
platform or missing system tool refuses. Every admission mutation boundary repeats inspection
and rechecks the child after the parent reads. Bounded wire output and equal outer/inner source
pins are required; a mixed-version observation refuses.

This mode writes a strict version-2 admission receipt binding its flags and complete native proof,
including its source commit. Existing version-1 records keep their format and behavior. Exact
receipt/marker/descriptor interruptions can resume only with the same flags and proof. Changed
source pins, completion markers, identities or findings refuse rather than overwrite the journal;
retained records are not deletion permission. Tooling that does not understand version 2 refuses
it. Registration itself grants neither approval, Gate, delivery nor supersession of the child.
