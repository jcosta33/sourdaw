# ADR 0030: LLM batches may bind a newly created bus

- Status: Accepted
- Date: 2026-08-01

## Context

Provider tools currently target objects by stable project ID. That is correct for existing project state, but it prevents one atomic request from creating a bus and then inserting a device or creating sends to that bus: the provider cannot know the application-owned bus ID before execution.

`createBus` already supports an internal replay identity, and the atomic Command batch preflights every action before committing. The missing boundary is a safe way to lower a provider-local reference into that ordinary AppAction identity without trusting a provider-supplied project ID or creating a second command system.

## Decision

The provider-facing `createBus` tool may declare an optional batch-local binding. Later tool calls in the same plan may use `$<binding>` in target arguments.

AiRuntime owns compilation of those references:

1. Bindings use a bounded identifier grammar, are unique within the plan, and become visible only after their `createBus` call.
2. Missing, duplicate, malformed, forward, or capability-incompatible references reject the complete provider plan.
3. AiRuntime allocates the real bus ID and projects that bus only into the plan's temporary grounding context.
4. A bound target still needs user-request evidence: its clause must name the new bus or use unambiguous new-object language when exactly one compatible earlier binding exists.
5. Binding metadata is removed before strict RuntimeAction validation. Only after validation does AiRuntime materialize the internal `busId` on the `createBus` AppAction.
6. Confirmation, revision checks, atomic execution, receipts, undo, and collaboration receive only ordinary stable-ID AppActions.

This decision initially admits bindings only for `createBus`. Other creation actions require their own proven internal identity and capability mapping before they may join the same compiler.

## Consequences

- Requests such as “create a Vocal Plate bus, add a reverb to it, and send Vocals to it” can execute as one confirmed atomic batch.
- Providers cannot bind existing objects, smuggle replay fields through RuntimeAction validation, or reference a future creation.
- The AppAction registry, domain handlers, and Automerge write path remain unchanged.
- More creation types can extend the compiler without changing provider adapters or the execution boundary.
