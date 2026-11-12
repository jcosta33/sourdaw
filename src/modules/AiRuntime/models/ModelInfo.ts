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
//
// Each `ramUsage` is the GPU memory the model needs: the release manifest's VRAM figure, web-llm's
// published requirement at its recorded 4,096-token window, plus the KV cache for every token up
// to the window the model loads with (`WEBLLM_CONTEXT_WINDOW_TOKENS`). web-llm counts in MiB; the
// figure is converted to decimal gigabytes, the unit `downloadSize` uses, and rounded up to the
// next tenth.

export const WEBLLM_MODELS: ModelInfo[] = [
    {
        id: 'Qwen3-1.7B-q4f16_1-MLC',
        displayName: 'Light',
        parameterCount: '1.7B',
        description:
            'Fast local chat and MIDI ideas. Cannot plan project edits: use the Pro local model or a hosted model.',
        downloadSize: '~0.99 GB',
        ramUsage: '~2.7 GB',
    },
    {
        id: 'Qwen3-4B-q4f16_1-MLC',
        displayName: 'Standard',
        parameterCount: '4B',
        description:
            'Balanced local chat and MIDI ideas. Cannot plan project edits: use the Pro local model or a hosted model.',
        downloadSize: '~2.28 GB',
        ramUsage: '~4.3 GB',
    },
    {
        id: 'Qwen3-8B-q4f16_1-MLC',
        displayName: 'Pro',
        parameterCount: '8B',
        description:
            'The local model that plans project edits, with the best local chat and MIDI ideas. Needs a GPU with roughly 10 GB of memory. Recommended.',
        downloadSize: '~4.63 GB',
        ramUsage: '~10.3 GB',
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
    'Qwen3-4B-q4f16_1-MLC': 8_192,
    // Qwen3-8B's native 32,768-token context: a five-track session's receipt turn at the evidence
    // ceiling, with production-shaped ids, needs more than 24,576 with the reply reserve.
    'Qwen3-8B-q4f16_1-MLC': 32_768,
};

/**
 * The local models that plan project edits. Planning needs a 7-8B model: smaller ones do not plan
 * reliably, whatever their window holds, so a request that fits a smaller model's window is still
 * refused there.
 */
export const WEBLLM_PLANNING_MODEL_IDS: ReadonlySet<string> = new Set(['Qwen3-8B-q4f16_1-MLC']);

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen3-8B-q4f16_1-MLC';
