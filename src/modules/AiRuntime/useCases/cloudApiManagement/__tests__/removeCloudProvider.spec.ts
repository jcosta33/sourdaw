import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeCloudProvider } from '../removeCloudProvider';

const mocks = vi.hoisted(() => {
    const llmStatusValue: { value: Record<string, unknown> } = { value: { state: 'idle' } };
    return {
        clearCloudProviderConfig: vi.fn(async () => undefined),
        llmStatusSet: vi.fn(),
        llmStatusValue,
    };
});

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/clearCloudProviderConfig', () => ({
    clearCloudProviderConfig: mocks.clearCloudProviderConfig,
}));

vi.mock('#/modules/AiRuntime/stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatusValue.value;
        },
        set: mocks.llmStatusSet,
    },
}));

describe('removeCloudProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.llmStatusValue.value = { state: 'idle' };
    });

    it('clears the provider runtime', async () => {
        await removeCloudProvider();
        expect(mocks.clearCloudProviderConfig).toHaveBeenCalledTimes(1);
    });

    it('clears a ready cloud status', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };

        await removeCloudProvider();

        expect(mocks.llmStatusSet).toHaveBeenCalledWith({ state: 'idle' });
    });

    it('preserves an active local backend', async () => {
        mocks.llmStatusValue.value = { state: 'ready', backend: 'webllm', modelId: 'local-model' };

        await removeCloudProvider();

        expect(mocks.llmStatusSet).not.toHaveBeenCalled();
    });
});
