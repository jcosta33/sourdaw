# Functional TypeScript infrastructure modules specification

**This document specifies a set of infrastructure modules — DI container, Store, EventBus, AppError, Storage backends, and test utilities — built entirely with functional patterns in TypeScript.** Every module uses factory functions returning plain objects, closures for encapsulation, branded types for safety, and discriminated unions for extensibility. No classes, no decorators, no reflect-metadata. The architecture draws from Effect-TS's compositional model, Preact Signals' reactive primitives, mitt's typed event maps, and neverthrow's Result type — synthesized into a lightweight, cohesive system designed for testability and type safety from registration to resolution.

---

## Module structure and shared internals

The library follows a flat module structure with an internal utilities layer that is never exported publicly. Every public API uses the `createX()` factory pattern, returning a plain object whose private state lives in closures.

```
src/
├── index.ts                    # Public barrel — explicit named exports only
├── types.ts                    # All public type definitions
├── container/
│   ├── create-container.ts     # DI container factory
│   ├── token.ts                # createToken, Token<T> branded type
│   └── inject.ts               # inject() helper for resolution
├── store/
│   ├── create-store.ts         # Store factory
│   ├── readonly.ts             # asReadonly() wrapper
│   └── derived.ts              # createDerivedStore()
├── event-bus/
│   ├── create-event-bus.ts     # EventBus factory
│   ├── domain-event.ts         # DomainEvent type + createDomainEvent()
│   └── event-log.ts            # EventLog bounded buffer
├── storage/
│   ├── memory.ts               # createMemoryStorage()
│   ├── web-storage.ts          # createWebStorage() for localStorage/session
│   └── types.ts                # StorageBackend interface
├── errors/
│   ├── app-error.ts            # AppError discriminated union + factories
│   └── result.ts               # Result<T,E>, Ok, Err, tryCatch, map, flatMap
├── testing/
│   ├── create-spy.ts           # createSpy<T>() typed spy factory
│   ├── create-mock.ts          # createMock<T>() Proxy-based mock
│   └── create-test-container.ts # Test DI container with override support
└── internal/
    ├── subscription-manager.ts # Shared pub-sub core (used by Store + EventBus)
    ├── disposable-tracker.ts   # LIFO cleanup tracking
    └── id.ts                   # Branded ID factories (EventId, CorrelationId)
```

The **public barrel** (`index.ts`) uses explicit named exports — never `export *` — to control the API surface and enable tree-shaking. Internal utilities are implementation details and must not appear in the public API.

### Shared subscription manager

Both `Store` and `EventBus` need subscribe/notify/cleanup semantics. Extract this into a single internal utility to enforce DRY:

```typescript
// internal/subscription-manager.ts
type Listener<T> = (value: T) => void;
type Unsubscribe = () => void;

interface SubscriptionManager<T> {
    subscribe(listener: Listener<T>): Unsubscribe;
    notify(value: T): void;
    clear(): void;
    readonly size: number;
}

function createSubscriptionManager<T>(): SubscriptionManager<T> {
    const listeners = new Set<Listener<T>>();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify(value) {
            for (const fn of listeners) fn(value);
        },
        clear() {
            listeners.clear();
        },
        get size() {
            return listeners.size;
        },
    };
}
```

This utility is composed internally by `createStore`, `createEventBus`, and any module that needs observer semantics. Consumers never see it.

### Shared disposable tracker

Resource cleanup uses LIFO ordering. Every infrastructure object should implement `Disposable` (TypeScript 5.2+ `Symbol.dispose`):

```typescript
// internal/disposable-tracker.ts
type CleanupFn = () => void;

interface DisposableTracker {
    track(cleanup: CleanupFn): void;
    disposeAll(): void;
}

function createDisposableTracker(): DisposableTracker {
    const cleanups: CleanupFn[] = [];
    return {
        track(cleanup) {
            cleanups.push(cleanup);
        },
        disposeAll() {
            while (cleanups.length > 0) cleanups.pop()!();
        },
    };
}
```

