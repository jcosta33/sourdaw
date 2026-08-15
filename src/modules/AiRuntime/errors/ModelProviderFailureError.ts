import { createAppError, type AppError } from '#/infra/errors/createAppError';

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
