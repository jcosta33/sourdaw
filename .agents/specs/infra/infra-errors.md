# Errors and Result Infrastructure

> **Changelog (review revision):**
>
> - Flattened `AppError` shape: removed `details` nesting, data fields live directly on the error object (`error.trackId` instead of `error.details.trackId`)
> - Added `unwrapOr` to Result combinators (common operation missing from original spec)
> - Dropped `assertErrTag` from v1 testing helpers (`assertErr` gives you the typed error, check `._tag` directly)
> - Kept `fromNullable` (useful at repository boundaries for nullable API returns)
> - Resolved open question: `details` is removed entirely (flattened), so the default question is moot
> - Resolved open question: `toErrorMessage()` deferred to v2

## Context

The architecture defines `errors/` as part of a module's public contract. Errors should be meaningful at the boundary where they surface, and internal helper errors should stay internal.

This feature exists to replace the old company error helpers with shared functional primitives that let modules define stable public errors cleanly and compose expected failures without relying on exception-heavy workflows.

---

## Goal

Implement shared error primitives that make module-level public errors easy to define and use, and implement a lightweight `Result<T, E>` toolkit for expected failures.

---

## User-visible behavior

From the caller's point of view:

- a module can define its own public error type/factory using shared infra
- errors are plain typed objects, not class instances
- error data fields are accessed directly (`error.trackId`), not through a nested `details` object
- code can use `Result<T, E>` for expected failures
- tests can assert `Ok` / `Err` outcomes cleanly without hand-rolling guards
- use cases are not forced into a single style; the infra supports both returning `Result` and throwing meaningful boundary errors where appropriate

---

## Scope

## **In scope:**

- shared `AppError` shape (flattened — no `details` nesting)
- `createAppError()` helper
- `isAppError()` guard
- `Result<T, E>`
- `ok`, `err`
- `isOk`, `isErr`
- `map`, `mapError`, `flatMap`, `match`
- `fromNullable`, `tryCatch`, `unwrapOr`
- testing helpers: `assertOk`, `assertErr`

## **Non-goals (explicitly out of scope):**

- `assertErrTag()` testing helper (`assertErr` + direct `._tag` check is sufficient)
- `toErrorMessage()` helper (deferred to v2)
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

2. **Flattened data access** — error data fields live directly on the error object alongside `_tag`, `message`, and optional `cause`. No intermediate `details` nesting.

3. **Module ownership preserved** — module public errors remain defined inside the module's `errors/` folder. Shared infra only provides primitives.

4. **Stable discriminant** — every error must have a `_tag` string literal discriminant.

5. **Structured payload** — errors carry structured data fields and an optional `cause`.

6. **Shared factory helper** — implement:
   `createAppError(tag, message, data?)`

7. **Type guard** — implement:
   `isAppError(value): value is AppError`

8. **Result type** — implement:
   `Ok<T> | Err<E>`

9. **Composable helpers** — implement:
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
    - `unwrapOr`

10. **No throw-heavy infra** — expected failures should prefer `Result`; throws are reserved for programmer errors or explicitly chosen boundary behavior.

11. **Testing helpers** — provide:

- `assertOk(result)` — returns the value or throws a test failure
- `assertErr(result)` — returns the error or throws a test failure

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

Flattened — data fields live directly on the error object:

```ts
export type AppError<
    TTag extends string = string,
    TData extends Record<string, unknown> = Record<string, unknown>,
> = Readonly<
    {
        _tag: TTag;
        message: string;
        cause?: unknown;
    } & TData
>;
```

Access is direct: `error.trackId`, not `error.details.trackId`.

**Considered and rejected:**

- nested `details` field
    - rejected because it adds one level of unnecessary nesting at every access site; the key collision risk (`_tag`, `message`, `cause`) is negligible in practice because nobody names a domain field `_tag`
- error classes
    - rejected because they add ceremony and fight the shared functional direction
- string-only errors
    - rejected because module boundaries need structured details

### Decision: Module-local error definitions

**Chosen:**

Modules define their own concrete public errors with shared infra:

