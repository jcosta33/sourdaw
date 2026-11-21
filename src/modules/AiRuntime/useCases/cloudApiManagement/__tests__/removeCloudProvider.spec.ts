import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answeringStatus } from '../../../stores/answeringStatus';
import { type LlmEngineStatus } from '../../../stores/llmStatusStore';
import { removeCloudProvider } from '../removeCloudProvider';

const mocks = vi.hoisted(() => {
    const llmStatusValue: { value: LlmEngineStatus | null } = { value: { state: 'idle' } };
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
        set: (status: LlmEngineStatus | null) => {
            mocks.llmStatusValue.value = status;
            mocks.llmStatusSet(status);
        },
    },
}));

describe('removeCloudProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        answeringStatus.clear();
        mocks.llmStatusValue.value = { state: 'idle' };
    });

    it('keeps the answering status showing and settles to idle when a turn answers', async () => {
        const generating: LlmEngineStatus = {
            state: 'generating',
            backend: 'cloud',
            provider: 'anthropic',
            modelId: 'hosted-model',
        };
        mocks.llmStatusValue.value = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };
        const turn = answeringStatus.openTurn();
        answeringStatus.publish(turn, generating);

        await removeCloudProvider();

        expect(mocks.llmStatusValue.value).toEqual(generating);

        answeringStatus.settle(turn, { state: 'ready', backend: 'cloud', modelId: 'hosted-model' });

        expect(mocks.llmStatusValue.value).toEqual({ state: 'idle' });
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
