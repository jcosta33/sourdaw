import { AppActionCommittedError } from '../errors/AppActionExecutionError';

export function isAppActionCommittedError(error: unknown): error is AppActionCommittedError {
    return error instanceof AppActionCommittedError;
}
