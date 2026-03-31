/**
 * Model metadata types and constants for AI backends.
 *
 * Single-model policy: Qwen3-8B is the only planning model.
 * No automatic fallback to smaller/different models.
 * If the runtime cannot support Qwen3-8B, AI editing is disabled.
 */

export type ModelInfo = {
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
};

export type NativeModelInfo = ModelInfo & {
    huggingFaceId: string;
};

/**
 * Single planning model: Qwen3-8B across both browser and native runtimes.
 */
export const WEBLLM_MODEL_ID = 'Qwen3-8B-q4f16_1-MLC';

export const WEBLLM_MODEL_INFO: ModelInfo = {
    displayName: 'Qwen3 8B',
    downloadSize: '~5.0 GB',
    ramUsage: '~6.5 GB',
    description:
        'Browser-local AI via WebGPU. Structured edit planning with response_format schema constraints. No internet required after first download.',
};

export const NATIVE_MODEL_INFO: NativeModelInfo = {
    displayName: 'Qwen3 8B',
    description:
        'In-process inference via Metal/CUDA GPU. Schema-constrained DSO generation via Constraint::JsonSchema.',
    downloadSize: '~5.0 GB (first run only)',
    ramUsage: '~6.0 GB',
    huggingFaceId: 'Qwen/Qwen3-8B',
};

export const CLOUD_MODEL_INFO: ModelInfo = {
    displayName: 'Claude Sonnet (Cloud)',
    description: 'Cloud AI via Anthropic API. Fallback for chat only — not used for DSO edit planning.',
    downloadSize: 'None',
    ramUsage: 'None',
};
