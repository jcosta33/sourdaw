import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { type HostedLlmConfiguration, type HostedLlmProvider } from '../../models/HostedLlmProvider';
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

    const isLoopback =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
        throw createAiRuntimeError('Provider base URL must use HTTPS or loopback HTTP');
    }

    return parsed.toString().replace(/\/$/u, '');
}

export async function configureCloudProvider(configuration: HostedLlmConfiguration): Promise<void> {
    const model = configuration.model.trim();
    if (!model) {
        throw createAiRuntimeError('Model cannot be empty');
    }

    await setCloudProviderConfig({
        provider: configuration.provider,
        model,
        baseUrl: normalizeBaseUrl(configuration.provider, configuration.baseUrl),
    });

    if (llmStatusStore.value?.state === 'ready' && llmStatusStore.value.backend === 'cloud') {
        llmStatusStore.set({ state: 'idle' });
    }
}
