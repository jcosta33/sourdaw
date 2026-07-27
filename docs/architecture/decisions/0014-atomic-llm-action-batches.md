# ADR 0014: Atomic LLM action batches

- Status: Accepted
- Date: 2026-07-27

## Context

ADR 0012 limits provider plans to one executable action because sequential `executeAppAction` calls can commit a valid prefix before a later action fails. That behavior is unacceptable for requests such as “mute the drums and lower both guitars”: the user expressed one intent and must not receive an unreported partial mix.

The existing Automerge storage transaction can already group synchronous project writes against the same project document. The Command module owns handler lookup, undo metadata, macro recording, semantic history, and transaction commit, so atomic batching belongs there rather than in AiRuntime.

## Decision

Command exposes one batch execution use case for already typed application actions:

1. Resolve every handler, authority check, and undo description before the first effect; evaluate state-dependent semantic no-ops in transaction order against the projected batch state.
2. Reject the whole batch before dispatch when any action is unavailable or preflight fails.
3. Execute every remaining handler inside one Automerge storage transaction and one semantic context.
4. Treat a handler conflict, concurrent no-write, thrown error, or storage failure as a batch failure and abort all pending project writes.
5. Publish macro, action-history, and undo records only after the project transaction commits, using one shared group identity.
6. Return a typed terminal outcome; never collapse a no-op, rejection, conflict, cancellation, ambiguous partial multi-document commit, committed history warning, or failure into `void`.

AiRuntime may accept multiple provider tool calls only when every call crosses the existing strict LLM action bridge and runtime validation without rejection. Both immediate execution and post-confirmation execution use the same batch primitive.

This decision covers pure project actions in the current LLM allowlist. External effects and multi-document sagas require explicit prepare/commit/compensation contracts before admission.

## Consequences

- One provider plan produces one project commit and one undo group.
- A rejected or failed action cannot leave an earlier project mutation committed.
- A multi-document flush that commits an unknowable prefix is reported as ambiguous and never represented as a fully applied plan.
- Post-commit history failures remain visible as `committed-with-warning` and are never safe to retry blindly.
- The provider still cannot enlarge its action allowlist, target set, or argument bounds.