---

## Dependency injection container

The DI system uses **branded symbol tokens** for type-safe registration and resolution, a `Map<symbol, Registration>` for the registry, lazy resolution with memoization, and a `Set<symbol>` for circular dependency detection at resolve time.

### Token design

Tokens are symbols branded with a phantom type parameter so TypeScript tracks which type each token resolves to. This prevents mixing up tokens and provides inference from registration through resolution:

```typescript
// container/token.ts
declare const __tokenBrand: unique symbol;

type Token<T> = symbol & { readonly [__tokenBrand]: T };

function createToken<T>(description: string): Token<T> {
    return Symbol(description) as Token<T>;
}
```

**Why branded symbols**: Plain symbols are all structurally identical to TypeScript. The phantom brand `{ [__tokenBrand]: T }` carries the service type `T` at the type level without any runtime cost. When `resolve<T>(token: Token<T>)` is called, `T` is inferred from the token, giving end-to-end type safety.

### Container interface

```typescript
type Factory<T> = (resolve: <U>(token: Token<U>) => U) => T;
type Scope = 'singleton' | 'transient';

interface Registration<T> {
    factory: Factory<T>;
    scope: Scope;
    instance?: T;
}

interface Container extends Disposable {
    register<T>(token: Token<T>, factory: Factory<T>, scope?: Scope): void;
    resolve<T>(token: Token<T>): T;
    has<T>(token: Token<T>): boolean;
    createChild(): Container; // Scoped child that inherits parent registrations
    [Symbol.dispose](): void;
}
```

### Implementation specification

The `createContainer` factory must satisfy these requirements:

**Lazy resolution.** Factories execute only when `resolve()` is called — never at registration time. For singleton scope, the result is cached after first resolution. For transient scope, the factory runs on every `resolve()` call.

**Circular dependency detection.** Maintain a `resolving: Set<symbol>` that tracks tokens currently being resolved in the call stack. Before invoking a factory, check if the token is already in the set. If so, throw an error with the full circular path. Remove the token from the set in a `finally` block.

```typescript
function createContainer(parent?: Container): Container {
    const registrations = new Map<symbol, Registration<any>>();
    const resolving = new Set<symbol>();

    function resolve<T>(token: Token<T>): T {
        const reg = registrations.get(token) ?? (parent ? undefined : undefined);
        // Check parent if not found locally
        if (!reg && parent?.has(token)) return parent.resolve(token);
        if (!reg) throw new Error(`No registration found for token: ${String(token)}`);

        if (reg.scope === 'singleton' && reg.instance !== undefined) {
            return reg.instance as T;
        }

        if (resolving.has(token)) {
            throw new Error(`Circular dependency detected resolving: ${String(token)}`);
        }

        resolving.add(token);
        try {
            const instance = reg.factory(resolve);
            if (reg.scope === 'singleton') reg.instance = instance;
            return instance as T;
        } finally {
            resolving.delete(token);
        }
    }

    return {
        register(token, factory, scope = 'singleton') {
            registrations.set(token, { factory, scope });
        },
        resolve,
        has(token) {
            return registrations.has(token) || (parent?.has(token) ?? false);
        },
        createChild() {
            return createContainer(/* self reference */);
        },
        [Symbol.dispose]() {
            registrations.clear();
        },
    };
}
```

**Caching semantics.** Singleton instances are stored directly on the `Registration` object as `instance?: T`. The cache check (`instance !== undefined`) runs before the circular dependency check, so already-resolved singletons short-circuit immediately. Transient registrations never cache.

**Test-time mock injection.** The container supports re-registration — calling `register()` with the same token overwrites the previous factory and clears any cached instance. The `createChild()` method creates a scoped container that inherits parent registrations but can override them locally without affecting the parent. This is the primary testing mechanism:

```typescript
// Production
const container = createContainer();
container.register(DbToken, () => createRealDb(), 'singleton');

// Test — override in child
const testContainer = container.createChild();
testContainer.register(DbToken, () => createMockDb(), 'singleton');
const db = testContainer.resolve(DbToken); // gets mock
```

