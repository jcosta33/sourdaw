import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type AiBackendPreference } from '../../../models/LlmOrchestrationTypes';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { answeringStatus } from '../../../stores/answeringStatus';
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
    // A turn answering shows `generating` while the engine's own status is the one it settles to.
    const answering = llmStatusStore.value?.state === 'generating';
    const status = answeringStatus.readEngineStatus();
    const activeBackendWithheld =
        status?.state === 'ready' && status.backend === 'webllm' && !MODEL_RELEASE_ADMISSION.webLlm;
    const preferenceChanged = aiBackendPreferenceStore.value !== normalizedPreference;
    if (answering) {
        stopGenerating();
    }
    if (preferenceChanged && status?.state === 'loading') {
        engineInitializationState.cancel();
    }
    aiBackendPreferenceStore.set(normalizedPreference);
    if (
        activeBackendWithheld ||
        (preferenceChanged && status?.state === 'loading') ||
        (status?.state === 'ready' && normalizedPreference !== 'auto' && status.backend !== normalizedPreference)
    ) {
        answeringStatus.publishEngineStatus({ state: 'idle' });
    }
}
