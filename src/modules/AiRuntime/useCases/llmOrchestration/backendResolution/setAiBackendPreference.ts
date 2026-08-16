import { type AiBackendPreference } from '../../../models/LlmOrchestrationTypes';
import { aiBackendPreferenceStore } from '../../../stores/aiBackendPreferenceStore';
import { stopGenerating } from '../../../stores/chatStore';
import { engineInitializationState } from '../../../stores/engineInitializationState';
import { llmStatusStore } from '../../../stores/llmStatusStore';

export function normalizeAiBackendPreference(preference: unknown): AiBackendPreference {
    return preference === 'webllm' || preference === 'cloud' ? preference : 'auto';
}

export function setAiBackendPreference(preference: unknown): void {
    const normalizedPreference = normalizeAiBackendPreference(preference);
    const status = llmStatusStore.value;
    const preferenceChanged = aiBackendPreferenceStore.value !== normalizedPreference;
    if (status?.state === 'generating') {
        stopGenerating();
    }
    if (preferenceChanged && status?.state === 'loading') {
        engineInitializationState.cancel();
    }
    aiBackendPreferenceStore.set(normalizedPreference);
    if (
        status?.state === 'generating' ||
        (preferenceChanged && status?.state === 'loading') ||
        (status?.state === 'ready' && normalizedPreference !== 'auto' && status.backend !== normalizedPreference)
    ) {
        llmStatusStore.set({ state: 'idle' });
    }
}
