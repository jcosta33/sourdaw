import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveBackend } from '../helpers';

const mocks = vi.hoisted(() => {
    const preference: { value: 'auto' | 'native' | 'webllm' | 'cloud' } = { value: 'auto' };
    const runtimeStatus: {
        value: { state: 'idle' } | { state: 'ready'; backend: 'native' | 'webllm' | 'cloud'; modelId: string };
    } = {
        value: { state: 'idle' },
    };
    return {
        isCloudAvailable: vi.fn<() => boolean>(),
        isNativeAiRuntimeAvailable: vi.fn<() => boolean>(),
        preference,
        runtimeStatus,
    };
});

vi.mock('../isNativeAiRuntimeAvailable', () => ({
    isNativeAiRuntimeAvailable: mocks.isNativeAiRuntimeAvailable,
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('#/modules/AiRuntime/stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.preference,
}));

vi.mock('#/modules/AiRuntime/stores/llmStatusStore', () => ({
    llmStatusStore: mocks.runtimeStatus,
}));

describe('backendResolution helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preference.value = 'auto';
        mocks.runtimeStatus.value = { state: 'idle' };
        // Reset navigator.gpu for tests
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    describe('resolveBackend', () => {
        it('returns native if running in Tauri', () => {
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
            expect(resolveBackend()).toBe('native');
        });

        it('returns webllm if WebGPU is available and not in Tauri', () => {
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(false);
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });

            expect(resolveBackend()).toBe('webllm');
        });

        it('does not export an automatic request when only cloud is available', () => {
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(false);
            mocks.isCloudAvailable.mockReturnValue(true);

            expect(resolveBackend()).toBe('none');
        });

        it('returns none if no backend is available', () => {
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(false);
            mocks.isCloudAvailable.mockReturnValue(false);

            expect(resolveBackend()).toBe('none');
        });

        it('honors an explicit hosted preference when local backends are available', () => {
            mocks.preference.value = 'cloud';
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
            mocks.isCloudAvailable.mockReturnValue(true);
            Object.defineProperty(globalThis, 'navigator', {
                value: { gpu: {} },
                configurable: true,
                writable: true,
            });

            expect(resolveBackend()).toBe('cloud');
        });

        it('ignores a ready cloud backend in automatic local mode', () => {
            mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
            mocks.isCloudAvailable.mockReturnValue(true);
            mocks.runtimeStatus.value = {
                state: 'ready',
                backend: 'cloud',
                modelId: 'hosted-model',
            };

            expect(resolveBackend()).toBe('native');
        });
    });
});
