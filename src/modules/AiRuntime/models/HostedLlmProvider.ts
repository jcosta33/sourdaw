export const HOSTED_LLM_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export const EXTERNAL_ADAPTER_SCHEMA_VERSION = 1 as const;

export type HostedLlmProvider = (typeof HOSTED_LLM_PROVIDERS)[number];

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
