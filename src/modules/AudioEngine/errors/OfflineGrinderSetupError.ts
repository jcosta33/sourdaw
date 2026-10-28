import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type OfflineGrinderSetupError = AppError<'Export', { failureKind: 'offline-grinder-setup' }>;

export function createOfflineGrinderSetupError(cause: unknown): OfflineGrinderSetupError {
    return createAppError(
        'Export',
        'Grinder could not prepare its saved settings for rendering.',
        {
            failureKind: 'offline-grinder-setup',
        },
        cause
    );
}

export function isOfflineGrinderSetupError(error: unknown): error is OfflineGrinderSetupError {
    return (
        error instanceof Error &&
        '_tag' in error &&
        error._tag === 'Export' &&
        'failureKind' in error &&
        error.failureKind === 'offline-grinder-setup'
    );
}
