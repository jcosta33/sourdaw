import { isCloudAvailable } from '../../../repositories/cloudLlm/keyManagement';
import type { AiBackend } from './helpers';
import { resolveBackend } from './helpers';

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