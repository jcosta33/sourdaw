import { Result, isErr } from '../result';

export const assertErr = <T, E>(result: Result<T, E>): E => {
    if (!isErr(result)) {
        throw new Error(`Expected Err, got Ok: ${String(result.value)}`);
    }
    return result.error;
};
