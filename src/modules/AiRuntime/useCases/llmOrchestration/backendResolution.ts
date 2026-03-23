import { isTauri } from '#/helpers/tauriBridge';
import { isCloudAvailable } from '../../repositories/cloudLlmRepository';
import { type AiBackend } from './types';

/**
 * Returns the preferred primary backend:
 * - native: when running in Tauri or on localhost (dev mode)
 * - webllm: when WebGPU is available in the browser (Hermes-2-Pro native tool calling)
 * - cloud: when Claude API key is configured but no local options exist
 * - none: no backend available
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

export function isLlmAvailable(): boolean {
    return resolveBackend() !== 'none';
}

/**
 * Returns the ordered fallback chain for inference.
 * Native → WebLLM → Cloud (each only included if potentially available).
 */
export function getBackendChain(): AiBackend[] {
    const chain: AiBackend[] = [];
    const primary = resolveBackend();

    if (primary === 'native') {
        chain.push('native');
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            chain.push('webllm');
        }
    } else if (primary === 'webllm') {
        chain.push('webllm');
    }

    if (isCloudAvailable()) {
        chain.push('cloud');
    }

    return chain;
}
