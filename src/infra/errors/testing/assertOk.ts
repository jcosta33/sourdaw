import { isOk, type Result } from '../result';

export const assertOk = <T, E>(result: Result<T, E>): T => {
    if (!isOk(result)) {
        throw new Error(`Expected Ok, but got Err: ${JSON.stringify(result.error)}`);
    }
    return result.value;
};