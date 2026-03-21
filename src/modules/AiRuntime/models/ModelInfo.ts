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
    downloadUrl: string;
    fileName: string;
};

/**
 * WebLLM model: Hermes-3-Llama-3.1-8B (~4.9 GB) — same generation as the native GGUF backend.
 * Supports native OpenAI-compatible tool calling (tools + tool_choice) via WebGPU.
 * Used for the command-prompt action engine when the native llama-server tier is unavailable.
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
    displayName: 'Hermes 3 Llama 3.1 8B (GGUF)',
    description: 'Native inference via Metal GPU. Near 100% GPU utilization. Requires llama-server.',
    downloadSize: '~4.9 GB',
    ramUsage: '~5.2 GB',
    downloadUrl:
        'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    fileName: 'Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
};

export const CLOUD_MODEL_INFO: ModelInfo = {
    displayName: 'Claude Sonnet (Cloud)',
    description: 'Cloud AI via Anthropic API. Best tool-calling quality. Requires API key. Usage-based pricing.',
    downloadSize: 'None',
    ramUsage: 'None',
};
