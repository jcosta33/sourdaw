# Dependency Injection and Testing Infrastructure

> **Changelog (review revision):**
>
> - Renamed `registerOnce` → `register` (safe default, throws on duplicate)
> - Renamed `register` → `set` (deliberate overwrite, test/escape hatch)
> - Renamed `Container.reset()` → `container.clear()`
> - Removed `has()` from public API (internal only, no production caller)
> - Added destructure-in-body convention for `inject()` to reduce arrow nesting
> - Clarified that `inject` is the correct name (not `di` — abbreviations are banned by conventions)
> - Resolved open question: `createChild()` is internal to `testing/` in v1
> - Resolved open question: strict-mode guard deferred to v2

## Context

The architecture already chooses `inject()` as the canonical business-layer DI mechanism. Use cases and other injectables declare dependencies explicitly, resolve at call time, and are testable through `injectDependencies()`. The same doc also defines important constraints:

- dependencies are memoized after first resolution
- `container.clear()` must clear caches for tests
- circular dependency chains must throw with a chain
- async dependencies are forbidden
- React hooks/components do not use `inject()`
- no `container.get()` at module top-level
- bootstrap registrations happen before use cases run

This feature exists to replace the old company DI/container/testing helpers while preserving the architecture-level ergonomics already chosen by the codebase.

---

## Goal

Implement a functional DI container plus `inject()` abstraction and testing helpers that preserve the current app-facing usage style while replacing the old company implementation underneath.

---

## User-visible behavior

From the caller's point of view:

- business-layer code writes:

```ts
export const addTrack = inject(
    { eventBus: EventBus, logger: Logger, trackRepo: TrackRepo },
    (deps) => (input: AddTrackInput) => {
        const { eventBus, logger, trackRepo } = deps;
        // use deps here
    }
);
```

- the injectable resolves lazily on first invocation
- later invocations reuse the resolved invoker
- tests can override dependencies cleanly with `injectDependencies()`
- tests can create typed spies and mocks without hand-written boilerplate
- circular dependency bugs fail loudly with a useful chain

---

## Scope

## **In scope:**

- container primitive
- singleton container facade used by app bootstrap
- `register` (throws on duplicate — safe default)
- `set` (overwrites silently — escape hatch for tests)
- `get`
- `clear`
- `inject()`
- injectable memoization
- circular dependency detection
- async-dependency rejection
- `injectDependencies()`
- typed `spy<T>()`
- generic `createMock<T>()`
- test container override helper

## **Non-goals (explicitly out of scope):**

- `has()` on the public API (internal only, no production caller)
- `createChild()` as a public API (internal to `testing/` only in v1)
- dev-only strict-mode guard (deferred to v2)
- decorators
- reflect-metadata
- constructor injection framework
- React injection hooks
- async dependency graphs
- service locator usage inside presentations
- replacing module boundaries with DI everywhere
- public class-based container API

---

## Requirements

1. **Preserve current business-layer usage** — `inject()` is the primary public API for module code.

2. **Dependency map resolution rules** — dependency map values must support:
    - class/service tokens already used by the codebase
    - other injectables
    - plain values / functions / constants

3. **Factory returns invoker** — the `inject()` factory must return the callable business function; callers never see the dependency map at invocation time.

4. **Lazy resolution** — dependencies resolve on first callable invocation, not at module import time.

5. **Memoized invoker** — resolved invokers are cached after first resolution.

6. **Clear semantics** — `container.clear()` must clear all registrations and injectable caches so tests can re-resolve against fresh mocks.

7. **Circular dependency detection** — when `A -> B -> A` occurs, resolution must throw with the full chain.

8. **Async dependencies forbidden** — if any dependency map value resolves to a `Promise`, `inject()` must throw during setup or resolution.

9. **No top-level `container.get()` usage pattern** — the spec must reinforce that top-level reads are forbidden; module code should use `inject()` instead.

10. **Test override ergonomics** — implement `injectDependencies(injectable, mocks)` so tests can replace all dependencies cleanly.

