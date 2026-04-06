# Events and Event Bus Infrastructure

## Context

The architecture defines `events/` as a public contract surface for meaningful business occurrences. Events are for cases where another concern should react independently; they are not meant for every tiny state mutation, and they should not replace direct use-case calls when a direct dependency is cleaner.

The infra research already proposes a typed event bus, plain-object domain events, wildcard subscriptions, idle detection for tests, and an event log.

This feature exists to replace the old company event helpers with a typed, minimal, async-safe event bus and event primitives that fit the DAW architecture.

---

## Goal

Implement a typed event bus and domain-event primitive that are easy for modules to use, easy to test, and explicit enough to discourage event-noise abuse.

---

## User-visible behavior

From the caller’s point of view:

- a module can define meaningful events as plain typed objects
- subscribers can register with `on`, `off`, `once`, and `onAny`
- `emit()` is async and resolves when all handlers complete
- tests can `await bus.waitForIdle()` before asserting effects
- a test can record emitted events without patching internals

---

## Scope

## **In scope:**

- typed `createEventBus<TEventMap>()`
- typed handler registration and unregistration
- async `emit()`
- `waitForIdle()`
- `once()`
- wildcard subscriptions
- plain-object domain event helper
- bounded `EventLog`
- event test helper(s)

## **Non-goals (explicitly out of scope):**

- event sourcing
- replay engine
- persistence of events
- distributed messaging
- browser `EventTarget` compatibility
- decorators / metadata magic
- command bus / mediator patterns
- using events for every field-level store write

---

## Requirements

1. **Typed event map** — the bus must be generic over an `EventMap`:
   event name string -> payload type.

2. **Async-first emit** — `emit(event, payload)` must return `Promise<void>` and resolve when all registered handlers finish.

3. **Stable subscription API** — support:
    - `on`
    - `off`
    - `once`
    - `onAny`

4. **Idle detection** — support:
    - `waitForIdle(): Promise<void>`
    - `pendingCount`
    - `isIdle`

5. **Plain-object events** — implement `createDomainEvent(type, data, metadata?)` returning a readonly object, not a class instance.

6. **Bounded event log** — implement an optional `createEventLog(maxSize)` ring buffer for debugging and tests.

7. **No swallowed test races** — async handlers must be included in idle tracking so tests can reliably wait.

8. **No event-name magic** — event names are explicit string keys, not reflection or decorator output.

9. **Minimal testing helper** — provide a tiny `recordEvents(bus)` or equivalent helper that records emitted events for assertions.

10. **Architecture fit** — the spec must reinforce that business events are meaningful occurrences, not a general substitute for module boundaries.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Plain objects and closures only
- No public classes
- No decorators
- No default exports
- No browser-only event APIs as the core abstraction
- Do not introduce a global singleton bus in this spec
- Internal utilities may be shared with Store infra if cleanly separated

---

## Design decisions

### Decision: Bus API shape

**Chosen:**

```ts
type EventMap = Record<string, unknown>;

type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;
type WildcardHandler<TEvents extends EventMap> = (
    event: keyof TEvents & string,
    payload: TEvents[keyof TEvents]
) => void | Promise<void>;

type EventBus<TEvents extends EventMap> = {
    on<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => void;
    off<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): void;
    once<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => void;
    onAny(handler: WildcardHandler<TEvents>): () => void;
    emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void>;
    waitForIdle(): Promise<void>;
    readonly pendingCount: number;
    readonly isIdle: boolean;
};
```

**Considered and rejected:**

- synchronous-only `emit`
    - rejected because handler chains in this app are often async and tests need a real completion boundary
- class-based bus
    - rejected because infra direction is factory functions + plain objects
- `EventTarget`
    - rejected because typed payloads and async completion semantics are awkward

### Decision: Domain event shape

**Chosen:**

A plain readonly object:

```ts
type DomainEvent<TType extends string, TData extends Record<string, unknown>> = Readonly<{
    type: TType;
    data: TData;
    metadata: {
        eventId: string;
        timestamp: number;
        correlationId?: string;
        causationId?: string;
    };
}>;
```

**Considered and rejected:**

- event classes
    - rejected because they add ceremony without adding useful safety here
- untyped string payloads
    - rejected because this is infrastructure and should preserve types

### Decision: Internal async wait primitive

**Chosen:**

`Promise.withResolvers()` may be used internally for idle waiting and one-shot test helpers.

**Considered and rejected:**

- custom resolver juggling everywhere
    - rejected because `Promise.withResolvers()` makes the code smaller and clearer
- `using` / `Symbol.dispose`
    - rejected as a core requirement because browser availability is still limited

---

## Acceptance criteria

- [ ] `createEventBus<T>()` enforces typed payloads by event name
- [ ] `emit()` waits for async handlers
- [ ] `once()` unsubscribes after first invocation
- [ ] `onAny()` observes all emissions
- [ ] `waitForIdle()` resolves when all in-flight handlers complete
- [ ] `pendingCount` and `isIdle` reflect in-flight work
- [ ] `createDomainEvent()` returns a plain readonly object
- [ ] `createEventLog()` keeps only the most recent `maxSize` entries
- [ ] `recordEvents()` or equivalent enables clean assertions in tests
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/Event/
  createEventBus.ts
  createDomainEvent.ts
  createEventLog.ts
  types.ts
  testing/
    recordEvents.ts
  internal/
    createSubscriptionRegistry.ts
```

Recommended bus behavior:

- copy handler sets before iterating so unsubscribe during emit does not corrupt iteration
- track `pendingCount` around the entire async dispatch
- `waitForIdle()` should resolve immediately when already idle
- `onAny()` should receive both the event name and payload
- `once()` should unsubscribe before awaiting user handler continuation

Recommended event log behavior:

- append-only bounded buffer
- oldest entries dropped when exceeding max size
- log entry includes:
    - event name
    - payload
    - timestamp
    - handler count at emit time

Recommended test helper:

```ts
type RecordedEvent<TEvents extends EventMap> = {
    event: keyof TEvents & string;
    payload: TEvents[keyof TEvents];
};

export const recordEvents = <TEvents extends EventMap>(bus: EventBus<TEvents>) => {
    const entries: RecordedEvent<TEvents>[] = [];
    const stop = bus.onAny((event, payload) => {
        entries.push({ event, payload });
    });

    return {
        entries,
        stop,
    };
};
```

---

## Test plan

- [ ] Unit: `on()` handler fires for matching event only
- [ ] Unit: `off()` removes handler
- [ ] Unit: `once()` fires exactly once
- [ ] Unit: `onAny()` receives event name and payload
- [ ] Unit: `emit()` awaits async handlers
- [ ] Unit: `waitForIdle()` resolves after pending handlers finish
- [ ] Unit: `pendingCount` increments and decrements correctly
- [ ] Unit: `createDomainEvent()` fills default metadata
- [ ] Unit: `createEventLog()` enforces max size
- [ ] Unit: `recordEvents()` records emissions
- [ ] Manual: wire a small subscriber to a module event and verify end-to-end behavior

---

## Open questions

- [ ] **[MINOR]** Whether to include `hasHandlers()` / `handlerCount()` in v1 or keep the surface smaller
- [ ] **[MINOR]** Whether branded `EventId` / `CorrelationId` types are worth v1, or whether plain strings are sufficient initially

---

## Tradeoffs and risks

Async-first emission makes tests and orchestration cleaner, but it also makes event handlers part of the flow-control surface. That is acceptable here because the DAW already needs deterministic async behavior for orchestration.

The main risk is overusing events. The architecture already guards against that: use events only for meaningful independent reactions, not as a universal escape hatch.
