import { beforeEach, describe, it, expect, vi } from 'vitest';

import { removeCloudApi } from '../removeCloudApi';

const mocks = vi.hoisted(() => {
    const llmStatusValue: { value: Record<string, unknown> } = { value: { state: 'idle' } };
    return {
        clearCloudApiKey: vi.fn(),
        llmStatusSet: vi.fn(),
        llmStatusValue,
    };
});

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/clearCloudApiKey', () => ({
    clearCloudApiKey: mocks.clearCloudApiKey,
}));

vi.mock('#/modules/AiRuntime/stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatusValue.value;
        },
        set: mocks.llmStatusSet,
    },
}));

describe('removeCloudApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.llmStatusValue.value = { state: 'idle' };
    });

    it('calls clearCloudApiKey from the repository', () => {
        removeCloudApi();
        expect(mocks.clearCloudApiKey).toHaveBeenCalledTimes(1);
    });

    it('clears a ready cloud status after removing its credentials', () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };

        removeCloudApi();

        expect(mocks.llmStatusSet).toHaveBeenCalledWith({ state: 'idle' });
    });

    it('preserves the status of an active local backend', () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'webllm', modelId: 'local-model' };

        removeCloudApi();

        expect(mocks.llmStatusSet).not.toHaveBeenCalled();
    });
});
