import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unloadEngine } from '../unloadEngine';
import { llmStatusStore } from '../../../../stores/llmStatusStore';

const mocks = vi.hoisted(() => ({
    isNativeEngineReady: vi.fn(),
    stopNativeEngine: vi.fn(),
    unloadWebLlmEngine: vi.fn(),
}));

vi.mock('../../../../repositories/nativeEngine/lifecycle', () => ({
    isNativeEngineReady: mocks.isNativeEngineReady,
    stopNativeEngine: mocks.stopNativeEngine,
}));

vi.mock('../../../../repositories/webLlm/engineLifecycle', () => ({
    unloadWebLlmEngine: mocks.unloadWebLlmEngine,
}));

describe('unloadEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmStatusStore.set({ state: 'ready', modelId: 'test' });
    });

    it('stops native engine if ready, unloads webllm, and sets state to idle', async () => {
        mocks.isNativeEngineReady.mockReturnValue(true);
        mocks.stopNativeEngine.mockResolvedValue(undefined);

        await unloadEngine();

        expect(mocks.stopNativeEngine).toHaveBeenCalledTimes(1);
        expect(mocks.unloadWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('skips stopping native engine if not ready', async () => {
        mocks.isNativeEngineReady.mockReturnValue(false);

        await unloadEngine();

        expect(mocks.stopNativeEngine).not.toHaveBeenCalled();
        expect(mocks.unloadWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });
});
