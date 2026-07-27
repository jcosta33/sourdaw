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
