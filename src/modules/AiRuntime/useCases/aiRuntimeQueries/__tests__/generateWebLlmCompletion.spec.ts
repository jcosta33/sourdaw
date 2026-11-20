import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoLocalModelOfferedError } from '../../../errors/NoLocalModelOfferedError';
import { engineState } from '../../../repositories/webLlm/engineLifecycleState';
import { machineMemoryStore } from '../../../stores/machineMemoryStore';
import { generateWebLlmCompletion } from '../generateWebLlmCompletion';

const mocks = vi.hoisted(() => ({
    complete: vi.fn(),
    isWebLlmLoaded: vi.fn(),
}));

vi.mock('../../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: mocks.complete,
}));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: mocks.isWebLlmLoaded }));

const PRO = 'Qwen3-8B-q4f16_1-MLC';
const LARGE = 'Llama-3.1-70B-Instruct-q3f16_1-MLC';
const STANDARD = 'Qwen3-4B-q4f16_1-MLC';

describe('generateWebLlmCompletion auto-load', () => {
    beforeEach(() => {
        mocks.complete.mockReset();
        mocks.complete.mockResolvedValue('ok');
        mocks.isWebLlmLoaded.mockReturnValue(false);
    });

    afterEach(() => {
        engineState.activeModelId = PRO;
        machineMemoryStore.set({ state: 'unread' });
    });

    it('asks the repository to load the model the picker would select, not the hidden active one', async () => {
        machineMemoryStore.set({ state: 'known', totalBytes: 8_000_000_000, gpuBudgetBytes: null });
        engineState.activeModelId = PRO;

        await generateWebLlmCompletion('system', 'user');

        expect(mocks.complete).toHaveBeenCalledTimes(1);
        expect(mocks.complete.mock.calls[0]?.[2]).toMatchObject({ modelId: STANDARD });
    });

    it('keeps the active model when the machine is offered it', async () => {
        machineMemoryStore.set({ state: 'known', totalBytes: 64_000_000_000, gpuBudgetBytes: 48_000_000_000 });
        engineState.activeModelId = LARGE;

        await generateWebLlmCompletion('system', 'user');

        expect(mocks.complete.mock.calls[0]?.[2]).toMatchObject({ modelId: LARGE });
    });

    it('fails with a typed hosted-model sentence and loads nothing when the machine fits no local model', async () => {
        machineMemoryStore.set({ state: 'known', totalBytes: 2_000_000_000, gpuBudgetBytes: null });
        engineState.activeModelId = PRO;

        await expect(generateWebLlmCompletion('system', 'user')).rejects.toThrow(NoLocalModelOfferedError);
        await expect(generateWebLlmCompletion('system', 'user')).rejects.toThrow('Use a hosted model');
        expect(mocks.complete).not.toHaveBeenCalled();
    });
});