### The inject helper

A convenience function that creates a lazy resolver bound to a container:

```typescript
function inject<T>(container: Container, token: Token<T>): () => T {
    let cached: T | undefined;
    return () => {
        if (cached === undefined) cached = container.resolve(token);
        return cached;
    };
}
```

This returns a zero-argument thunk that defers resolution until first call and caches the result. Useful for passing lazy dependencies without immediately resolving the entire graph.

---

## Store and ReadonlyStore

The store follows the **Svelte store contract** — the minimal reactive store interface that has proven successful across frameworks. It uses `get()` instead of `.value` to avoid proxy/getter magic and keep the API explicit.

### Type definitions

```typescript
type Listener<T> = (value: T) => void;
type Unsubscribe = () => void;
type Updater<T> = (current: T) => T;

interface ReadonlyStore<T> {
    get(): T;
    subscribe(listener: Listener<T>): Unsubscribe;
}

interface Store<T> extends ReadonlyStore<T> {
    set(value: T): void;
    update(fn: Updater<T>): void;
}
```

**`ReadonlyStore<T>`** exposes only `get` and `subscribe`. It is the interface consumed by UI components, derived stores, and any code that should not mutate state. **`Store<T>`** extends it with `set` and `update` — available only to the module that owns the state.

### createStore implementation spec

```typescript
function createStore<T>(initial: T): Store<T> & Disposable {
    let state = initial;
    const subs = createSubscriptionManager<T>();

    return {
        get: () => state,
        set(value) {
            if (!Object.is(state, value)) {
                state = value;
                subs.notify(state);
            }
        },
        update(fn) {
            this.set(fn(state));
        },
        subscribe(listener) {
            const unsub = subs.subscribe(listener);
            listener(state); // Emit current value immediately on subscribe
            return unsub;
        },
        [Symbol.dispose]() {
            subs.clear();
        },
    };
}
```

**Key behaviors.** `set()` uses `Object.is` equality to skip no-op updates. `subscribe()` immediately invokes the listener with the current value (Svelte convention — ensures subscribers are never in an uninitialized state). The store implements `Disposable` for automatic cleanup via `using`.

### asReadonly wrapper

```typescript
function asReadonly<T>(store: Store<T>): ReadonlyStore<T> {
    return {
        get: () => store.get(),
        subscribe: (listener) => store.subscribe(listener),
    };
}
```

Returns a new object with only `get` and `subscribe` — `set` and `update` are structurally absent, not just hidden behind `private`. This satisfies the Interface Segregation Principle: consumers depending on `ReadonlyStore<T>` cannot accidentally mutate state.

### Derived stores

```typescript
function createDerivedStore<T, D>(
    source: ReadonlyStore<T>,
    selector: (value: T) => D,
    equals?: (a: D, b: D) => boolean
): ReadonlyStore<D> {
    const eq = equals ?? Object.is;
    let current = selector(source.get());
    const subs = createSubscriptionManager<D>();

    source.subscribe((value) => {
        const next = selector(value);
        if (!eq(current, next)) {
            current = next;
            subs.notify(current);
        }
    });

    return {
        get: () => current,
        subscribe(listener) {
            const unsub = subs.subscribe(listener);
            listener(current);
            return unsub;
        },
    };
}
```

The `equals` parameter enables custom comparisons for complex derived values (e.g., deep equality for objects). The default `Object.is` works for primitives and reference-stable selections.

### Batch updates

A module-level batching function defers notifications until all mutations complete:

```typescript
let batchDepth = 0;
const pendingNotifications = new Set<() => void>();

function batch(fn: () => void): void {
    batchDepth++;
    try {
        fn();
    } finally {
        batchDepth--;
        if (batchDepth === 0) {
            const pending = [...pendingNotifications];
            pendingNotifications.clear();
            for (const notify of pending) notify();
        }
    }
}
```

