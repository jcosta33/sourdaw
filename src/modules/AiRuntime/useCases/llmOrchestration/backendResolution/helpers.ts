import { type AiBackend, type RunnableAiBackend } from '../../../models/LlmOrchestrationTypes';
import { isCloudAvailable } from '../../../repositories/cloudLlm/isCloudAvailable';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../stores/llmStatusStore';

import { isNativeAiRuntimeAvailable } from './isNativeAiRuntimeAvailable';

function isWebLlmAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function isBackendAvailable(backend: RunnableAiBackend): boolean {
    if (backend === 'native') {
        return isNativeAiRuntimeAvailable();
    }
    if (backend === 'webllm') {
        return isWebLlmAvailable();
    }
    return isCloudAvailable();
}

/**
 * Resolve the active inference backend for chat and provider-neutral tool planning.
 *
 * - native: Tauri desktop runtime
 * - webllm: browser-local WebGPU runtime
 * - cloud: configured hosted-provider adapter
 * - none: no backend is currently available
 *
 * An explicit unavailable preference fails closed instead of silently changing providers.
 */
export function resolveBackend(): AiBackend {
    const preference = aiBackendPreferenceStore.value ?? 'auto';
    if (preference !== 'auto') {
        return isBackendAvailable(preference) ? preference : 'none';
    }

    const runtimeStatus = llmStatusStore.value;
    if (runtimeStatus?.state === 'ready' && isBackendAvailable(runtimeStatus.backend)) {
        return runtimeStatus.backend;
    }

    if (isNativeAiRuntimeAvailable()) {
        return 'native';
    }
    if (isWebLlmAvailable()) {
        return 'webllm';
    }
    if (isCloudAvailable()) {
        return 'cloud';
    }
    return 'none';
}
