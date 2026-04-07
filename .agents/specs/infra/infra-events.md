# Events and Event Bus Infrastructure

> **Changelog (review revision):**
>
> - Removed `off()` from public API (returned unsubscribe function is the only unsubscribe mechanism)
> - Removed `handlerCount()`, `registeredEvents()`, `hasHandlers()` from public API (introspection with no production caller)
> - Deferred `createDomainEvent()` to v2 (event payloads are plain typed objects; bus stamps metadata at emit time if needed)
> - Changed `createEventLog` to compose with the bus directly (`createEventLog(bus, options)`) — no public `append()` method
> - Deferred `createEventLog` itself to v2 (production debugging tool without a consumer yet; `recordEvents()` covers testing)
> - Resolved open question: branded `EventId`/`CorrelationId` deferred to v2, plain strings for now
> - Resolved open question: `hasHandlers()`/`handlerCount()` excluded from v1
> - Noted `Promise.withResolvers()` as the preferred internal primitive for idle waiting
> - Clarified that EventBus does NOT share internal subscription code with Store

## Context

The architecture defines `events/` as a public contract surface for meaningful business occurrences. Events are for cases where another concern should react independently; they are not meant for every tiny state mutation, and they should not replace direct use-case calls when a direct dependency is cleaner.

This feature exists to replace the old company event helpers with a typed, minimal, async-safe event bus and event primitives that fit the DAW architecture.

---

## Goal

Implement a typed event bus that is easy for modules to use, easy to test, and explicit enough to discourage event-noise abuse.

---

## User-visible behavior

From the caller's point of view:

- a module defines event payloads as plain typed objects in its EventMap
- subscribers register with `on`, `once`, and `onAny`
- unsubscription is done by calling the returned function (no separate `off`)
- `emit()` is async and resolves when all handlers complete
- tests can `await bus.waitForIdle()` before asserting effects
- tests can use `recordEvents(bus)` to capture emissions without patching internals

---

## Scope

## **In scope:**

- typed `createEventBus<TEventMap>()`
- typed handler registration (`on`, `once`, `onAny`)
- unsubscription via returned function
- async `emit()`
- `waitForIdle()`, `pendingCount`, `isIdle`
- `recordEvents()` testing helper

## **Non-goals (explicitly out of scope):**

- `off(event, handler)` as a separate API (unsubscribe via returned function only)
- `handlerCount()`, `registeredEvents()`, `hasHandlers()` (introspection with no production caller)
- `createDomainEvent()` (deferred to v2 — plain typed payloads are sufficient for v1)
- `createEventLog()` (deferred to v2 — `recordEvents()` covers testing needs)
- branded `EventId` / `CorrelationId` types (deferred to v2 — plain strings for now)
- shared internal subscription code with Store
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
   event name string → payload type.

2. **Async-first emit** — `emit(event, payload)` must return `Promise<void>` and resolve when all registered handlers finish.

3. **Subscription API** — support:
    - `on(event, handler)` → returns `() => void` unsubscribe function
    - `once(event, handler)` → returns `() => void` unsubscribe function
    - `onAny(handler)` → returns `() => void` unsubscribe function

4. **No separate `off`** — unsubscription is done exclusively by calling the function returned from `on`/`once`/`onAny`. This is the only mechanism. No `off(event, handler)` on the public API.

5. **Idle detection** — support:
    - `waitForIdle(): Promise<void>`
    - `pendingCount`
    - `isIdle`

6. **Plain-object event payloads** — event payloads are whatever the EventMap defines. No wrapper factory required. Modules define their payloads as plain types:

```ts
type ArrangementEvents = {
    'track:added': { trackId: string; name: string; kind: TrackKind };
    'clip:moved': { clipId: string; toPosition: number };
};
```

And usage is:

```ts
await eventBus.emit('track:added', { trackId, name, kind });
```

7. **No swallowed test races** — async handlers must be included in idle tracking so tests can reliably wait.

8. **No event-name magic** — event names are explicit string keys, not reflection or decorator output.

9. **Testing helper** — provide `recordEvents(bus)` that subscribes via `onAny` and returns a readable array of recorded events plus a `stop()` function.

10. **Architecture fit** — the spec must reinforce that business events are meaningful occurrences, not a general substitute for module boundaries.