11. **Testing utilities** — implement:

- `spy<T>()`
- `createMock<T>()`
- `createTestContainer()`

12. **Bootstrap compatibility** — support app bootstrap registration before business-layer execution begins.

13. **Safe-by-default registration** — `register()` throws on duplicate registration. `set()` overwrites silently and is the deliberate escape hatch for tests and dynamic overrides.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Functional implementation only
- No public classes
- No decorators
- No reflect-metadata
- No default exports
- No floating promises in infra code
- No React dependency in DI helpers
- The external API must favor the current architecture doc over the generic symbol-token-only research draft

---

## Design decisions

### Decision: Public DI style

**Chosen:**

Preserve the existing app-facing DI style centered on `inject()` and a container facade.

**Considered and rejected:**

- `di` as the function name
    - rejected because the conventions doc bans abbreviated names; `inject` is a verb that describes what it does
- switching the codebase to explicit symbol-token container calls everywhere
    - rejected because it would fight the current architecture and create migration churn
- decorator-based DI
    - rejected because it adds hidden magic and is unnecessary here
- curried form `inject(deps)(factory)`
    - rejected because dangling `)(` in the middle is harder to read than the two-argument form

### Decision: inject() call-site convention

**Chosen:**

Destructure `deps` inside the body, not in the parameter list. This reduces visual nesting and shifts weight to the business logic:

```ts
export const addTrack = inject(
    { eventBus: EventBus, logger: Logger, trackRepo: TrackRepo },
    (deps) =>
        (input: AddTrackInput): Track | null => {
            const { eventBus, logger, trackRepo } = deps;

            const state = trackRepo.getState();

            if (state === null) {
                logger.log('addTrack called before store was ready');
                return null;
            }

            const track = createTrack(input);

            trackRepo.setState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: track.id,
            });

            eventBus.emit(
                new TrackAddedEvent({
                    trackId: track.id,
                    name: track.name,
                    kind: track.kind,
                })
            );

            return track;
        }
);
```

**Considered and rejected:**

- destructuring in the parameter (`({ eventBus, logger, trackRepo }) =>`)
    - rejected because it creates a long, noisy parameter line that competes visually with the real function signature

### Decision: Container shape

**Chosen:**

Implement a functional container internally, but expose the container behavior the current architecture expects:

```ts
type ContainerApi = {
    register<T>(token: DependencyKey<T>, value: T): void; // throws on duplicate
    set<T>(token: DependencyKey<T>, value: T): void; // overwrites silently
    get<T>(token: DependencyKey<T>): T;
    clear(): void;
};
```

`DependencyKey<T>` may internally support multiple token kinds, but the app-facing behavior must support the current class-token usage patterns.

`has()` is available internally for parent-child lookup but is not part of the public API — no production code calls it.

**Considered and rejected:**

- `registerOnce` / `register` naming pair
    - rejected because `register` should be the safe default (throw on duplicate); the overwrite path should look deliberate (`set`)
- `reset()` as the clearing method name
    - rejected because `clear()` says what it does (empties registrations) and matches `Map.clear()` / `Set.clear()` conventions
- requiring only branded symbol tokens
    - rejected for v1 compatibility
- exporting only `createContainer()` with no shared facade
    - rejected because bootstrap and tests already assume a central app container pattern

### Decision: Injectable resolution

**Chosen:**

`inject()` memoizes the resolved invoker and stores it against an internal token. `container.clear()` clears those cached invokers.

**Considered and rejected:**

- re-resolving dependencies on every call
    - rejected because the architecture explicitly expects memoization
- resolving at import time
    - rejected because it races bootstrap and breaks tests

### Decision: Testing helpers

**Chosen:**

Provide three layers:

- `spy<T>()` for typed method spies
- `createMock<T>()` for quick mock objects
- `injectDependencies(injectable, mocks)` for injectable-focused test setup

**Considered and rejected:**

- making all tests hand-roll overrides manually
    - rejected because that recreates the pain the current helper is meant to solve

