import { describe, it, expect, beforeEach } from 'vitest';

import { llmStatusStore } from '../llmStatusStore';

describe('llmStatusStore', () => {
    beforeEach(() => {
        llmStatusStore.set({ state: 'idle' });
    });

    it('initializes with idle state', () => {
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('can be updated to different states', () => {
        llmStatusStore.set({ state: 'loading', progress: 50, text: 'Downloading model...' });
        expect(llmStatusStore.value).toEqual({ state: 'loading', progress: 50, text: 'Downloading model...' });

        llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: 'test-model' });
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'test-model' });

        llmStatusStore.set({ state: 'error', message: 'Model failed to load' });
        expect(llmStatusStore.value).toEqual({ state: 'error', message: 'Model failed to load' });
    });
});
