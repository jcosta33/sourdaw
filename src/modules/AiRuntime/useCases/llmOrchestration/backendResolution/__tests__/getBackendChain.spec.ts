import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBackendChain } from '../getBackendChain';

const mocks = vi.hoisted(() => {
    const preference: { value: 'auto' | 'webllm' | 'cloud' } = { value: 'auto' };
    const runtimeStatus: {
        value: { state: 'idle' } | { state: 'ready'; backend: 'webllm' | 'cloud'; modelId: string };
    } = { value: { state: 'idle' } };
    return {
        isCloudAvailable: vi.fn(),
        preference,
        runtimeStatus,
    };
});

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => null,
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

describe('getBackendChain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preference.value = 'auto';
        mocks.runtimeStatus.value = { state: 'idle' };
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    it('does not silently choose a hosted provider in automatic mode without WebGPU', () => {
        expect(getBackendChain()).toEqual([]);
    });

    it('does not expose the withheld browser model when WebGPU is available', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual([]);
    });

    it('does not fall back to a hosted provider for explicit browser-local selection', () => {
        mocks.preference.value = 'webllm';

        expect(getBackendChain()).toEqual([]);
    });

    it('uses a hosted provider only after explicit selection', () => {
        mocks.preference.value = 'cloud';

        expect(getBackendChain()).toEqual(['cloud']);
    });
});
