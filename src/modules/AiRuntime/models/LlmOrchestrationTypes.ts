export const AI_BACKENDS = ['native', 'webllm', 'cloud', 'none'] as const;
export const PROVIDER_PROTOCOL_SCHEMA_VERSION = 1 as const;
export const PROVIDER_PROTOCOL_OPERATIONS = ['structured-tool-planning', 'text-streaming'] as const;

export type AiBackend = (typeof AI_BACKENDS)[number];

export type RunnableAiBackend = Exclude<AiBackend, 'none'>;

export type AiBackendPreference = 'auto' | RunnableAiBackend;
