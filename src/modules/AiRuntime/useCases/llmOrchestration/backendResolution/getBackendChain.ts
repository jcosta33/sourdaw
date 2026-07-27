import { type AiBackendPreference, type RunnableAiBackend } from '../../../models/LlmOrchestrationTypes';
import { isCloudAvailable } from '../../../repositories/cloudLlm/isCloudAvailable';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';

import { isNativeAiRuntimeAvailable } from './isNativeAiRuntimeAvailable';

const BACKEND_ORDERS: Record<AiBackendPreference, readonly RunnableAiBackend[]> = {
    auto: ['native', 'webllm', 'cloud'],
    native: ['native', 'webllm', 'cloud'],
    webllm: ['webllm', 'native', 'cloud'],
    cloud: ['cloud', 'native', 'webllm'],
};

function isBackendAvailable(backend: RunnableAiBackend): boolean {
    if (backend === 'native') {
        return isNativeAiRuntimeAvailable();
    }
    if (backend === 'webllm') {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }
    return isCloudAvailable();
}

/**
 * Returns the ordered fallback chain for inference.
 * Used by provider-neutral structured tool planning.
 */
export function getBackendChain(): RunnableAiBackend[] {
    const preference = aiBackendPreferenceStore.value ?? 'auto';
    if (preference !== 'auto') {
        return isBackendAvailable(preference) ? [preference] : [];
    }

    const readyBackend = llmStatusStore.value?.state === 'ready' ? llmStatusStore.value.backend : null;
    const orderedBackends =
        readyBackend === null
            ? BACKEND_ORDERS.auto
            : [readyBackend, ...BACKEND_ORDERS.auto.filter((backend) => backend !== readyBackend)];
    return orderedBackends.filter((backend) => isBackendAvailable(backend));
}
