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

export const WEBLLM_MODEL_ID = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

export const WEBLLM_MODEL_INFO: ModelInfo = {
    displayName: 'Hermes 3 Llama 3.1 8B',
    downloadSize: '~4 GB',
    ramUsage: '~6 GB',
    description: 'Local AI model for natural language DAW commands. Runs entirely on your device via WebGPU.',
};

export const NATIVE_MODEL_INFO: NativeModelInfo = {
    displayName: 'Hermes 3 Llama 3.1 8B (GGUF)',
    description: 'Native inference via Metal GPU. Near 100% GPU utilization. Requires llama-server.',
    downloadSize: '~4.9 GB',
    ramUsage: '~5.2 GB',
    downloadUrl: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
    fileName: 'Hermes-3-Llama-3.1-8B.Q4_K_M.gguf',
};
