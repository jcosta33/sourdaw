# ADR 0034: Owner-published agent protocol versions

- Status: Accepted
- Date: 2026-08-15

## Context

Agent-facing commands, queries, receipts, provider protocols, device manifests, production briefs, transforms, and adapters evolve independently. Their existing version declarations and compatibility behavior lived beside their implementations, but there was no complete application-level publication surface. A central hand-maintained operation list would drift from the registries that actually admit work.

## Decision

1. Each owning module publishes its schema version, capabilities, operation versions, current availability, and migration or read-only preservation behavior.
2. Operation inventories derive from the owner's executable registry, query type list, device catalog, transform handler map, or provider/adapter declarations. The app composition layer aggregates those contracts but does not duplicate their operations.
3. Unsupported schemas fail closed. Retired replay actions remain persistence tombstones or are discarded during hydration; they never become executable through casts or fallback parsing.
4. Canonical project state stores the resulting domain state and immutable evidence. Loading a project never depends on replaying an obsolete command.
5. Availability is explicit per operation. Runtime- or configuration-dependent adapters do not claim unconditional availability.

## Consequences

- A protocol change updates the owning declaration and its implementation together.
- App-level census tests can detect a missing owner contract without becoming a second action registry.
- Future provider and compatibility negotiation can consume one complete manifest while preserving module ownership.
