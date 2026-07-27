import { describe, it, expect, vi, beforeEach } from 'vitest';

import { initNativeEngine } from '../../../repositories/nativeEngine/initNativeEngine';
import { initWebLlmEngine } from '../../../repositories/webLlm/initWebLlmEngine';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { initEngine } from '../lifecycle/initEngine';

const { backendChain, mockLogger } = vi.hoisted(() => ({
    backendChain: { value: Array<'native' | 'webllm' | 'cloud'>() },
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

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: () => backendChain.value,
}));

describe('initEngine', () => {
    beforeEach(() => {
        vi.mocked(initNativeEngine).mockReset();
        vi.mocked(initWebLlmEngine).mockReset();
        vi.mocked(llmStatusStore.set).mockReset();
        backendChain.value = [];
        vi.mocked(initWebLlmEngine).mockResolvedValue({});
        delete (navigator as { gpu?: unknown }).gpu;
    });

    it('should set error state and throw when no backend is available', async () => {
        await expect(initEngine()).rejects.toThrow(/No AI backend available/);

        expect(llmStatusStore.set).toHaveBeenCalledWith({
            state: 'error',
            message: 'No AI backend available',
        });
    });

    it('should leave configured cloud idle until the first successful request', async () => {
        backendChain.value = ['cloud'];

        await initEngine();

        expect(llmStatusStore.set).toHaveBeenLastCalledWith({ state: 'idle' });
        expect(initNativeEngine).not.toHaveBeenCalled();
        expect(initWebLlmEngine).not.toHaveBeenCalled();
    });

    it('should initialize native engine when backend is native', async () => {
        backendChain.value = ['native'];
        vi.mocked(initNativeEngine).mockResolvedValue(undefined);

        await initEngine();

        expect(initNativeEngine).toHaveBeenCalled();
        expect(llmStatusStore.set).toHaveBeenCalledWith({ state: 'ready', backend: 'native', modelId: 'native' });
    });

    it('should fall back to WebLLM when native init fails and WebGPU is available', async () => {
        backendChain.value = ['native', 'webllm'];
        vi.mocked(initNativeEngine).mockRejectedValue(new Error('native failed'));
        Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });

        await initEngine();

        expect(initWebLlmEngine).toHaveBeenCalled();
    });

    it('should load WebLLM when backend is webllm', async () => {
        backendChain.value = ['webllm'];

        await initEngine('model-x');

        const initCall = vi.mocked(initWebLlmEngine).mock.calls[0];
        expect(initCall?.[0]).toBe('model-x');
        const options: unknown = initCall?.[1];
        if (typeof options !== 'object' || options === null || Array.isArray(options)) {
            throw new TypeError('Expected WebLLM initialization options');
        }
        expect('signal' in options ? options.signal : undefined).toBeInstanceOf(AbortSignal);
    });
});
