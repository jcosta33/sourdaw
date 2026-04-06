# Errors and Result Infrastructure

## Context

The architecture defines `errors/` as part of a module’s public contract. Errors should be meaningful at the boundary where they surface, and internal helper errors should stay internal.

The infra research proposes a functional `AppError` union plus `Result<T, E>` helpers. This is useful, but it must not turn into a global monolithic error registry that fights module ownership.

This feature exists to replace the old company error helpers with shared functional primitives that let modules define stable public errors cleanly and compose expected failures without relying on exception-heavy workflows.

---

## Goal

Implement shared error primitives that make module-level public errors easy to define and use, and implement a lightweight `Result<T, E>` toolkit for expected failures.

---

## User-visible behavior

From the caller’s point of view:

- a module can define its own public error type/factory using shared infra
- errors are plain typed objects, not class instances
- code can use `Result<T, E>` for expected failures
- tests can assert `Ok` / `Err` outcomes cleanly without hand-rolling guards
- use cases are not forced into a single style; the infra supports both returning `Result` and throwing meaningful boundary errors where appropriate

---

## Scope

## **In scope:**

- shared `AppError` shape
- `createAppError()` helper
- `isAppError()` guard
- `Result<T, E>`
- `ok`, `err`
- `isOk`, `isErr`
- `map`, `mapError`, `flatMap`, `match`
- `fromNullable`, `tryCatch`
- small testing helpers for asserting results

## **Non-goals (explicitly out of scope):**

- a single global app-wide error catalog
- stack-trace preserving error subclasses
- framework-specific error boundaries
- logging
- localization
- transport-specific error serialization policies
- replacing every thrown module error with `Result`

---

## Requirements

1. **Plain-object error shape** — shared error infrastructure must use plain readonly objects, not classes.

2. **Module ownership preserved** — module public errors remain defined inside the module’s `errors/` folder. Shared infra only provides primitives.

3. **Stable discriminant** — every error must have a stable discriminant such as `_tag`.

4. **Structured payload** — errors may carry structured data and an optional `cause`.

5. **Shared factory helper** — implement:
   `createAppError(tag, message, details?, cause?)`

6. **Type guard** — implement:
   `isAppError(value): value is AppError`

7. **Result type** — implement:
   `Ok<T> | Err<E>`

8. **Composable helpers** — implement:
    - `ok`
    - `err`
    - `isOk`
    - `isErr`
    - `map`
    - `mapError`
    - `flatMap`
    - `match`
    - `fromNullable`
    - `tryCatch`

9. **No throw-heavy infra** — expected failures should prefer `Result`; throws are reserved for programmer errors or explicitly chosen boundary behavior.

10. **Testing helpers** — provide tiny helpers such as:

- `assertOk(result)`
- `assertErr(result)`
- `assertErrTag(result, tag)`

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`)
- Plain objects and functions only
- No public classes
- No default exports
- No global singleton registry of all app errors
- No decorators
- Keep names explicit and boring
- Shared infra must stay generic; module-specific errors stay in modules

---

## Design decisions

### Decision: Shared error shape

**Chosen:**

```ts
export type AppError<
    TTag extends string = string,
    TDetails extends Record<string, unknown> = Record<string, unknown>,
> = Readonly<{
    _tag: TTag;
    message: string;
    details: TDetails;
    cause?: unknown;
}>;
```

**Considered and rejected:**

- error classes
    - rejected because they add ceremony and fight the shared functional direction
- string-only errors
    - rejected because module boundaries need structured details

### Decision: Module-local error definitions

**Chosen:**

Modules define their own concrete public errors with shared infra:

```ts
// Track/errors/createTrackNotFoundError.ts
import { createAppError, type AppError } from '#/helpers/Errors/createAppError';

export type TrackNotFoundError = AppError<
    'TrackNotFoundError',
    {
        trackId: string;
    }
>;

export const createTrackNotFoundError = (trackId: string): TrackNotFoundError => {
    return createAppError('TrackNotFoundError', 'Track not found', {
        trackId,
    });
};
```

**Considered and rejected:**

- one central `AppErrors` object for the whole app
    - rejected because it breaks DDD module ownership

### Decision: Result toolkit

**Chosen:**

Provide a minimal algebraic result type:

```ts
type Ok<T> = Readonly<{ ok: true; value: T }>;
type Err<E> = Readonly<{ ok: false; error: E }>;
type Result<T, E> = Ok<T> | Err<E>;
```

**Considered and rejected:**

- external dependency like neverthrow
    - rejected because infra should stay dependency-free
- forcing every use case to return `Result`
    - rejected because some module boundaries may still choose thrown errors

---

## Acceptance criteria

- [ ] `createAppError()` returns a plain readonly object with `_tag`, `message`, `details`, and optional `cause`
- [ ] `isAppError()` correctly narrows shared errors
- [ ] `Result<T, E>` is implemented with `ok: true | false` discrimination
- [ ] All helper combinators work with correct inference
- [ ] `tryCatch()` converts thrown exceptions into `Err`
- [ ] Test helpers make `Ok` / `Err` assertions concise
- [ ] Shared infra does not impose a global app-wide error registry
- [ ] `pnpm deps:validate` passes with zero violations

---

## Implementation notes

Suggested helper layout:

```text
src/helpers/Errors/
  createAppError.ts
  isAppError.ts
  result.ts
  testing/
    assertOk.ts
    assertErr.ts
    assertErrTag.ts
```

Recommended result helpers:

```ts
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => {
    return result.ok === true;
};

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => {
    return result.ok === false;
};
```

```ts
export const match = <T, E, TReturn>(
    result: Result<T, E>,
    branches: {
        ok: (value: T) => TReturn;
        err: (error: E) => TReturn;
    }
): TReturn => {
    if (result.ok) {
        return branches.ok(result.value);
    }

    return branches.err(result.error);
};
```

Recommended testing helpers:

- `assertOk(result)` returns the value or throws a test failure
- `assertErr(result)` returns the error or throws a test failure
- `assertErrTag(result, expectedTag)` asserts the error tag and returns the narrowed error

---

## Test plan

- [ ] Unit: `createAppError()` creates the expected shape
- [ ] Unit: `isAppError()` accepts valid shared errors and rejects invalid values
- [ ] Unit: `ok()` and `err()` create the correct discriminated shapes
- [ ] Unit: `map()` transforms `Ok` only
- [ ] Unit: `mapError()` transforms `Err` only
- [ ] Unit: `flatMap()` chains correctly
- [ ] Unit: `match()` dispatches correctly
- [ ] Unit: `fromNullable()` produces `Err` for nullish values
- [ ] Unit: `tryCatch()` captures thrown errors
- [ ] Unit: `assertOk()` / `assertErr()` helpers behave correctly
- [ ] Manual: define a module-local public error using shared infra and consume it from a use case

---

## Open questions

- [ ] **[MINOR]** Whether to include a shared `toErrorMessage()` helper in v1, or keep formatting local
- [ ] **[MINOR]** Whether `details` should default to `{}` or be optional

---

## Tradeoffs and risks

The main tradeoff is duality: the infra supports both `Result` and meaningful thrown boundary errors. That is deliberate, because the current architecture already expects boundary errors in some places.

The main risk is overusing shared infra until module-local errors become vague or generic. The spec explicitly avoids that by keeping concrete public error definitions inside modules.