The store's internal `notify` call should check `batchDepth` and defer to `pendingNotifications` when batching is active. This prevents glitchy intermediate states when updating multiple stores atomically.

---

## Storage backends

Storage backends abstract persistence behind a minimal synchronous interface. The store system composes with these backends for optional persistence.

```typescript
interface StorageBackend<T = unknown> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    delete(key: string): void;
}
```

Three implementations ship by default:

**Memory storage** — the default, backed by a `Map<string, T>`. Zero configuration, no serialization overhead. Used for ephemeral state and testing.

```typescript
function createMemoryStorage<T>(): StorageBackend<T> {
    const store = new Map<string, T>();
    return {
        get: (key) => store.get(key),
        set: (key, value) => {
            store.set(key, value);
        },
        delete: (key) => {
            store.delete(key);
        },
    };
}
```

**Web storage adapter** — wraps `localStorage` or `sessionStorage` with JSON serialization:

```typescript
function createWebStorage<T>(storage: Storage = localStorage): StorageBackend<T> {
    return {
        get(key) {
            const raw = storage.getItem(key);
            if (raw === null) return undefined;
            try {
                return JSON.parse(raw) as T;
            } catch {
                return undefined;
            }
        },
        set(key, value) {
            storage.setItem(key, JSON.stringify(value));
        },
        delete(key) {
            storage.removeItem(key);
        },
    };
}
```

**Persistent store composition** — a higher-order factory that wraps any `Store<T>` with a `StorageBackend<T>` for hydration on creation and persistence on change:

```typescript
function createPersistentStore<T>(
    initial: T,
    options: { key: string; storage: StorageBackend<T> }
): Store<T> & Disposable {
    const stored = options.storage.get(options.key);
    const store = createStore<T>(stored !== undefined ? stored : initial);

    // Persist on every change (skip the initial subscribe emission)
    let initialized = false;
    store.subscribe((value) => {
        if (initialized) options.storage.set(options.key, value);
        initialized = true;
    });

    return store;
}
```

This composition pattern keeps `createStore` simple and lets persistence be opt-in. The CRDT/Automerge backend is not included in core but follows the same `StorageBackend` interface — implementors wrap Automerge's `change`/`save` API behind `get`/`set`/`delete`.

---

## EventBus, DomainEvent, and EventLog

The event system uses the **EventMap generic pattern** (proven by mitt and emittery) for type-safe event names and payloads, combined with **async-first emission** and built-in idle detection for testing.

### Core types

```typescript
type EventMap = Record<string, unknown>;
type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
type WildcardHandler<T extends EventMap> = (type: keyof T & string, payload: T[keyof T]) => void | Promise<void>;
```

### EventBus interface

```typescript
interface EventBus<T extends EventMap> extends Disposable {
    // Subscribe — returns unsubscribe function
    on<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): Unsubscribe;
    off<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): void;
    once<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): Unsubscribe;
    onAny(handler: WildcardHandler<T>): Unsubscribe;

    // Emit — returns Promise that resolves when all handlers complete
    emit<K extends keyof T & string>(event: K, payload: T[K]): Promise<void>;

    // Introspection
    handlerCount<K extends keyof T & string>(event: K): number;
    registeredEvents(): (keyof T & string)[];
    hasHandlers<K extends keyof T & string>(event: K): boolean;

    // Idle detection
    waitForIdle(): Promise<void>;
    readonly pendingCount: number;
    readonly isIdle: boolean;

    // Lifecycle
    [Symbol.dispose](): void;
}
```

### createEventBus implementation spec

