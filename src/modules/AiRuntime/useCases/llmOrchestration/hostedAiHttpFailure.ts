import { type ModelProviderFailure } from '../../models/ModelProviderProtocol';

function hostedAiHttpSafeMessage(status: number): string {
    if (status === 401 || status === 403) {
        return `Hosted AI request failed (HTTP ${String(status)}) — check your API key.`;
    }
    if (status === 404) {
        return 'Hosted AI request failed (HTTP 404) — the model or endpoint was not found.';
    }
    if (status === 429) {
        return 'Hosted AI request failed (HTTP 429) — rate limited; retry later.';
    }
    return `Hosted AI request failed (HTTP ${String(status)}).`;
}

/** The provider failure a hosted HTTP status reports, with its user sentence. */
export function hostedAiHttpFailure(status: number): Pick<ModelProviderFailure, 'code' | 'retryable' | 'safeMessage'> {
    return {
        code: `hosted-http-${String(status)}`,
        retryable: status === 429 || status === 503,
        safeMessage: hostedAiHttpSafeMessage(status),
    };
}
