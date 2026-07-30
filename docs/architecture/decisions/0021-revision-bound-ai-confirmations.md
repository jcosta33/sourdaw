# ADR 0021: Revision-bound AI confirmations

**Status:** Accepted

## Context

AiRuntime can plan an AppAction batch from a project snapshot and either execute it immediately or retain it for later confirmation. Without recording the Automerge authority used for planning, an AI command may execute after local, collaborative, or project-replacement changes make its targets or assumptions stale.

## Decision

- CrdtDocument exposes a read-only project revision token derived from the local document-identity epoch, sorted active document IDs, and each document's sorted Automerge heads.
- AiRuntime captures the token before building project context for an AppAction-backed command.
- Planning must stop if the token changes before a proposal is published or immediate execution begins.
- Pending AppAction confirmations store the captured token and compare it with current project state before acceptance.
- Batch execution rechecks the token through its execution-authority callback until commit.
- A mismatch invalidates the proposal, updates its chat receipt, and invokes no action handler.
- Stop cancellation remains distinct from revision invalidation, and only one AppAction-backed AI execution owns Stop authority at a time.
- The legacy DSO path is unchanged and receives no revision guarantee from this decision.

## Consequences

AppAction-backed AI execution is bound to the complete active project revision rather than only the named targets. Any intervening project change requires a fresh plan, including unrelated edits. The token is local execution authority, not a persisted project identifier or a collaboration protocol field. Replacement projects remain distinguishable even when their document IDs and heads are otherwise equivalent.
