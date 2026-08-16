export const AI_BACKENDS = ['webllm', 'cloud', 'none'] as const;

export type AiBackend = (typeof AI_BACKENDS)[number];

export type RunnableAiBackend = Exclude<AiBackend, 'none'>;

export type AiBackendPreference = 'auto' | RunnableAiBackend;