11. **No shared subscription internals** — the EventBus must NOT share internal listener management code with Store. Each module owns its own implementation.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Plain objects and closures only
- No public classes
- No decorators
- No default exports
- No browser-only event APIs as the core abstraction
- Do not introduce a global singleton bus in this spec
- `Promise.withResolvers()` is the preferred internal primitive for idle waiting

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
    once<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => void;
    onAny(handler: WildcardHandler<TEvents>): () => void;
    emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void>;
    waitForIdle(): Promise<void>;
    readonly pendingCount: number;
    readonly isIdle: boolean;
};
```

**Considered and rejected:**

- `off(event, handler)` as a separate unsubscribe method
    - rejected because it creates two ways to unsubscribe; the returned function is simpler and doesn't require the caller to hold a stable handler reference
- `handlerCount()`, `registeredEvents()`, `hasHandlers()` introspection methods
    - rejected because no production code calls them; the bus's own unit tests can access internals if needed
- synchronous-only `emit`
    - rejected because handler chains in this app are often async and tests need a real completion boundary
- class-based bus
    - rejected because infra direction is factory functions + plain objects
- `EventTarget`
    - rejected because typed payloads and async completion semantics are awkward

### Decision: Event payload model (v1)

**Chosen:**

Event payloads are plain typed objects defined by the EventMap. No `createDomainEvent()` wrapper. No metadata ceremony. Modules define their event types directly:

```ts
type ArrangementEvents = {
    'track:added': { trackId: string; name: string; kind: TrackKind };
};

await eventBus.emit('track:added', { trackId, name, kind });
```

**Considered and rejected:**

- `createDomainEvent(type, data, metadata?)` wrapper
    - rejected for v1 because it forces the event name to appear twice (once as the bus key, once inside the domain event object), adds metadata ceremony that callers rarely care about, and can be added non-breakingly in v2 when correlation/causation chains are actually needed
- event classes
    - rejected because they add ceremony without adding useful safety here

### Decision: Internal async wait primitive

**Chosen:**

`Promise.withResolvers()` for idle waiting and one-shot test helpers.

**Considered and rejected:**

- manual resolver arrays
    - rejected because `Promise.withResolvers()` makes the code smaller and clearer

### Decision: Event log

**Chosen:**

Deferred to v2. `recordEvents()` in `testing/` covers all current needs.

**Considered and rejected:**

- `createEventLog(maxSize)` as a standalone append-only ring buffer
    - rejected for v1 because it is a production debugging tool without a concrete consumer yet; `recordEvents()` is sufficient for tests
- `createEventLog(bus, options)` with automatic `onAny` wiring
    - this is the preferred shape IF event log is added in v2 — no public `append()` method, the log subscribes internally

### Decision: No shared subscription internals with Store

**Chosen:**

EventBus and Store each own their own listener management. No shared `SubscriptionManager`.

**Considered and rejected:**

- shared `SubscriptionManager<T>` from the research
    - rejected because the two have different semantics (Store listeners receive no arguments; EventBus handlers receive typed payloads and return `Promise<void>`). Coupling them creates a false DRY abstraction.

---

## Acceptance criteria

- [ ] `createEventBus<T>()` enforces typed payloads by event name
- [ ] `emit()` waits for async handlers
- [ ] `once()` fires exactly once then auto-unsubscribes
- [ ] `onAny()` observes all emissions with event name and payload
- [ ] `waitForIdle()` resolves when all in-flight handlers complete
- [ ] `pendingCount` and `isIdle` reflect in-flight work
- [ ] Unsubscription is done exclusively by calling the returned function
- [ ] No `off`, `handlerCount`, `registeredEvents`, or `hasHandlers` on public API
- [ ] `recordEvents()` enables clean assertions in tests
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/Event/
  createEventBus.ts
  types.ts
  testing/
    recordEvents.ts
```

Recommended bus behavior:

- copy handler sets before iterating so unsubscribe during emit does not corrupt iteration
- track `pendingCount` around the entire async dispatch
- use `Promise.withResolvers()` for `waitForIdle()` implementation
- `waitForIdle()` should resolve immediately when already idle
- `onAny()` should receive both the event name and payload
- `once()` should unsubscribe before invoking the handler to prevent re-entrancy issues
- internal method references must use closed-over functions, not `this` (plain objects break if destructured)

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
- [ ] Unit: returned unsubscribe function removes handler
- [ ] Unit: `once()` fires exactly once
- [ ] Unit: `onAny()` receives event name and payload
- [ ] Unit: `emit()` awaits async handlers
- [ ] Unit: `waitForIdle()` resolves after pending handlers finish
- [ ] Unit: `pendingCount` increments and decrements correctly
- [ ] Unit: `recordEvents()` records emissions
- [ ] Unit: unsubscribe during emit does not corrupt iteration
- [ ] Manual: wire a small subscriber to a module event and verify end-to-end behavior

---

## Open questions

None. All previously open questions have been resolved as design decisions.

---

## Tradeoffs and risks

Async-first emission makes tests and orchestration cleaner, but it also makes event handlers part of the flow-control surface. That is acceptable here because the DAW already needs deterministic async behavior for orchestration.

The main risk is overusing events. The architecture already guards against that: use events only for meaningful independent reactions, not as a universal escape hatch.

Deferring `createDomainEvent` and `createEventLog` to v2 means correlation/causation tracing and production debugging are not available yet. That is acceptable because neither has a concrete consumer in the current codebase.
