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
 * WebLLM model: Phi-3.5-mini (1.8 GB) — best speed/quality ratio for browser inference.
 * Previous: Hermes-3-Llama-3.1-8B-q4f16_1-MLC (~4 GB, slower, required Hermes XML prompts).
 */
export const WEBLLM_MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC';

export const WEBLLM_MODEL_INFO: ModelInfo = {
    displayName: 'Phi 3.5 Mini',
    downloadSize: '~1.8 GB',
    ramUsage: '~3 GB',
    description:
        'Compact local AI model for natural language DAW commands. Runs entirely on your device via WebGPU. Fast responses with good quality.',
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
