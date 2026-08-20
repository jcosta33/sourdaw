import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type AiBackendPreference } from '../../../models/LlmOrchestrationTypes';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { stopGenerating } from '../../../stores/chatStore';
import { engineInitializationState } from '../../../stores/engineInitializationState';
import { llmStatusStore } from '../../../stores/llmStatusStore';

function normalizeAiBackendPreference(preference: unknown): AiBackendPreference {
    if (preference === 'webllm') {
        return MODEL_RELEASE_ADMISSION.webLlm ? 'webllm' : 'auto';
    }
    return preference === 'cloud' ? preference : 'auto';
}

export function setAiBackendPreference(preference: unknown): void {
    const normalizedPreference = normalizeAiBackendPreference(preference);
    const status = llmStatusStore.value;
    const activeBackendWithheld =
        status?.state === 'ready' && status.backend === 'webllm' && !MODEL_RELEASE_ADMISSION.webLlm;
    const preferenceChanged = aiBackendPreferenceStore.value !== normalizedPreference;
    if (status?.state === 'generating') {
        stopGenerating();
    }
    if (preferenceChanged && status?.state === 'loading') {
        engineInitializationState.cancel();
    }
    aiBackendPreferenceStore.set(normalizedPreference);
    if (
        activeBackendWithheld ||
        status?.state === 'generating' ||
        (preferenceChanged && status?.state === 'loading') ||
        (status?.state === 'ready' && normalizedPreference !== 'auto' && status.backend !== normalizedPreference)
    ) {
        llmStatusStore.set({ state: 'idle' });
    }
}
