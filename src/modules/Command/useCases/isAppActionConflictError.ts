import { AppActionConflictError } from '../errors/AppActionExecutionError';

export function isAppActionConflictError(error: unknown): error is AppActionConflictError {
    return error instanceof AppActionConflictError;
}
