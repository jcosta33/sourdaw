---
type: adr
id: 0049
title: Retire the source-attestation comment
status: accepted
date: 2026-09-23
owner: The Sourdaw team
sources:
    - .agents/decisions/0048-attributable-evidence-contract-is-frozen.md
    - .agents/skills/delivery-orchestration/SKILL.md
    - scripts/publishLane.ts
    - scripts/__tests__/publishLane.spec.ts
    - https://github.com/jcosta33/sourdaw/issues/3373
---

# 0049 - Retire the source-attestation comment

## Context

Since #3373 (spec #3367 AC-001), `lane:publish` posted one `sourdaw-attestation-v1` marker comment
per published head: the source attestation binding every exact commit OID above the comparison base,
with its observed Git authorship, to the head. [0048](0048-attributable-evidence-contract-is-frozen.md)
froze it as a protected-public marker record written by the author App and read only when a comment
carried the App's immutable node id.

Three facts made the channel not worth what it cost:

- **One comment per published head.** A lane with eight pushes left eight attestation comments on
  its pull request, each naming the same growing commit set. The thread cost was paid on every push,
  and reviewers read the thread.
- **Nothing in the pipeline read it back.** The only reader was the writer's own replay check, which
  skipped reposting a marker already standing. No reviewer, acceptance, or delivery path consumed
  the record; the full OIDs it bound were never compared against anything.
- **It was self-attested.** The same author App identity that posted the comment ran the authorship
  gate, so the record added no independent evidence. The gate is the actual control: before any
  remote write it refuses an unattributable commit in the delta this publication adds — the remote
  tip when the branch already exists remotely, otherwise the comparison head — naming each offending
  commit. That delta is narrower than the record's comparison-base range, but every published head's
  delta was gated as it was added, so no commit reached a published head ungated.

## Decision

Retire the attestation comment channel. `lane:publish` performs no attestation comment write, on any
path, ever: delete `scripts/sourceAttestation.ts` and its spec, and remove the port members, the
GitHub comment write, the comment reader, and the comparison-base read that existed only to compose
the record.

Keep the authorship gate exactly as it is — the same commit-set calculation (`deltaBase` is the
remote tip when the branch already exists remotely, otherwise the comparison head, always excluding
every resolved base), the same refusal conditions, and the same refusal wording. `CommitAttribution`,
the type the gate consumes, moves into `publishLane.ts`, the module that now owns it.

Historical comments already posted stay on their pull requests. They need no reader, and no
compatibility path is added for them.

## Consequences

- **Positive.** Publication no longer grows a per-push comment thread, and the protected-public
  surface loses one channel a reader could distrust. The gate's delta read is the publication's only
  commit read.
- **Neutral.** A published head no longer carries a self-contained record of its commit set above the
  comparison base. The pull request's own commit list remains public, and the gate refusal remains
  the control; should a future consumer need commit-set evidence, it must be built as a new additive
  record with a real reader under [0048](0048-attributable-evidence-contract-is-frozen.md)'s
  addition-only rule.
- **Ledger.** [0048](0048-attributable-evidence-contract-is-frozen.md) is partially superseded: its
  source-attestation channel no longer has a live writer. The rest of the frozen contract is
  unchanged.
