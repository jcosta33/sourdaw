import { isErr, type Result } from '../result';

export const assertErr = <T, E>(result: Result<T, E>): E => {
    if (!isErr(result)) {
        throw new Error(`Expected Err, but got Ok: ${JSON.stringify(result.value)}`);
    }
    return result.error;
};