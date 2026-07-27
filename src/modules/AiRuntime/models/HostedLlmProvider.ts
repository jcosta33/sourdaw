export type HostedLlmProvider = 'anthropic' | 'openai' | 'openai-compatible';

export type HostedLlmConfiguration = {
    provider: HostedLlmProvider;
    apiKey: string;
    model: string;
    baseUrl?: string;
};

export type HostedLlmProviderInfo = {
    provider: HostedLlmProvider;
    model: string;
    baseUrl: string | null;
};
