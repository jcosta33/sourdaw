import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { answeringStatus } from '../../../../stores/answeringStatus';
import { llmStatusStore, type LlmEngineStatus } from '../../../../stores/llmStatusStore';
import { initEngine } from '../initEngine';

const { getBackendChainMock, initWebLlmEngineMock, getActiveModelIdMock } = vi.hoisted(() => ({
    getBackendChainMock: vi.fn(),
    initWebLlmEngineMock: vi.fn(),
    getActiveModelIdMock: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../backendResolution/getBackendChain', () => ({ getBackendChain: getBackendChainMock }));
vi.mock('../../../../repositories/webLlm/initWebLlmEngine', () => ({ initWebLlmEngine: initWebLlmEngineMock }));
vi.mock('../../../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: getActiveModelIdMock }));

const MODEL_ID = 'model-under-test';
const READY: LlmEngineStatus = { state: 'ready', backend: 'webllm', modelId: MODEL_ID };
const GENERATING: LlmEngineStatus = { state: 'generating', backend: 'webllm', modelId: MODEL_ID };

describe('initEngine status publication', () => {
    beforeEach(() => {
        answeringStatus.clear();
        llmStatusStore.set({ state: 'idle' });
        getBackendChainMock.mockReset();
        initWebLlmEngineMock.mockReset();
        getActiveModelIdMock.mockReset();
        getActiveModelIdMock.mockReturnValue(MODEL_ID);
    });

    afterEach(() => {
        answeringStatus.clear();
        llmStatusStore.set({ state: 'idle' });
    });

    it('reports an error when no backend is available', async () => {
        getBackendChainMock.mockReturnValue([]);

        await expect(initEngine()).rejects.toThrow('No AI backend available');

        expect(llmStatusStore.value).toEqual({ state: 'error', message: 'No AI backend available' });
        expect(initWebLlmEngineMock).not.toHaveBeenCalled();
    });

    it('shows loading while the webllm engine starts, then ready', async () => {
        getBackendChainMock.mockReturnValue(['webllm']);
        const seenDuringInit: Array<typeof llmStatusStore.value> = [];
        initWebLlmEngineMock.mockImplementation(async () => {
            seenDuringInit.push(llmStatusStore.value);
        });

        await expect(initEngine(MODEL_ID)).resolves.toBe('webllm');

        expect(seenDuringInit).toEqual([{ state: 'loading', progress: 0, text: 'Starting webllm engine...' }]);
        expect(llmStatusStore.value).toEqual(READY);
    });

    it('settles to idle for the cloud backend', async () => {
        getBackendChainMock.mockReturnValue(['cloud']);

        await expect(initEngine()).resolves.toBe('cloud');

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
        expect(initWebLlmEngineMock).not.toHaveBeenCalled();
    });

    it('reports the load failure when the only backend fails', async () => {
        getBackendChainMock.mockReturnValue(['webllm']);
        initWebLlmEngineMock.mockRejectedValue(new Error('gpu lost'));

        await expect(initEngine()).rejects.toThrow('AI engine failed to load: gpu lost');

        expect(llmStatusStore.value).toEqual({ state: 'error', message: 'AI engine failed to load: gpu lost' });
    });

    it('keeps an open answering attempt on screen until it settles to the loaded engine', async () => {
        getBackendChainMock.mockReturnValue(['webllm']);
        const turn = answeringStatus.openTurn();
        answeringStatus.publish(turn, { state: 'generating', backend: 'webllm', modelId: MODEL_ID });

        await initEngine(MODEL_ID);

        expect(llmStatusStore.value).toEqual(GENERATING);

        answeringStatus.settle(turn, null);

        expect(llmStatusStore.value).toEqual(READY);
    });
});
