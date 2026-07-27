import { type AiBackendPreference } from '../../../models/LlmOrchestrationTypes';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { stopGenerating } from '../../../stores/chatStore';
import { engineInitializationState } from '../../../stores/engineInitializationState';
import { llmStatusStore } from '../../../stores/llmStatusStore';

export function setAiBackendPreference(preference: AiBackendPreference): void {
    const status = llmStatusStore.value;
    const preferenceChanged = aiBackendPreferenceStore.value !== preference;
    if (status?.state === 'generating') {
        stopGenerating();
    }
    if (preferenceChanged && status?.state === 'loading') {
        engineInitializationState.cancel();
    }
    aiBackendPreferenceStore.set(preference);
    if (
        status?.state === 'generating' ||
        (preferenceChanged && status?.state === 'loading') ||
        (status?.state === 'ready' && preference !== 'auto' && status.backend !== preference)
    ) {
        llmStatusStore.set({ state: 'idle' });
    }
}
