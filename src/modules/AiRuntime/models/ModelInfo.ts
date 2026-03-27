/**
 * Model metadata types and constants for AI backends.
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
 * WebLLM model: Hermes-3-Llama-3.1-8B (~4.9 GB) — same generation as the native GGUF backend.
 * Supports native OpenAI-compatible tool calling (tools + tool_choice) via WebGPU.
 * Used for the command-prompt action engine when the native mistral.rs tier is unavailable.
 */
export const WEBLLM_MODEL_ID = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

export const WEBLLM_MODEL_INFO: ModelInfo = {
    displayName: 'Hermes 3 Llama 3.1 8B',
    downloadSize: '~4.9 GB',
    ramUsage: '~6 GB',
    description:
        'Browser-local AI via WebGPU. Same Hermes-3 model family as the native tier — reliable tool calling for DAW commands, no internet required after first download.',
};

export const NATIVE_MODEL_INFO: NativeModelInfo = {
    displayName: 'Hermes 3 Llama 3.1 8B',
    description: 'In-process inference via Metal GPU. Zero setup required — model auto-downloads on first use.',
    downloadSize: '~4.9 GB (first run only)',
    ramUsage: '~5.2 GB',
    huggingFaceId: 'NousResearch/Hermes-3-Llama-3.1-8B',
};

export const CLOUD_MODEL_INFO: ModelInfo = {
    displayName: 'Claude Sonnet (Cloud)',
    description: 'Cloud AI via Anthropic API. Best tool-calling quality. Requires API key. Usage-based pricing.',
    downloadSize: 'None',
    ramUsage: 'None',
};