```typescript
function createEventBus<T extends EventMap>(options?: {
    onError?: (error: unknown, event: string) => void;
}): EventBus<T> {
    const handlers = new Map<string, Set<EventHandler<any>>>();
    const wildcardHandlers = new Set<WildcardHandler<T>>();
    let pendingCount = 0;
    let idleResolvers: Array<() => void> = [];

    function checkIdle() {
        if (pendingCount === 0 && idleResolvers.length > 0) {
            const resolvers = idleResolvers;
            idleResolvers = [];
            resolvers.forEach((r) => r());
        }
    }

    return {
        on(event, handler) {
            if (!handlers.has(event)) handlers.set(event, new Set());
            handlers.get(event)!.add(handler);
            return () => {
                handlers.get(event)?.delete(handler);
            };
        },

        off(event, handler) {
            handlers.get(event)?.delete(handler);
        },

        once(event, handler) {
            const wrapped: EventHandler<any> = (payload) => {
                this.off(event, wrapped);
                return handler(payload);
            };
            return this.on(event, wrapped);
        },

        onAny(handler) {
            wildcardHandlers.add(handler);
            return () => {
                wildcardHandlers.delete(handler);
            };
        },

        async emit(event, payload) {
            const fns = [...(handlers.get(event) ?? [])];
            const wildcards = [...wildcardHandlers];
            if (fns.length === 0 && wildcards.length === 0) return;

            pendingCount++;
            try {
                await Promise.all([...fns.map((fn) => fn(payload)), ...wildcards.map((fn) => fn(event, payload))]);
            } catch (err) {
                options?.onError?.(err, event);
            } finally {
                pendingCount--;
                checkIdle();
            }
        },

        handlerCount(event) {
            return handlers.get(event)?.size ?? 0;
        },
        registeredEvents() {
            return [...handlers.keys()] as (keyof T & string)[];
        },
        hasHandlers(event) {
            return (handlers.get(event)?.size ?? 0) > 0;
        },

        waitForIdle() {
            if (pendingCount === 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
                idleResolvers.push(resolve);
            });
        },
        get pendingCount() {
            return pendingCount;
        },
        get isIdle() {
            return pendingCount === 0;
        },

        [Symbol.dispose]() {
            handlers.clear();
            wildcardHandlers.clear();
            idleResolvers = [];
        },
    };
}
```

**Idle detection** tracks in-flight async handlers via a `pendingCount` integer. `waitForIdle()` returns a promise that resolves when `pendingCount` hits zero. This is essential for testing — emit events, then `await bus.waitForIdle()` before asserting side effects.

**Wildcard handlers** receive both the event type string and the payload, enabling cross-cutting concerns like logging and telemetry without subscribing to individual events.

### DomainEvent type

Domain events use a **discriminated union approach** (the `type` field is the discriminant) with metadata carried as a separate field. No class hierarchy — everything is a plain readonly object:

```typescript
// internal/id.ts
declare const __eventIdBrand: unique symbol;
declare const __correlationIdBrand: unique symbol;
declare const __causationIdBrand: unique symbol;

type EventId = string & { readonly [__eventIdBrand]: true };
type CorrelationId = string & { readonly [__correlationIdBrand]: true };
type CausationId = string & { readonly [__causationIdBrand]: true };

function createEventId(): EventId {
    return `evt_${crypto.randomUUID()}` as EventId;
}
function createCorrelationId(): CorrelationId {
    return `cor_${crypto.randomUUID()}` as CorrelationId;
}
```

```typescript
// event-bus/domain-event.ts
interface EventMetadata {
    readonly eventId: EventId;
    readonly timestamp: number;
    readonly correlationId?: CorrelationId;
    readonly causationId?: CausationId;
}

type DomainEvent<
    TType extends string = string,
    TData extends Record<string, unknown> = Record<string, unknown>,
> = Readonly<{
    type: TType;
    data: TData;
    metadata: EventMetadata;
}>;

function createDomainEvent<T extends string, D extends Record<string, unknown>>(
    type: T,
    data: D,
    meta?: Partial<EventMetadata>
): DomainEvent<T, D> {
    return {
        type,
        data,
        metadata: {
            eventId: meta?.eventId ?? createEventId(),
            timestamp: meta?.timestamp ?? Date.now(),
            correlationId: meta?.correlationId,
            causationId: meta?.causationId,
        },
    };
}
```

