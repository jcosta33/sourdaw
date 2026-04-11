import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { initEngine } from '../lifecycle/initEngine';
import { type Logger } from '#/helpers/Logger/Logger';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { resolveBackend } from '../backendResolution/helpers';
import { initNativeEngine } from '../../../repositories/nativeEngine/lifecycle';
import { initWebLlmEngine } from '../../../repositories/webLlm/engineLifecycle';
import { isCloudAvailable } from '../../../repositories/cloudLlm/keyManagement';

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        set: vi.fn(),
        value: null,
    },
}));

vi.mock('../../../repositories/nativeEngine/lifecycle', () => ({
    initNativeEngine: vi.fn(),
    stopNativeEngine: vi.fn(),
    isNativeEngineReady: vi.fn(() => false),
}));

vi.mock('../../../repositories/webLlm/engineLifecycle', () => ({
    initWebLlmEngine: vi.fn(() => Promise.resolve({})),
    unloadWebLlmEngine: vi.fn(),
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

        const logger = createMock<Logger>();
        injectDependencies(initEngine, { logger });

        await expect(initEngine()).rejects.toThrow(/No AI backend available/);

        expect(llmStatusStore.set).toHaveBeenCalledWith({
            state: 'error',
            message: 'No AI backend available',
        });
    });

    it('should mark cloud backend ready without loading engines', async () => {
        vi.mocked(resolveBackend).mockReturnValue('cloud');

        const logger = createMock<Logger>();
        injectDependencies(initEngine, { logger });

        await initEngine();

        expect(llmStatusStore.set).toHaveBeenCalledWith({ state: 'ready', modelId: 'claude' });
        expect(initNativeEngine).not.toHaveBeenCalled();
        expect(initWebLlmEngine).not.toHaveBeenCalled();
    });

    it('should initialize native engine when backend is native', async () => {
        vi.mocked(resolveBackend).mockReturnValue('native');
        vi.mocked(initNativeEngine).mockResolvedValue(undefined);

        const logger = createMock<Logger>();
        injectDependencies(initEngine, { logger });

        await initEngine();

        expect(initNativeEngine).toHaveBeenCalled();
        expect(llmStatusStore.set).toHaveBeenCalledWith({ state: 'ready', modelId: 'native' });
    });

    it('should fall back to WebLLM when native init fails and WebGPU is available', async () => {
        vi.mocked(resolveBackend).mockReturnValue('native');
        vi.mocked(initNativeEngine).mockRejectedValue(new Error('native failed'));
        Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });

        const logger = createMock<Logger>();
        injectDependencies(initEngine, { logger });

        await initEngine();

        expect(initWebLlmEngine).toHaveBeenCalled();
    });

    it('should load WebLLM when backend is webllm', async () => {
        vi.mocked(resolveBackend).mockReturnValue('webllm');

        const logger = createMock<Logger>();
        injectDependencies(initEngine, { logger });

        await initEngine('model-x');

        expect(initWebLlmEngine).toHaveBeenCalledWith('model-x');
    });
});
