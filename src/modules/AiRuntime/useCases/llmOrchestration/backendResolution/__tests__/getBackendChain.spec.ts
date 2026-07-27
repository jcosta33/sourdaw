import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getBackendChain } from '../getBackendChain';

const mocks = vi.hoisted(() => {
    const preference: { value: 'auto' | 'native' | 'webllm' | 'cloud' } = { value: 'auto' };
    const runtimeStatus: {
        value: { state: 'idle' } | { state: 'ready'; backend: 'native' | 'webllm' | 'cloud'; modelId: string };
    } = { value: { state: 'idle' } };
    return {
        isCloudAvailable: vi.fn(),
        isNativeAiRuntimeAvailable: vi.fn(),
        preference,
        runtimeStatus,
    };
});

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../isNativeAiRuntimeAvailable', () => ({
    isNativeAiRuntimeAvailable: mocks.isNativeAiRuntimeAvailable,
}));

vi.mock('#/modules/AiRuntime/stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.preference,
}));

vi.mock('#/modules/AiRuntime/stores/llmStatusStore', () => ({
    llmStatusStore: mocks.runtimeStatus,
}));

describe('getBackendChain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preference.value = 'auto';
        mocks.runtimeStatus.value = { state: 'idle' };
        mocks.isNativeAiRuntimeAvailable.mockReturnValue(false);
        mocks.isCloudAvailable.mockReturnValue(false);
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    it('returns every available backend in automatic fallback order', () => {
        mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual(['native', 'webllm', 'cloud']);
    });

    it('puts an explicitly selected hosted provider first', () => {
        mocks.preference.value = 'cloud';
        mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual(['cloud']);
    });

    it('does not silently fall through when an explicit backend is unavailable', () => {
        mocks.preference.value = 'native';
        mocks.isNativeAiRuntimeAvailable.mockReturnValue(false);
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual([]);
    });

    it('puts the actual ready backend first in automatic mode', () => {
        mocks.runtimeStatus.value = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };
        mocks.isNativeAiRuntimeAvailable.mockReturnValue(true);
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual(['cloud', 'native', 'webllm']);
    });

    it('returns only cloud when no local backend is available', () => {
        mocks.isCloudAvailable.mockReturnValue(true);

        expect(getBackendChain()).toEqual(['cloud']);
    });

    it('returns empty array if no backend is available', () => {
        expect(getBackendChain()).toEqual([]);
    });
});
