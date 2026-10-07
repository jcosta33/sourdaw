/**
 * Model metadata types and constants for AI backends.
 */

export type ModelInfo = {
    id: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    parameterCount: string;
};

// -- WebLLM model options (browser) --

export const WEBLLM_MODELS: ModelInfo[] = [
    {
        id: 'Qwen3-1.7B-q4f16_1-MLC',
        displayName: 'Light',
        parameterCount: '1.7B',
        description: 'Fast responses, low resource usage. Best for simple edits.',
        downloadSize: '~0.99 GB',
        ramUsage: '~1.8 GB',
    },
    {
        id: 'Qwen3-4B-q4f16_1-MLC',
        displayName: 'Standard',
        parameterCount: '4B',
        description:
            'The local model that can plan project edits: its context window holds a planning request. Recommended.',
        downloadSize: '~2.28 GB',
        // The release manifest's VRAM figure, web-llm's published requirement at its recorded
        // 4,096-token window, plus the KV cache for every token up to the window below, rounded up
        // to the next half gigabyte.
        ramUsage: '~6.5 GB',
    },
    {
        id: 'Qwen3-8B-q4f16_1-MLC',
        displayName: 'Pro',
        parameterCount: '8B',
        description: 'Best quality. Needs a capable GPU with 8 GB+ VRAM.',
        downloadSize: '~4.63 GB',
        ramUsage: '~6.5 GB',
    },
];

/**
 * The context window, in tokens, each local model loads with. It lives here rather than in the
 * release manifest's engine block because that block is part of the digested artifact set: a
 * changed window there would change the digest, and admission purges a downloaded model whose
 * digest changed. The engine loads this value and the planning budget measures against it.
 */
export const WEBLLM_CONTEXT_WINDOW_TOKENS: Readonly<Record<string, number>> = {
    'Qwen3-1.7B-q4f16_1-MLC': 8_192,
    // The smallest window a five-track first turn and a receipt turn fit with the reply reserve.
    'Qwen3-4B-q4f16_1-MLC': 24_576,
    'Qwen3-8B-q4f16_1-MLC': 8_192,
};

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen3-4B-q4f16_1-MLC';

/** Legacy export for code that still references this. */
export { DEFAULT_WEBLLM_MODEL_ID as WEBLLM_MODEL_ID };
