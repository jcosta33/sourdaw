export type Ok<T> = Readonly<{ ok: true; value: T }>;
export type Err<E> = Readonly<{ ok: false; error: E }>;
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => {
    return result.ok === true;
};

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => {
    return result.ok === false;
};

export const map = <T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => {
    if (result.ok) {
        return ok(fn(result.value));
    }
    return result;
};

export const mapError = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> => {
    if (!result.ok) {
        return err(fn(result.error));
    }
    return result;
};

export const flatMap = <T, E, U>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> => {
    if (result.ok) {
        return fn(result.value);
    }
    return result;
};

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

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T => {
    if (result.ok) {
        return result.value;
    }
    return fallback;
};

export const fromNullable = <T, E>(value: T | null | undefined, errorFactory: () => E): Result<T, E> => {
    if (value === null || value === undefined) {
        return err(errorFactory());
    }
    return ok(value as T);
};

export const tryCatch = <T, E>(fn: () => T, errorFactory: (e: unknown) => E): Result<T, E> => {
    try {
        return ok(fn());
    } catch (e) {
        return err(errorFactory(e));
    }
};
