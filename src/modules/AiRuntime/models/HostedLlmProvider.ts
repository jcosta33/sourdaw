export const HOSTED_LLM_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export const HOSTED_LLM_AUTHENTICATION = ['api-key', 'none'] as const;
export const EXTERNAL_ADAPTER_SCHEMA_VERSION = 1 as const;

export type HostedLlmProvider = (typeof HOSTED_LLM_PROVIDERS)[number];
export type HostedLlmAuthentication = (typeof HOSTED_LLM_AUTHENTICATION)[number];

export type HostedLlmConfiguration = {
    provider: HostedLlmProvider;
    model: string;
    baseUrl?: string;
    /** Nonsecret intent that prevents a reconnect from changing authentication mode. */
    authentication: HostedLlmAuthentication;
    /** Ephemeral password-input value; never write this to a store or preference. */
    apiKey: string;
};

export type HostedLlmProviderInfo = {
    provider: HostedLlmProvider;
    model: string;
    baseUrl: string | null;
    authentication: HostedLlmAuthentication;
};
