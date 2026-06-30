import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isCloudAvailable } from '../../../repositories/cloudLlm/keyManagement';
import { initNativeEngine } from '../../../repositories/nativeEngine/initNativeEngine';
import { initWebLlmEngine } from '../../../repositories/webLlm/initWebLlmEngine';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { resolveBackend } from '../backendResolution/helpers';
import { initEngine } from '../lifecycle/initEngine';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        set: vi.fn(),
        value: null,
    },
}));

vi.mock('../../../repositories/nativeEngine/initNativeEngine', () => ({
    initNativeEngine: vi.fn(),
}));

vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../repositories/cloudLlm/keyManagement', () => ({
    isCloudAvailable: vi.fn(() => false),
}));

vi.mock('../backendResolution/helpers', () => ({
    resolveBackend: vi.fn(),
}));

describe('initEngine', () => {
    beforeEach(() => {
        vi.mocked(resolveBackend).mockReset();
        vi.mocked(initNativeEngine).mockReset();
        vi.mocked(initWebLlmEngine).mockReset();
        vi.mocked(isCloudAvailable).mockReset();
        vi.mocked(llmStatusStore.set).mockReset();
        vi.mocked(isCloudAvailable).mockReturnValue(false);
        vi.mocked(initWebLlmEngine).mockResolvedValue({} as never);
        delete (navigator as { gpu?: unknown }).gpu;
    });

    it('should set error state and throw when no backend is available', async () => {
        vi.mocked(resolveBackend).mockReturnValue('none');

        await expect(initEngine()).rejects.toThrow(/No AI backend available/);

        expect(llmStatusStore.set).toHaveBeenCalledWith({
            state: 'error',
            message: 'No AI backend available',
        });
    });

    it('should mark cloud backend ready without loading engines', async () => {
        vi.mocked(resolveBackend).mockReturnValue('cloud');

        await initEngine();

        expect(llmStatusStore.set).toHaveBeenCalledWith({ state: 'ready', modelId: 'claude' });
        expect(initNativeEngine).not.toHaveBeenCalled();
        expect(initWebLlmEngine).not.toHaveBeenCalled();
    });

    it('should initialize native engine when backend is native', async () => {
        vi.mocked(resolveBackend).mockReturnValue('native');
        vi.mocked(initNativeEngine).mockResolvedValue(undefined);

        await initEngine();

        expect(initNativeEngine).toHaveBeenCalled();
        expect(llmStatusStore.set).toHaveBeenCalledWith({ state: 'ready', modelId: 'native' });
    });

    it('should fall back to WebLLM when native init fails and WebGPU is available', async () => {
        vi.mocked(resolveBackend).mockReturnValue('native');
        vi.mocked(initNativeEngine).mockRejectedValue(new Error('native failed'));
        Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });

        await initEngine();

        expect(initWebLlmEngine).toHaveBeenCalled();
    });

    it('should load WebLLM when backend is webllm', async () => {
        vi.mocked(resolveBackend).mockReturnValue('webllm');

        await initEngine('model-x');

        expect(initWebLlmEngine).toHaveBeenCalledWith('model-x');
    });
});