```ts
// Track/errors/createTrackNotFoundError.ts
import { type AppError, createAppError } from '#/helpers/Errors/createAppError';

export type TrackNotFoundError = AppError<'TrackNotFoundError', { trackId: string }>;

export const createTrackNotFoundError = (trackId: string): TrackNotFoundError => {
    return createAppError('TrackNotFoundError', 'Track not found', { trackId });
};
```

Usage at the consuming site:

```ts
if (!track) {
    throw createTrackNotFoundError(input.trackId);
}

// Or with Result:
if (!track) {
    return err(createTrackNotFoundError(input.trackId));
}
```

Accessing the error data:

```ts
// Direct access — no .details nesting
catch (e) {
    if (isAppError(e) && e._tag === 'TrackNotFoundError') {
        console.log(e.trackId); // direct
    }
}
```

**Considered and rejected:**

- one central `AppErrors` object for the whole app with hardcoded variants (`NotFound`, `Validation`, etc.)
    - rejected because it breaks DDD module ownership

### Decision: Result toolkit

**Chosen:**

Provide a minimal algebraic result type with standalone combinators:

```ts
type Ok<T> = Readonly<{ ok: true; value: T }>;
type Err<E> = Readonly<{ ok: false; error: E }>;
type Result<T, E> = Ok<T> | Err<E>;
```

Combinators are standalone functions (`map`, `flatMap`, etc.) for tree-shaking and to avoid prototype pollution.

**Considered and rejected:**

- external dependency like neverthrow
    - rejected because infra should stay dependency-free
- forcing every use case to return `Result`
    - rejected because some module boundaries may still choose thrown errors
- method-based Result (`.map()`, `.flatMap()`)
    - rejected because standalone functions enable tree-shaking and align with the functional style

### Decision: Testing helpers

**Chosen:**

Two helpers: `assertOk(result)` and `assertErr(result)`.

**Considered and rejected:**

- `assertErrTag(result, tag)` helper
    - rejected because `assertErr` already returns the typed error; checking `._tag` is a one-liner that doesn't need its own function

---

## Acceptance criteria

- [ ] `createAppError()` returns a plain readonly object with `_tag`, `message`, data fields, and optional `cause`
- [ ] Error data fields are accessed directly on the object (no `.details` nesting)
- [ ] `isAppError()` correctly narrows shared errors
- [ ] `Result<T, E>` is implemented with `ok: true | false` discrimination
- [ ] All helper combinators work with correct inference
- [ ] `tryCatch()` converts thrown exceptions into `Err`
- [ ] `unwrapOr()` returns the value for `Ok` or the fallback for `Err`
- [ ] `fromNullable()` converts nullable values into `Result`
- [ ] `assertOk` and `assertErr` test helpers work without type-casting noise
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

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T => {
    if (result.ok) {
        return result.value;
    }

    return fallback;
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

---

## Test plan

- [ ] Unit: `createAppError()` creates the expected flattened shape
- [ ] Unit: error data fields are accessible directly (no `.details`)
- [ ] Unit: `isAppError()` accepts valid shared errors and rejects invalid values
- [ ] Unit: `ok()` and `err()` create the correct discriminated shapes
- [ ] Unit: `map()` transforms `Ok` only
- [ ] Unit: `mapError()` transforms `Err` only
- [ ] Unit: `flatMap()` chains correctly
- [ ] Unit: `match()` dispatches correctly
- [ ] Unit: `fromNullable()` produces `Err` for nullish values
- [ ] Unit: `tryCatch()` captures thrown errors
- [ ] Unit: `unwrapOr()` returns value for `Ok` and fallback for `Err`
- [ ] Unit: `assertOk()` / `assertErr()` helpers behave correctly
- [ ] Manual: define a module-local public error using shared infra and consume it from a use case

---

## Open questions

None. All previously open questions have been resolved as design decisions.

---

## Tradeoffs and risks

The main tradeoff is duality: the infra supports both `Result` and meaningful thrown boundary errors. That is deliberate, because the current architecture already expects boundary errors in some places.

The flattened error shape trades a negligible key collision risk (`_tag`, `message`, `cause` are reserved) for cleaner access at every consuming site. If a module somehow needs a data field called `message`, it can use a different name.

The main risk is overusing shared infra until module-local errors become vague or generic. The spec explicitly avoids that by keeping concrete public error definitions inside modules.