**Branded IDs** (`EventId`, `CorrelationId`, `CausationId`) are structurally incompatible at the type level. You cannot accidentally pass a `CorrelationId` where an `EventId` is expected. Metadata uses `number` timestamps (milliseconds since epoch) for serializability, not `Date` objects.

### EventLog

An append-only bounded buffer that records emitted events for debugging, testing, and replay:

```typescript
interface EventLogEntry<T extends EventMap> {
    readonly event: keyof T & string;
    readonly payload: T[keyof T];
    readonly metadata: EventMetadata;
    readonly handlerCount: number;
    readonly timestamp: number;
}

interface EventLog<T extends EventMap> {
    readonly entries: ReadonlyArray<EventLogEntry<T>>;
    readonly maxSize: number;
    append(entry: EventLogEntry<T>): void;
    query(predicate: (entry: EventLogEntry<T>) => boolean): EventLogEntry<T>[];
    clear(): void;
}

function createEventLog<T extends EventMap>(maxSize: number = 1000): EventLog<T> {
    let entries: EventLogEntry<T>[] = [];
    return {
        get entries() {
            return entries;
        },
        get maxSize() {
            return maxSize;
        },
        append(entry) {
            entries.push(entry);
            if (entries.length > maxSize) {
                entries = entries.slice(-maxSize);
            }
        },
        query(predicate) {
            return entries.filter(predicate);
        },
        clear() {
            entries = [];
        },
    };
}
```

The EventLog integrates with EventBus via the `onAny` wildcard handler — register a wildcard that appends to the log on every emission. The **ring buffer behavior** (`slice(-maxSize)`) prevents unbounded memory growth. The `handlerCount` field records how many handlers were registered for that event at emission time, useful for diagnosing missed events in testing.

---

## Error handling with AppError and Result

### AppError discriminated union

Errors use a `_tag` string literal discriminant — the same convention as Effect-TS — enabling exhaustive `switch` matching and `Extract<>` type narrowing. No abstract classes, no inheritance:

```typescript
type AppError =
    | { readonly _tag: 'NotFound'; readonly resource: string; readonly id: string }
    | { readonly _tag: 'Validation'; readonly field: string; readonly message: string }
    | { readonly _tag: 'Unauthorized'; readonly reason: string }
    | { readonly _tag: 'Conflict'; readonly resource: string; readonly id: string }
    | { readonly _tag: 'NetworkError'; readonly status: number; readonly body: string }
    | { readonly _tag: 'Unknown'; readonly cause: unknown; readonly message: string };

// Factory functions — concise constructors for each variant
const AppErrors = {
    notFound: (resource: string, id: string): AppError => ({ _tag: 'NotFound', resource, id }),
    validation: (field: string, message: string): AppError => ({ _tag: 'Validation', field, message }),
    unauthorized: (reason: string): AppError => ({ _tag: 'Unauthorized', reason }),
    conflict: (resource: string, id: string): AppError => ({ _tag: 'Conflict', resource, id }),
    network: (status: number, body: string): AppError => ({ _tag: 'NetworkError', status, body }),
    unknown: (cause: unknown): AppError => ({ _tag: 'Unknown', cause, message: String(cause) }),
} as const;

// Type guard
function isAppError(value: unknown): value is AppError {
    return typeof value === 'object' && value !== null && '_tag' in value && typeof (value as any)._tag === 'string';
}

// Narrow to specific variant
type ErrorByTag<T extends AppError['_tag']> = Extract<AppError, { _tag: T }>;
```

**Composable error subsets.** Domain layers can define their own error unions (e.g., `type RepoError = Extract<AppError, { _tag: 'NotFound' | 'Conflict' }>`) and widen them when crossing boundaries. The `_tag` discriminant enables `catchTag`-style selective error handling.

### Result type

A minimal `Result<T, E>` discriminated union for representing operations that can fail, without throwing exceptions. Inspired by neverthrow but zero-dependency:

