/**
 * Model metadata types and constants for AI backends.
 */

/** Local model tiers, smallest to largest. The order is the contract: a reading offers every tier up to a limit. */
export const LOCAL_MODEL_TIERS = ['light', 'standard', 'pro', 'large'] as const;

export type LocalModelTier = (typeof LOCAL_MODEL_TIERS)[number];

export type ModelInfo = {
    id: string;
    displayName: string;
    description: string;
    downloadSize: string;
    /** The picker's memory text, always derived from `memoryGb`. */
    ramUsage: string;
    /** Memory the model needs, in decimal gigabytes, rounded up to a tenth. A machine clears it when both its total memory and its GPU memory budget reach this figure; without a GPU budget, total memory alone clears it for tiers up to Pro, and Large is never offered. */
    memoryGb: number;
    tier: LocalModelTier;
    parameterCount: string;
    /** The licence notice the model's licence requires beside every offer to download it; absent when its licence asks for none. */
    licenceNotice?: string;
};

type ModelInfoSpec = Omit<ModelInfo, 'ramUsage'>;

function defineModelInfo(spec: ModelInfoSpec): ModelInfo {
    return { ...spec, ramUsage: `~${spec.memoryGb.toFixed(1)} GB` };
}

// -- WebLLM model options (browser) --
//
// Each `memoryGb` (shown as `ramUsage`) is the GPU memory the model needs: the release manifest's VRAM figure, web-llm's
// published requirement at its recorded 4,096-token window, plus the KV cache for every token up
// to the window the model loads with (`WEBLLM_CONTEXT_WINDOW_TOKENS`). web-llm counts in MiB; the
// figure is converted to decimal gigabytes, the unit `downloadSize` uses, and rounded up to the
// next tenth.

export const WEBLLM_MODELS: ModelInfo[] = [
    defineModelInfo({
        id: 'Qwen3-1.7B-q4f16_1-MLC',
        displayName: 'Light',
        parameterCount: '1.7B',
        description:
            'Fast local chat and MIDI ideas. Cannot plan project edits: use the Pro local model or a hosted model.',
        downloadSize: '~0.99 GB',
        memoryGb: 2.7,
        tier: 'light',
    }),
    defineModelInfo({
        id: 'Qwen3-4B-q4f16_1-MLC',
        displayName: 'Standard',
        parameterCount: '4B',
        description:
            'Balanced local chat and MIDI ideas. Cannot plan project edits: use the Pro local model or a hosted model.',
        downloadSize: '~2.28 GB',
        memoryGb: 4.3,
        tier: 'standard',
    }),
    defineModelInfo({
        id: 'Qwen3-8B-q4f16_1-MLC',
        displayName: 'Pro',
        parameterCount: '8B',
        description:
            'The local model that plans project edits, with the best local chat and MIDI ideas. Needs a GPU with roughly 10 GB of memory. Recommended.',
        downloadSize: '~4.63 GB',
        memoryGb: 10.3,
        tier: 'pro',
    }),
    defineModelInfo({
        id: 'Llama-3.1-70B-Instruct-q3f16_1-MLC',
        displayName: 'Large',
        parameterCount: '70B',
        description:
            'The largest local model: plans project edits like Pro, with stronger local chat and MIDI ideas. Needs a GPU with roughly 42 GB of memory.',
        downloadSize: '~31.80 GB',
        memoryGb: 42.1,
        tier: 'large',
        licenceNotice:
            'Built with Llama. Llama 3.1 is licensed under the Llama 3.1 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.',
    }),
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
    // The same window as Pro, so every request Pro can plan fits Large too.
    'Llama-3.1-70B-Instruct-q3f16_1-MLC': 32_768,
};

/**
 * The local models that plan project edits. Planning needs a 7-8B model or larger: smaller ones do not plan
 * reliably, whatever their window holds, so a request that fits a smaller model's window is still
 * refused there.
 */
export const WEBLLM_PLANNING_MODEL_IDS: ReadonlySet<string> = new Set([
    'Qwen3-8B-q4f16_1-MLC',
    'Llama-3.1-70B-Instruct-q3f16_1-MLC',
]);

/** The local models with a thinking block, the only ones `enable_thinking: false` means anything to: web-llm prepends an empty block to the reply of any model it is sent to. */
export const WEBLLM_THINKING_MODEL_IDS: ReadonlySet<string> = new Set([
    'Qwen3-1.7B-q4f16_1-MLC',
    'Qwen3-4B-q4f16_1-MLC',
    'Qwen3-8B-q4f16_1-MLC',
]);

export const DEFAULT_WEBLLM_MODEL_ID = 'Qwen3-8B-q4f16_1-MLC';
