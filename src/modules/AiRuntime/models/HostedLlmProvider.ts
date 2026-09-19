export const HOSTED_LLM_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export const HOSTED_LLM_AUTHENTICATION = ['api-key', 'none'] as const;
export const EXTERNAL_ADAPTER_SCHEMA_VERSION = 1 as const;
// Mirrors the OpenAI Responses API's `reasoning.effort` values
// (https://developers.openai.com/api/docs/guides/reasoning); support is model-dependent.
export const HOSTED_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type HostedLlmProvider = (typeof HOSTED_LLM_PROVIDERS)[number];
export type HostedLlmAuthentication = (typeof HOSTED_LLM_AUTHENTICATION)[number];
export type HostedReasoningEffort = (typeof HOSTED_REASONING_EFFORTS)[number];

export type HostedLlmConfiguration = {
    provider: HostedLlmProvider;
    model: string;
    baseUrl?: string;
    /** Nonsecret intent that prevents a reconnect from changing authentication mode. */
    authentication: HostedLlmAuthentication;
    /** Ephemeral password-input value; never write this to a store or preference. */
    apiKey: string;
    /**
     * Whether an `openai-compatible` endpoint accepts OpenAI's strict tool-calling
     * dialect. Ignored for `anthropic` and `openai`, which always send strict schemas.
     * Defaults to `false` when omitted, since dialect support cannot be probed.
     */
    strictToolSchemas?: boolean;
    /**
     * Overrides the reasoning effort the `openai` provider sends on every Responses
     * request. Ignored for `anthropic` and `openai-compatible`. Omitted means the
     * per-model default the Responses request builders already apply.
     */
    reasoningEffort?: HostedReasoningEffort;
};

export type HostedLlmProviderInfo = {
    provider: HostedLlmProvider;
    model: string;
    baseUrl: string | null;
    authentication: HostedLlmAuthentication;
};
