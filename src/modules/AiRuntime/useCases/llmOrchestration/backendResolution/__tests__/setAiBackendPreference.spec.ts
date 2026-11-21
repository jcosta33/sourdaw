import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiBackendPreferenceStore } from '../../../../stores/aiBackendPreferenceStore';
import { answeringStatus } from '../../../../stores/answeringStatus';
import { setActiveAborter } from '../../../../stores/chatStore';
import { type LlmEngineStatus, llmStatusStore } from '../../../../stores/llmStatusStore';
import { setAiBackendPreference } from '../setAiBackendPreference';

const mocks = vi.hoisted(() => ({
    admission: { webLlm: true },
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: mocks.admission,
}));

describe('setAiBackendPreference', () => {
    beforeEach(() => {
        mocks.admission.webLlm = true;
        aiBackendPreferenceStore.set('auto');
        setActiveAborter(null);
        answeringStatus.clear();
        llmStatusStore.set({ state: 'idle' });
    });

    it('keeps the answering status showing and settles to idle when a turn answers', () => {
        const generating: LlmEngineStatus = { state: 'generating', backend: 'cloud', modelId: 'hosted-model' };
        const ready: LlmEngineStatus = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };
        llmStatusStore.set(ready);
        const turn = answeringStatus.openTurn();
        answeringStatus.publish(turn, generating);

        setAiBackendPreference('webllm');

        expect(llmStatusStore.value).toEqual(generating);

        answeringStatus.settle(turn, ready);

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('cancels an engine load a turn is waiting on when the preference changes', () => {
        const generating: LlmEngineStatus = { state: 'generating', backend: 'webllm', modelId: 'local-model' };
        llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: 'local-model' });
        const turn = answeringStatus.openTurn();
        answeringStatus.publish(turn, generating);
        answeringStatus.publishEngineStatus({ state: 'loading', progress: 0.5, text: 'Loading AI engine...' });

        setAiBackendPreference('cloud');

        expect(llmStatusStore.value).toEqual(generating);
        answeringStatus.settle(turn, { state: 'error', message: 'x' });
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('migrates a retired saved preference to automatic mode without breaking compatible readiness', () => {
        llmStatusStore.set({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });

        setAiBackendPreference('retired-local-provider');

        expect(aiBackendPreferenceStore.value).toBe('auto');
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'cloud', modelId: 'hosted-model' });
    });

    it('persists the selected browser backend from idle', () => {
        setAiBackendPreference('webllm');

        expect(aiBackendPreferenceStore.value).toBe('webllm');
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('preserves compatible browser backend readiness', () => {
        llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: 'browser-model' });

        setAiBackendPreference('webllm');

        expect(aiBackendPreferenceStore.value).toBe('webllm');
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'browser-model' });
    });

    it('fails closed when a stored WebLLM preference is no longer admitted', () => {
        mocks.admission.webLlm = false;
        llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: 'browser-model' });

        setAiBackendPreference('webllm');

        expect(aiBackendPreferenceStore.value).toBe('auto');
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
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
        llmStatusStore.set({ state: 'generating', backend: 'webllm', modelId: 'local-model' });

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
