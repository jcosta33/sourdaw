import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import {
    HOSTED_REASONING_EFFORTS,
    type HostedLlmConfiguration,
    type HostedLlmProvider,
} from '../../models/HostedLlmProvider';
import { setCloudProviderConfig } from '../../repositories/cloudLlm/setCloudProviderConfig';
import { llmStatusStore } from '../../stores/llmStatusStore';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

function normalizeBaseUrl(provider: HostedLlmProvider, baseUrl: string | undefined): string | undefined {
    if (provider === 'anthropic') {
        return undefined;
    }

    const candidate = provider === 'openai' ? OPENAI_BASE_URL : baseUrl?.trim();
    if (!candidate) {
        throw createAiRuntimeError('A base URL is required for an OpenAI-compatible provider');
    }

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        throw createAiRuntimeError('Provider base URL is invalid');
    }

    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw createAiRuntimeError('Provider base URL cannot include credentials, a query, or a fragment');
    }

    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
        throw createAiRuntimeError('Provider base URL must use HTTPS or loopback HTTP');
    }

    return parsed.toString().replace(/\/$/u, '');
}

function assertValidReasoningEffort(configuration: HostedLlmConfiguration): void {
    if (configuration.reasoningEffort === undefined) {
        return;
    }
    if (configuration.provider !== 'openai') {
        throw createAiRuntimeError('Reasoning effort can only be configured for the OpenAI provider');
    }
    if (!HOSTED_REASONING_EFFORTS.includes(configuration.reasoningEffort)) {
        throw createAiRuntimeError('Reasoning effort is invalid');
    }
}

export async function configureCloudProvider(configuration: HostedLlmConfiguration): Promise<void> {
    const model = configuration.model.trim();
    if (!model) {
        throw createAiRuntimeError('Model cannot be empty');
    }
    const apiKey = configuration.apiKey;
    const requiresApiKey = configuration.provider !== 'openai-compatible' || configuration.authentication === 'api-key';
    if (requiresApiKey && !apiKey.trim()) {
        throw createAiRuntimeError(
            `${configuration.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key is required`
        );
    }

    if (configuration.authentication === 'none' && apiKey !== '') {
        throw createAiRuntimeError('Remove the API key before connecting without authentication');
    }

    assertValidReasoningEffort(configuration);

    const normalizedBaseUrl = normalizeBaseUrl(configuration.provider, configuration.baseUrl);
    if (
        configuration.provider === 'openai-compatible' &&
        configuration.authentication === 'none' &&
        !normalizedBaseUrl?.startsWith('http:')
    ) {
        throw createAiRuntimeError('Unauthenticated OpenAI-compatible providers require loopback HTTP');
    }
    if (
        configuration.provider === 'openai-compatible' &&
        configuration.authentication === 'api-key' &&
        normalizedBaseUrl?.startsWith('http:')
    ) {
        throw createAiRuntimeError('Authenticated OpenAI-compatible providers require HTTPS');
    }

    await setCloudProviderConfig({
        provider: configuration.provider,
        model,
        baseUrl: normalizedBaseUrl,
        authentication: configuration.authentication,
        apiKey,
        strictToolSchemas: configuration.strictToolSchemas,
        reasoningEffort: configuration.reasoningEffort,
    });

    if (llmStatusStore.value?.state === 'ready' && llmStatusStore.value.backend === 'cloud') {
        llmStatusStore.set({ state: 'idle' });
    }
}
