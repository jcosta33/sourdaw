import { isCloudAvailable } from '../../../repositories/cloudLlm/isCloudAvailable';

import { resolveBackend } from './helpers';

import type { AiBackend } from './helpers';

/**
 * Returns the ordered fallback chain for inference.
 * Used by provider-neutral structured tool planning.
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
