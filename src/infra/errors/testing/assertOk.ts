import { Result, isOk } from '../result';

export const assertOk = <T, E>(result: Result<T, E>): T => {
    if (!isOk(result)) {
        throw new Error(`Expected Ok, got Err: ${String(result.error)}`);
    }
    return result.value;
};
