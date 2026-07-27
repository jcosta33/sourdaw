# ADR 0017: LLM routing and send commands

**Status:** Accepted

## Context

The provider bridge can adjust the level of an existing send, but it cannot create or remove sends or route a track output. The underlying application actions already own these mutations, yet their replay contracts are incomplete: output changes have no semantic inverse, and removing a pre-fader send restores it as post-fader.

Sidechain tools are not included in this decision. Their current action payload identifies only source and target tracks while the actual route is device-specific, so exposing them would permit ambiguous device selection and removal.

## Decision

- Expose `setTrackOutput`, `addSend`, and `removeSend` through the strict provider tool allowlist alongside `setSend`.
- Admit output routing only from existing project tracks to a distinct bus or master track represented in the provider context.
- Admit send creation only for an absent source/bus pair, send adjustment only for an existing pair, and removal only for an existing pair.
- Validate exact arguments and finite send levels from zero through one before producing an application action.
- Include `outputId` in the command-relevant project context so plans can distinguish current routing from requested routing.
- Carry the context's current output or complete send snapshot into provider-produced actions as an expected-state precondition.
- Give output changes an exact prior-output inverse and preserve a removed send's level and pre/post-fader mode in its internal inverse.
- Make routing inverses conditional on the state written by the forward action so later local or collaborative edits produce a conflict instead of being overwritten by undo or compensation.
- Treat stale or rejected routing execution as a conflict so replay and atomic batches cannot consume an unapplied mutation.
- If a multi-document commit is ambiguous, re-read durable routing truth and reconcile the live engine from that truth before reporting the terminal outcome.
- Require every deferred external effect to provide a durable-truth ambiguous-commit reconciler; this applies to routing and provider-executable track lifecycle handlers.
- Mark deferred-only handlers as not requiring abort compensation because transaction abort restores project truth before any external effect runs.
- Use one mutation identity for add, set, and remove operations targeting the same send within one provider batch.

## Consequences

Provider plans can build and revise ordinary bus routing through the same Command, Automerge, undo, compensation, and live-engine paths as the UI. They cannot target hardware outputs, create ambiguous sidechains, invent destinations, or combine contradictory mutations of one send in a single batch.
