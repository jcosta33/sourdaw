import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type FaustDeviceExportError = AppError<'Export', { failureKind: 'faust-device' }>;

export function createFaustDeviceExportError(message: string, cause: unknown): FaustDeviceExportError {
    return createAppError('Export', message, { failureKind: 'faust-device' }, cause);
}

export function isFaustDeviceExportError(error: unknown): error is FaustDeviceExportError {
    return (
        error instanceof Error &&
        '_tag' in error &&
        error._tag === 'Export' &&
        'failureKind' in error &&
        error.failureKind === 'faust-device'
    );
}
