import { type ModelProviderRequest } from './ModelProviderProtocol';

const COMPILED_PROVIDER_REQUEST_TOKEN_CEILING_METHOD = 'compiled-provider-request-utf8-byte-token-ceiling-v1' as const;

export type ProviderRequestTokenCeilingMethod = typeof COMPILED_PROVIDER_REQUEST_TOKEN_CEILING_METHOD;

export type ProviderAttemptCostEstimate = {
    method: ProviderRequestTokenCeilingMethod;
    inputTokenCeiling: number;
    outputTokenCeiling: number;
    totalTokenCeiling: number;
};

export function estimateCompiledProviderRequestTokenCeiling(
    request: ModelProviderRequest
): ProviderAttemptCostEstimate {
    // This bounds prompt tokens without assuming a provider tokenizer: each
    // non-empty token consumes at least one UTF-8 byte. The serialized request
    // contains every provider-visible message, schema, and advertised tool.
    const inputTokenCeiling = new TextEncoder().encode(JSON.stringify(request)).byteLength;
    const outputTokenCeiling = request.limits.maxOutputTokens;
    return {
        method: COMPILED_PROVIDER_REQUEST_TOKEN_CEILING_METHOD,
        inputTokenCeiling,
        outputTokenCeiling,
        totalTokenCeiling: inputTokenCeiling + outputTokenCeiling,
    };
}