```typescript
type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

// Constructors
const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Combinators
function map<T, U, E>(result: Result<T, E>, fn: (v: T) => U): Result<U, E> {
    return result.ok ? Ok(fn(result.value)) : result;
}

function flatMap<T, U, E, F>(result: Result<T, E>, fn: (v: T) => Result<U, F>): Result<U, E | F> {
    return result.ok ? fn(result.value) : result;
}

function mapErr<T, E, F>(result: Result<T, E>, fn: (e: E) => F): Result<T, F> {
    return result.ok ? result : Err(fn(result.error));
}

function match<T, E, R>(result: Result<T, E>, onOk: (value: T) => R, onErr: (error: E) => R): R {
    return result.ok ? onOk(result.value) : onErr(result.error);
}

function tryCatch<T, E>(fn: () => T, onError: (e: unknown) => E): Result<T, E> {
    try {
        return Ok(fn());
    } catch (e) {
        return Err(onError(e));
    }
}

function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
    return result.ok ? result.value : fallback;
}
```

**Design rationale.** This Result type uses standalone functions (`map`, `flatMap`) rather than instance methods. This enables tree-shaking, avoids prototype pollution, and aligns with the functional style of the rest of the library. The `ok: boolean` discriminant provides clean narrowing: `if (result.ok) { result.value }` works with no type assertion needed.

---

## Testing utilities

### createSpy — typed spy factory

A thin wrapper around `vi.fn()` that adds ergonomic assertion methods:

```typescript
import { vi, type Mock, expect } from 'vitest';

type AnyFn = (...args: any[]) => any;

interface Spy<T extends AnyFn> extends Mock<T> {
    assertCalledWith(...args: Parameters<T>): void;
    assertCalledTimes(n: number): void;
    assertNotCalled(): void;
    readonly calls: Parameters<T>[];
    readonly lastCall: Parameters<T> | undefined;
}

function createSpy<T extends AnyFn>(impl?: T): Spy<T> {
    const mock = impl ? vi.fn(impl) : vi.fn<T>();

    return Object.assign(mock, {
        assertCalledWith(...args: Parameters<T>) {
            expect(mock).toHaveBeenCalledWith(...args);
        },
        assertCalledTimes(n: number) {
            expect(mock).toHaveBeenCalledTimes(n);
        },
        assertNotCalled() {
            expect(mock).not.toHaveBeenCalled();
        },
        get calls() {
            return mock.mock.calls as Parameters<T>[];
        },
        get lastCall() {
            return mock.mock.lastCall as Parameters<T> | undefined;
        },
    }) as Spy<T>;
}
```

### createMock — Proxy-based interface mock

Creates a fully-typed mock object from any interface using a `Proxy` that lazily creates `vi.fn()` stubs for each accessed property:

```typescript
type MockOf<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K];
};

function createMock<T extends Record<string, any>>(overrides?: Partial<T>): MockOf<T> {
    const cache = new Map<string | symbol, any>();

    const proxy = new Proxy({} as MockOf<T>, {
        get(_, prop) {
            if (overrides && prop in overrides) return (overrides as any)[prop];
            if (!cache.has(prop)) cache.set(prop, vi.fn());
            return cache.get(prop);
        },
    });

    return proxy;
}
```

**How it works.** On any property access, the Proxy's `get` trap checks if an explicit override was provided. If not, it lazily creates and caches a `vi.fn()`. TypeScript's generic parameter constrains the type at compile time, so `mockService.getUser` is typed as `Mock<(id: string) => Promise<User>>` even though the Proxy is permissive at runtime.

**Usage:**

```typescript
interface UserService {
    getUser(id: string): Promise<User>;
    deleteUser(id: string): Promise<void>;
}

const mock = createMock<UserService>();
mock.getUser.mockResolvedValue({ id: '1', name: 'Test' });

const user = await mock.getUser('1');
expect(mock.getUser).toHaveBeenCalledWith('1');
```

### createTestContainer — DI test helper

Creates a child container from a production container, pre-populated with mock overrides:

