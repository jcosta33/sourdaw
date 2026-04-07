import { type Result, isOk } from '../result';

export const assertOk = <TValue, TError>(result: Result<TValue, TError>): TValue => {
    if (!isOk(result)) {
        throw new Error(`Expected Ok, got Err: ${String(result.error)}`);
    }
    return result.value;
};
