import { describe, it, expect, vi, beforeEach } from 'vitest';

import { aiBackendPreferenceStore } from '../../../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../../../stores/llmStatusStore';
import { setAiBackendPreference } from '../../backendResolution/setAiBackendPreference';
import { initEngine } from '../initEngine';

const mocks = vi.hoisted(() => ({
    backendChain: { value: Array<'native' | 'webllm' | 'cloud'>() },
    initNativeEngine: vi.fn<(options?: { signal?: AbortSignal }) => Promise<void>>(),
    initWebLlmEngine:
        vi.fn<(modelId?: string, options?: { downloadConsent?: boolean; signal?: AbortSignal }) => Promise<void>>(),
    getActiveModelId: vi.fn<() => string>(() => 'browser-model'),
    warn: vi.fn<(msg: string) => void>(),
}));

vi.mock('../../backendResolution/getBackendChain', () => ({
    getBackendChain: () => mocks.backendChain.value,
}));

vi.mock('../../../../repositories/nativeEngine/initNativeEngine', () => ({
    initNativeEngine: mocks.initNativeEngine,
}));

vi.mock('../../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('../../../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: mocks.getActiveModelId,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn },
}));

function noop(): void {}

describe('initEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        aiBackendPreferenceStore.set('auto');
        llmStatusStore.set({ state: 'idle' });
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    it('throws if no backend is available', async () => {
        await expect(initEngine()).rejects.toThrow('No AI backend available');
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('initializes native engine if resolved to native', async () => {
        mocks.backendChain.value = ['native'];
        mocks.initNativeEngine.mockResolvedValue(undefined);

        const backend = await initEngine();

        expect(mocks.initNativeEngine).toHaveBeenCalledTimes(1);
        expect(backend).toBe('native');
        expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'native', modelId: 'native' });
    });

    it('falls back to WebLLM if native fails and WebGPU is available', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true }); // simulate WebGPU
        mocks.initWebLlmEngine.mockResolvedValue(undefined);

        const backend = await initEngine();

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('native backend failed'));
        expect(mocks.initWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(backend).toBe('webllm');
    });

    it('falls back to Cloud if native fails and cloud is available (no WebGPU)', async () => {
        mocks.backendChain.value = ['native', 'cloud'];
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));

        const backend = await initEngine();

        expect(backend).toBe('cloud');
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('falls back to Cloud when native fails, WebGPU is present, but WebLLM also fails', async () => {
        // Regression: previously the WebLLM init was awaited unguarded inside the
        // native-failure handler. With WebGPU present, a WebLLM init failure threw
        // past the cloud branch, so a configured cloud key was never tried.
        mocks.backendChain.value = ['native', 'webllm', 'cloud'];
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        mocks.initWebLlmEngine.mockRejectedValue(new Error('WebLLM failed'));

        const backend = await initEngine();

        expect(mocks.initWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('webllm backend failed'));
        expect(backend).toBe('cloud');
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('throws when native fails, WebGPU is present, WebLLM fails, and cloud is unavailable', async () => {
        mocks.backendChain.value = ['native', 'webllm'];
        mocks.initNativeEngine.mockRejectedValue(new Error('Native failed'));
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        mocks.initWebLlmEngine.mockRejectedValue(new Error('WebLLM failed'));

        await expect(initEngine()).rejects.toThrow('AI engine failed to load');
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('does not fall through when an explicitly selected native backend fails', async () => {
        mocks.backendChain.value = ['native'];
        mocks.initNativeEngine.mockRejectedValue(new Error('Boom'));

        await expect(initEngine()).rejects.toThrow('AI engine failed to load: Boom');
        expect(mocks.initWebLlmEngine).not.toHaveBeenCalled();
        expect(llmStatusStore.value?.state).toBe('error');
    });

    it('initializes cloud directly if resolved to cloud', async () => {
        mocks.backendChain.value = ['cloud'];

        await initEngine();

        expect(llmStatusStore.value).toEqual({ state: 'idle' });
        expect(mocks.initNativeEngine).not.toHaveBeenCalled();
        expect(mocks.initWebLlmEngine).not.toHaveBeenCalled();
    });

    it('initializes WebLLM if resolved to webllm', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.initWebLlmEngine.mockResolvedValue(undefined);

        await initEngine('model-x', { webLlmDownloadConsent: true });

        expect(mocks.initWebLlmEngine).toHaveBeenCalledWith('model-x', {
            downloadConsent: true,
            signal: expect.any(AbortSignal),
        });
    });

    it('does not force a cloud fallback when the explicit WebLLM backend rejects admission', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.initWebLlmEngine.mockRejectedValue(new Error('Explicit model-download consent is required'));

        await expect(initEngine()).rejects.toThrow(
            'AI engine failed to load: Explicit model-download consent is required'
        );

        expect(mocks.initWebLlmEngine).toHaveBeenCalledTimes(1);
        expect(llmStatusStore.value).toEqual({
            state: 'error',
            message: 'AI engine failed to load: Explicit model-download consent is required',
        });
    });

    it('does not publish native readiness after the backend changes during initialization', async () => {
        let resolveNative: () => void = noop;
        mocks.backendChain.value = ['native'];
        mocks.initNativeEngine.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveNative = resolve;
                })
        );

        const pending = initEngine();
        const options = mocks.initNativeEngine.mock.calls[0]?.[0];
        expect(llmStatusStore.value?.state).toBe('loading');

        setAiBackendPreference('webllm');
        resolveNative();
        await pending;

        expect(options?.signal?.aborted).toBe(true);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });

    it('aborts WebLLM status commits after the backend changes during initialization', async () => {
        let resolveWebLlm: () => void = noop;
        mocks.backendChain.value = ['webllm'];
        mocks.initWebLlmEngine.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveWebLlm = resolve;
                })
        );

        const pending = initEngine();
        const options = mocks.initWebLlmEngine.mock.calls[0]?.[1];
        expect(options?.signal?.aborted).toBe(false);

        setAiBackendPreference('cloud');
        resolveWebLlm();
        await pending;

        expect(options?.signal?.aborted).toBe(true);
        expect(llmStatusStore.value).toEqual({ state: 'idle' });
    });
});
