import { createAppError, type AppError } from '#/infra/errors/createAppError';
import { isAppError } from '#/infra/errors/isAppError';

import { type ModelProviderFailure } from '../models/ModelProviderProtocol';

type ModelProviderFailureData = Pick<
    ModelProviderFailure,
    'code' | 'correlationId' | 'retryable' | 'partialOutputDisposition'
>;

export type ModelProviderFailureError = AppError<'ModelProviderFailure', ModelProviderFailureData>;

export function createModelProviderFailureError(
    failure: ModelProviderFailure,
    cause?: unknown
): ModelProviderFailureError {
    return createAppError(
        'ModelProviderFailure',
        failure.safeMessage,
        {
            code: failure.code,
            correlationId: failure.correlationId,
            retryable: failure.retryable,
            partialOutputDisposition: failure.partialOutputDisposition,
        },
        cause
    );
}

export function isModelProviderFailureError(value: unknown): value is ModelProviderFailureError {
    return (
        isAppError(value) &&
        value._tag === 'ModelProviderFailure' &&
        typeof value.code === 'string' &&
        typeof value.correlationId === 'string' &&
        typeof value.retryable === 'boolean' &&
        (value.partialOutputDisposition === 'none' ||
            value.partialOutputDisposition === 'preserve' ||
            value.partialOutputDisposition === 'discard')
    );
}
