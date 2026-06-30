import { describe, it, expect, vi, beforeEach } from 'vitest';

import { llmStatusStore } from '../../../../stores/llmStatusStore';
import { initEngine } from '../initEngine';

const mocks = vi.hoisted(() => ({
    resolveBackend: vi.fn<() => string>(),
    initNativeEngine: vi.fn<() => Promise<void>>(),
    initWebLlmEngine: vi.fn<(modelId?: string) => Promise<void>>(),
    isCloudAvailable: vi.fn<() => boolean>(),
    info: vi.fn<(msg: string) => void>(),
    warn: vi.fn<(msg: string) => void>(),
}));

vi.mock('../../backendResolution/helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

vi.mock('../../../../repositories/nativeEngine/initNativeEngine', () => ({
    initNativeEngine: mocks.initNativeEngine,
}));

vi.mock('../../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('../../../../repositories/cloudLlm/keyManagement', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info, warn: mocks.warn },
}));

describe('initEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmStatusStore.set({ state: 'idle' });
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    it('throws if no backend is available', async () => {
        mocks.resolveBackend.mockReturnValue('none');

        await expect(initEngine()).rejects.toThrow('No AI backend available');
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('initializes native engine if resolved to native', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockResolvedValue(undefined);

        await initEngine();

        expect(mocks.initNativeEngine).toHaveBeenCalledTimes(1);
        expect(llmStatusStore.value).toEqual({ state: 'ready', modelId: 'native' });
    });

    it('falls back to WebLLM if native fails and WebGPU is available', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true }); // simulate WebGPU
        mocks.initWebLlmEngine.mockResolvedValue(undefined);

        await initEngine();

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Native AI backend failed'));
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Falling back to WebLLM'));
        expect(mocks.initWebLlmEngine).toHaveBeenCalledTimes(1);
    });

    it('falls back to Cloud if native fails and cloud is available (no WebGPU)', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        mocks.isCloudAvailable.mockReturnValue(true);

        await initEngine();

        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Falling back to cloud'));
        expect(llmStatusStore.value).toEqual({ state: 'ready', modelId: 'claude' });
    });

    it('falls back to Cloud when native fails, WebGPU is present, but WebLLM also fails', async () => {
        // Regression: previously the WebLLM init was awaited unguarded inside the
        // native-failure handler. With WebGPU present, a WebLLM init failure threw
        // past the cloud branch, so a configured cloud key was never tried.
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        mocks.initWebLlmEngine.mockRejectedValue(new Error('WebLLM failed'));
        mocks.isCloudAvailable.mockReturnValue(true);

        await initEngine();

        expect(mocks.initWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('WebLLM fallback failed'));
        expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Falling back to cloud'));
        expect(llmStatusStore.value).toEqual({ state: 'ready', modelId: 'claude' });
    });

    it('throws when native fails, WebGPU is present, WebLLM fails, and cloud is unavailable', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        mocks.initWebLlmEngine.mockRejectedValue(new Error('WebLLM failed'));
        mocks.isCloudAvailable.mockReturnValue(false);

        await expect(initEngine()).rejects.toThrow('Native AI engine failed');
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('throws if native fails and there are no fallbacks', async () => {
        mocks.resolveBackend.mockReturnValue('native');
        mocks.initNativeEngine.mockRejectedValue(new Error('Boom'));
        mocks.isCloudAvailable.mockReturnValue(false);

        await expect(initEngine()).rejects.toThrow('Native AI engine failed');
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('initializes cloud directly if resolved to cloud', async () => {
        mocks.resolveBackend.mockReturnValue('cloud');

        await initEngine();

        expect(llmStatusStore.value).toEqual({ state: 'ready', modelId: 'claude' });
        expect(mocks.initNativeEngine).not.toHaveBeenCalled();
        expect(mocks.initWebLlmEngine).not.toHaveBeenCalled();
    });

    it('initializes WebLLM if resolved to webllm', async () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        mocks.initWebLlmEngine.mockResolvedValue(undefined);

        await initEngine('model-x');

        expect(mocks.initWebLlmEngine).toHaveBeenCalledWith('model-x');
    });
});
