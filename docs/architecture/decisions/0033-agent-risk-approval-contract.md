# ADR 0033: Agent risk approval contract

**Status:** Accepted

## Context

AiRuntime already retains revision-bound confirmations, and Command already classifies executable operations and compiles exact batch authority. Those controls did not form one approval record: approval was not bound to canonical action hashes, target fingerprints, local actor identity, or declared cost and data consequences.

## Decision

- Command owns the fail-closed risk policy. It combines registered operation risk with batch breadth, master/tempo/routing grants, render cost, file/import/upload/remote effects, and explicit ambiguity, staleness, or capability-degradation signals.
- The approval boundary adopts the trust-mode vocabulary. Read-only work is `analyze-only`; branch creation is `create-branch`; reversible project changes are `apply-reversible`; destructive replacement is `replace-selection`; and external or unclassified effects require `destructive-commit`. `suggest-only` never enters the commit approval path.
- Ambiguous, stale, or capability-degraded authority is rejected. It is never converted into a broader inferred grant. Broad, destructive, authority-sensitive, costly, upload-bearing, external, or multi-command work requires explicit confirmation.
- AiRuntime snapshots a versioned approval record containing the required trust mode and risk, each command's canonical argument hash, the source revision, exact target fingerprints, declared cost/data consequences, and the local collaboration actor (or the standalone local actor).
- The user-visible confirmation states the effective approval risk, required trust mode, and cost/data consequences.
- AiRuntime revalidates the complete approval record before accepting confirmation and through Command's execution-authority callback immediately before effects. Any mismatch invokes no new handler and requires a fresh proposal.

## Consequences

Approval authorizes one exact command batch for one actor and one project state. A changed target, action, actor, consequence, trust requirement, or revision invalidates it. Command remains the registry and risk-policy owner; AiRuntime owns the user-facing approval lifecycle.
