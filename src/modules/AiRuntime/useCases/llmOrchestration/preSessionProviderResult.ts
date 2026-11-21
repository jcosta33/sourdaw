import { isAiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { snapshotHostedAiHttpStatus } from '../../errors/HostedAiHttpStatusError';
import { isModelProviderFailureError } from '../../errors/ModelProviderFailureError';
import {
    type ModelProviderFailure,
    type ModelProviderName,
    type ModelProviderRequest,
    type ModelProviderResult,
} from '../../models/ModelProviderProtocol';

import { hostedAiHttpFailure } from './hostedAiHttpFailure';

export type AdmittedProviderAttempt = {
    provider: ModelProviderName;
    model: string | null;
    request: ModelProviderRequest;
    disclosurePublished: boolean;
};

/** The provider result of an admitted attempt that failed before its provider session started. */
export function preSessionProviderResult(input: {
    attempt: AdmittedProviderAttempt;
    error: unknown;
    cancelled: boolean;
}): ModelProviderResult {
    const normalizedFailure = isModelProviderFailureError(input.error) ? input.error : null;
    const cancelled = input.cancelled || isAiRuntimeConfigurationChangedError(input.error);
    let failure: Pick<ModelProviderFailure, 'code' | 'retryable' | 'safeMessage'>;
    if (cancelled) {
        failure = {
            code: 'cancelled',
            retryable: true,
            safeMessage: 'The model provider request was cancelled.',
        };
    } else if (normalizedFailure !== null) {
        failure = {
            code: normalizedFailure.code,
            retryable: normalizedFailure.retryable,
            safeMessage: normalizedFailure.message,
        };
    } else {
        const httpStatus = snapshotHostedAiHttpStatus(input.error);
        if (httpStatus !== null) {
            failure = hostedAiHttpFailure(httpStatus);
        } else {
            failure = {
                code: 'provider-attempt-failed',
                retryable: true,
                safeMessage: 'The model provider request failed before its session started.',
            };
        }
    }
    const result: ModelProviderResult = {
        schemaVersion: input.attempt.request.schemaVersion,
        provider: input.attempt.provider,
        model: input.attempt.model,
        correlationId: input.attempt.request.correlationId,
        status: cancelled ? 'cancelled' : 'failed',
        output: { text: '', reasoning: '', toolCalls: [], structuredOutput: null },
        usage: {
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'unavailable',
        },
        finishReason: cancelled ? 'cancelled' : 'error',
        partialOutputDisposition: 'none',
        failure: {
            ...failure,
            correlationId: input.attempt.request.correlationId,
            partialOutputDisposition: 'none',
        },
        ignoredProviderEvents: [],
    };
    const dataCategories = input.attempt.request.dataCategories;
    if (!input.attempt.disclosurePublished || dataCategories === undefined) {
        return result;
    }
    return {
        ...result,
        remoteDisclosure: {
            requestId: input.attempt.request.requestId,
            categories: [...dataCategories],
            retention: {
                applicationState: 'unknown',
                abuseMonitoring: 'unknown',
                promptCache: 'unknown',
                safetyLegalException: 'unknown',
                unknown: 'unknown',
            },
        },
    };
}
