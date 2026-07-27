export type AiBackend = 'native' | 'webllm' | 'cloud' | 'none';

export type RunnableAiBackend = Exclude<AiBackend, 'none'>;

export type AiBackendPreference = 'auto' | RunnableAiBackend;
