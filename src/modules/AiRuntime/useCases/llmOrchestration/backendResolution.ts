import { isTauri } from '#/helpers/tauriBridge';
import { isCloudAvailable } from '../../repositories/cloudLlm/keyManagement';

type AiBackend = 'native' | 'webllm' | 'cloud' | 'none';

/**
 * Resolve the primary backend for DSO edit planning.
 *
 * Single-model policy: Qwen3-8B only.
 * - native: Tauri desktop (mistral.rs with Constraint::JsonSchema)
 * - webllm: Browser with WebGPU (response_format with EditPlanSchema)
 * - cloud: Claude API — used for CHAT ONLY, not DSO planning
 * - none: no backend available — AI editing is disabled
 *
 * No automatic fallback between model families.
 */
export function resolveBackend(): AiBackend {
    if (isTauri()) {
        return 'native';
    }
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        return 'webllm';
    }
    if (isCloudAvailable()) {
        return 'cloud';
    }
    return 'none';
}

/**
 * Whether a DSO-capable backend is available.
 * Cloud is excluded — it's for chat only, not structured DSO planning.
 */
export function isDsoBackendAvailable(): boolean {
    const backend = resolveBackend();
    return backend === 'native' || backend === 'webllm';
}

/**
 * Whether ANY LLM backend is available (including cloud for chat).
 */
export function isLlmAvailable(): boolean {
    return resolveBackend() !== 'none';
}

/**
 * Returns the ordered fallback chain for inference.
 * Used by the old tool-calling system (chat, not DSO editing).
 */
export function getBackendChain(): AiBackend[] {
    const chain: AiBackend[] = [];
    const primary = resolveBackend();

    if (primary === 'native') {
        chain.push('native');
    } else if (primary === 'webllm') {
        chain.push('webllm');
    }

    if (isCloudAvailable()) {
        chain.push('cloud');
    }

    return chain;
}
