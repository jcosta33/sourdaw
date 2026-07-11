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

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen3-4B-q4f16_1-MLC';

/** Legacy export for code that still references this. */
export { DEFAULT_WEBLLM_MODEL_ID as WEBLLM_MODEL_ID };
