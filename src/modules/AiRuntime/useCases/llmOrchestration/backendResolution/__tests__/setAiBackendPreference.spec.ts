import { beforeEach, describe, expect, it } from 'vitest';

import { aiBackendPreferenceStore } from '../../../../stores/aiBackendPreferenceStore';
import { setActiveAborter } from '../../../../stores/chatStore';
import { llmStatusStore } from '../../../../stores/llmStatusStore';
import { setAiBackendPreference } from '../setAiBackendPreference';

describe('setAiBackendPreference', () => {
    beforeEach(() => {
        aiBackendPreferenceStore.set('auto');
        setActiveAborter(null);
        llmStatusStore.set({ state: 'idle' });
    });

    it('migrates a retired saved preference to automatic mode without breaking compatible readiness', () => {
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });

        setAiBackendPreference('retired-local-provider');

        expect(aiBackendPreferenceStore.value).toBe('auto');
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
    });

    it('persists the selected browser backend without clearing compatible readiness', () => {
        llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: 'browser-model' });

        setAiBackendPreference('webllm');

        expect(aiBackendPreferenceStore.value).toBe('webllm');
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'browser-model' });
    });

    it('preserves the active backend when returning to automatic mode', () => {
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });

        setAiBackendPreference('auto');

        expect(llmStatusStore.value).toEqual({
            state: 'ready',
            backend: 'cloud',
            modelId: 'hosted-model',
        });
    });

    it('aborts in-flight generation before switching backend', () => {
        const controller = new AbortController();
        setActiveAborter(controller);
        llmStatusStore.set({ state: 'generating' });

        setAiBackendPreference('retired-local-provider');

        expect(controller.signal.aborted).toBe(true);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('invalidates an in-flight engine load when the preference changes', () => {
        llmStatusStore.set({ state: 'loading', progress: 0.5, text: 'Loading AI engine...' });

        setAiBackendPreference('cloud');

        expect(aiBackendPreferenceStore.value).toBe('cloud');
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });
});
