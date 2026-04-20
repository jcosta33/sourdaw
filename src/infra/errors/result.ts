export type Ok<TValue> = Readonly<{ ok: true; value: TValue }>;
export type Err<TError> = Readonly<{ ok: false; error: TError }>;
export type Result<TValue, TError> = Ok<TValue> | Err<TError>;

export const ok = <TValue>(value: TValue): Ok<TValue> => ({ ok: true, value });

export const err = <TError>(error: TError): Err<TError> => ({ ok: false, error });

export const isOk = <TValue, TError>(result: Result<TValue, TError>): result is Ok<TValue> => {
    return result.ok === true;
};

export const isErr = <TValue, TError>(result: Result<TValue, TError>): result is Err<TError> => {
    return result.ok === false;
};

export const map = <TValue, TError, TMapped>(
    result: Result<TValue, TError>,
    fn: (value: TValue) => TMapped
): Result<TMapped, TError> => {
    if (result.ok) {
        return ok(fn(result.value));
    }
    return result;
};

export const mapError = <TValue, TError, TMappedError>(
    result: Result<TValue, TError>,
    fn: (error: TError) => TMappedError
): Result<TValue, TMappedError> => {
    if (!result.ok) {
        return err(fn(result.error));
    }
    return result;
};

export const flatMap = <TValue, TError, TMapped>(
    result: Result<TValue, TError>,
    fn: (value: TValue) => Result<TMapped, TError>
): Result<TMapped, TError> => {
    if (result.ok) {
        return fn(result.value);
    }
    return result;
};

export const match = <TValue, TError, TReturn>(
    result: Result<TValue, TError>,
    branches: {
        ok: (value: TValue) => TReturn;
        err: (error: TError) => TReturn;
    }
): TReturn => {
    if (result.ok) {
        return branches.ok(result.value);
    }
    return branches.err(result.error);
};

export const unwrapOr = <TValue, TError>(result: Result<TValue, TError>, fallback: TValue): TValue => {
    if (result.ok) {
        return result.value;
    }
    return fallback;
};

export const fromNullable = <TValue, TError>(
    value: TValue | null | undefined,
    errorFactory: () => TError
): Result<TValue, TError> => {
    if (value === null || value === undefined) {
        return err(errorFactory());
    }
    return ok(value as TValue);
};

export const tryCatch = <TValue, TError>(
    fn: () => TValue,
    errorFactory: (caught: unknown) => TError
): Result<TValue, TError> => {
    try {
        return ok(fn());
    } catch (error) {
        return err(errorFactory(error));
    }
};
