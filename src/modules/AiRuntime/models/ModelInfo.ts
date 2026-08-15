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

export type NativeModelInfo = ModelInfo & {
    huggingFaceId: string;
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
        description: 'Good quality with moderate resource usage. Recommended.',
        downloadSize: '~2.28 GB',
        ramUsage: '~3.5 GB',
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

export const NATIVE_MODEL_INFO: NativeModelInfo = {
    id: 'qwen3-8b-native',
    displayName: 'Qwen3 8B',
    parameterCount: '8B',
    description: 'In-process inference via Metal/CUDA GPU with schema-constrained command planning.',
    downloadSize: '~5.0 GB (first run only)',
    ramUsage: '~6.0 GB',
    huggingFaceId: 'Qwen/Qwen3-8B',
};