```typescript
function createTestContainer(parent: Container, overrides: Array<{ token: Token<any>; value: any }>): Container {
    const child = parent.createChild();
    for (const { token, value } of overrides) {
        child.register(token, () => value, 'singleton');
    }
    return child;
}

// Convenience: override with mock
function withMock<T extends Record<string, any>>(
    token: Token<T>,
    partial?: Partial<T>
): { token: Token<T>; value: MockOf<T> } {
    return { token, value: createMock<T>(partial) };
}

// Usage in tests
const testContainer = createTestContainer(prodContainer, [
    withMock(LoggerToken),
    withMock(DbToken, { query: vi.fn().mockResolvedValue([]) }),
]);
```

This pattern ensures each test gets an isolated DI context. The `createChild()` mechanism means test overrides don't pollute the parent container, and unoverridden tokens resolve from the parent normally.

---

## How the modules compose together

The following shows how all modules integrate in a production application:

```typescript
// tokens.ts
const EventBusToken = createToken<EventBus<AppEvents>>('EventBus');
const UserStoreToken = createToken<Store<UserState>>('UserStore');
const StorageToken = createToken<StorageBackend>('Storage');

// bootstrap.ts
const container = createContainer();
container.register(StorageToken, () => createMemoryStorage());
container.register(EventBusToken, () => createEventBus<AppEvents>());
container.register(UserStoreToken, (resolve) => {
    const storage = resolve(StorageToken);
    return createPersistentStore<UserState>({ users: [] }, { key: 'users', storage });
});

// In business logic
const bus = container.resolve(EventBusToken);
const userStore = container.resolve(UserStoreToken);

bus.on('user:created', async (payload) => {
    userStore.update((state) => ({
        ...state,
        users: [...state.users, payload],
    }));
});

// In tests
const testBus = createEventBus<AppEvents>();
const testStore = createStore<UserState>({ users: [] });

testBus.on('user:created', async (payload) => {
    testStore.update((s) => ({ ...s, users: [...s.users, payload] }));
});

await testBus.emit('user:created', { id: '1', name: 'Alice', email: 'a@b.c' });
await testBus.waitForIdle();
expect(testStore.get().users).toHaveLength(1);
```

---

## Design principles and constraints for the implementor

The following rules must govern every implementation decision:

**No classes for public API.** Every public-facing construct is a factory function (`createX`) returning a plain object. Classes may appear only in internal implementation if genuinely useful, but the public type must be an interface or type alias, never a class.

**Structural typing over nominal.** All interfaces rely on TypeScript's structural type system. The only exceptions are `Token<T>` and branded IDs (`EventId`, `CorrelationId`), which use phantom brands explicitly for safety.

**Closure-based privacy.** Private state lives in the factory function's closure, not in TypeScript's `private` keyword. This provides true runtime encapsulation — no access via `(obj as any)._internal`.

**`Symbol.dispose` on all infrastructure.** Every object returned by a factory should implement `Disposable`. Include a polyfill shim at the entry point: `Symbol.dispose ??= Symbol('Symbol.dispose')`.

**Immutable public surfaces.** All returned types should use `Readonly<>`, `ReadonlyArray<>`, and `as const` where applicable. Store state is only mutable through `set`/`update`. EventLog entries are deeply readonly. DomainEvents are deeply frozen.

**Error-first, throw-last.** Business logic should use `Result<T, AppError>` for expected failures. `throw` is reserved for programming errors (missing registrations, circular dependencies) — things that indicate bugs, not runtime conditions.

**Zero external dependencies.** The entire library has no `npm` dependencies. It uses only TypeScript built-ins, `Map`, `Set`, `Proxy`, `Promise`, `Symbol`, and `crypto.randomUUID()`. Testing utilities depend on `vitest` as a peer dependency.

This specification provides complete type signatures, implementation patterns, and architectural decisions sufficient for an AI coding agent to produce a working implementation that is legally distinct from any existing library while delivering equivalent or superior functionality through clean, functional TypeScript patterns.
