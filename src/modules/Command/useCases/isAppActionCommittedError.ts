import { AppActionCommittedError } from '../errors/AppActionExecutionError';

export function isAppActionCommittedError(error: unknown): boolean {
    return error instanceof AppActionCommittedError;
}
