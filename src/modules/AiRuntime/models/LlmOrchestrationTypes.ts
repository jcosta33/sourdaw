export const AI_BACKENDS = ['native', 'webllm', 'cloud', 'none'] as const;
export const NATIVE_TOOL_CALLING_PROTOCOL_SCHEMA_VERSION = 1 as const;

export type AiBackend = (typeof AI_BACKENDS)[number];

export type RunnableAiBackend = Exclude<AiBackend, 'none'>;

export type AiBackendPreference = 'auto' | RunnableAiBackend;
