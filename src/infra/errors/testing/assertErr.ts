import { type Result, isErr } from '../result';

export const assertErr = <TValue, TError>(result: Result<TValue, TError>): TError => {
    if (!isErr(result)) {
        throw new Error(`Expected Err, got Ok: ${String(result.value)}`);
    }
    return result.error;
};
