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
// `ramUsage` is the release manifest's `vramRequiredMb` for the window the model loads with,
// rounded up to the next half gigabyte. That figure is web-llm's published requirement at a
// 4,096-token window plus the KV cache for every token above it: two tensors of 8 KV heads ×
// 128 dimensions at 2 bytes per layer, so 144 KiB per token for the 36-layer 4B and 8B models
// and 112 KiB for the 28-layer 1.7B.

export const WEBLLM_MODELS: ModelInfo[] = [
    {
        id: 'Qwen3-1.7B-q4f16_1-MLC',
        displayName: 'Light',
        parameterCount: '1.7B',
        description: 'Fast responses, low resource usage. Best for simple edits.',
        downloadSize: '~0.99 GB',
        ramUsage: '~2.5 GB',
    },
    {
        id: 'Qwen3-4B-q4f16_1-MLC',
        displayName: 'Standard',
        parameterCount: '4B',
        description: 'Good quality with moderate resource usage. Recommended.',
        downloadSize: '~2.28 GB',
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

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen3-4B-q4f16_1-MLC';

/** Legacy export for code that still references this. */
export { DEFAULT_WEBLLM_MODEL_ID as WEBLLM_MODEL_ID };
