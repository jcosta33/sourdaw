import { isAppError } from '#/infra/errors/isAppError';

export function getFaustErrorMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