### Decision: createChild() visibility

**Chosen:**

`createChild()` is internal to `testing/` in v1. It is used by `createTestContainer()` but not exposed as a public container method.

**Considered and rejected:**

- exposing `createChild()` publicly
    - rejected because no production code needs it in v1; testing helpers are the only consumer

---

## Acceptance criteria

- [ ] `inject()` supports dependency maps containing class tokens, injectables, and plain values
- [ ] injectables resolve lazily on first invocation
- [ ] injectables are memoized after first invocation
- [ ] `container.clear()` clears all registrations and injectable caches
- [ ] circular dependency chains throw with a readable chain
- [ ] async dependencies are rejected
- [ ] `register()` throws on duplicate registration
- [ ] `set()` overwrites existing registrations silently
- [ ] `injectDependencies()` enables isolated dependency overrides in tests
- [ ] `spy<T>()` and `createMock<T>()` are usable in tests without type-casting noise
- [ ] `has()` is not on the public API surface
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/DependencyInjector/
  Container.ts
  inject.ts
  types.ts
  testing/
    injectDependencies.ts
    createTestContainer.ts
    spy.ts
    createMock.ts
  internal/
    containerState.ts
    injectableRegistry.ts
    resolutionStack.ts
    createChild.ts
```

Suggested external usage:

```ts
export const addTrack = inject(
    { eventBus: EventBus, logger: Logger, trackRepo: TrackRepo },
    (deps) =>
        (input: AddTrackInput): Track | null => {
            const { eventBus, logger, trackRepo } = deps;

            const state = trackRepo.getState();

            if (state === null) {
                logger.log('addTrack called before store was ready');
                return null;
            }

            const track = createTrack(input);

            trackRepo.setState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: track.id,
            });

            eventBus.emit(
                new TrackAddedEvent({
                    trackId: track.id,
                    name: track.name,
                    kind: track.kind,
                })
            );

            return track;
        }
);
```

Resolution rules to implement:

- class/service token:
  resolve from container registration
- injectable:
  resolve recursively to its invoker
- plain value:
  pass through as-is

Testing helper sketch:

```ts
export const injectDependencies = <TInjectable, TMocks>(injectable: TInjectable, mocks: TMocks) => {
    container.clear();
    // register provided mocks against the injectable dependency graph
    // return the same injectable so the test can call it directly
    return injectable;
};
```

`spy<T>()` should prefer explicit typed method mocks rather than untyped ad hoc `vi.fn()` casts.

`createMock<T>()` may use a Proxy internally, but keep the public API simple.

---

## Test plan

- [ ] Unit: `register()` and `get()` resolve registered values
- [ ] Unit: `register()` throws on duplicate registration
- [ ] Unit: `set()` overwrites existing registrations silently
- [ ] Unit: `clear()` clears container state and injectable cache
- [ ] Unit: `inject()` resolves plain values correctly
- [ ] Unit: `inject()` resolves class-token dependencies correctly
- [ ] Unit: `inject()` resolves nested injectables correctly
- [ ] Unit: injectable is memoized after first call
- [ ] Unit: circular dependencies throw with a full chain
- [ ] Unit: async dependency value causes failure
- [ ] Unit: `spy<T>()` captures calls with correct typing
- [ ] Unit: `createMock<T>()` can build mocks for interface-shaped collaborators
- [ ] Unit: `injectDependencies()` overrides dependencies for a test
- [ ] Manual: bootstrap a small container, register app services, and call one injected use case end-to-end

---

## Open questions

None. All previously open questions have been resolved as design decisions.

---

## Tradeoffs and risks

The biggest tradeoff is compatibility versus theoretical purity. The generic research draft leans toward branded symbol tokens everywhere, but the current architecture already standardized on `inject()` with container-backed class-token resolution. This spec chooses compatibility so the replacement can land cleanly.

The main risk is preserving too much legacy surface. The mitigation is to preserve only the ergonomics the architecture depends on, while replacing the old implementation underneath with smaller, functional internals.
