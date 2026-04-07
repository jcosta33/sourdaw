import type { AppError } from './createAppError';

export const isAppError = (value: unknown): value is AppError => {
    return (
        typeof value === 'object' &&
        value !== null &&
        '_tag' in value &&
        typeof (value as Record<string, unknown>)._tag === 'string' &&
        'message' in value &&
        typeof (value as Record<string, unknown>).message === 'string'
    );
};
