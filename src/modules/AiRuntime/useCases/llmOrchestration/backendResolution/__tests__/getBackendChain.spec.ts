import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBackendChain } from '../getBackendChain';

const mocks = vi.hoisted(() => {
    const admission = { webLlm: true };
    const preference: { value: 'auto' | 'webllm' | 'cloud' } = { value: 'auto' };
    const runtimeStatus: {
        value: { state: 'idle' } | { state: 'ready'; backend: 'webllm' | 'cloud'; modelId: string };
    } = { value: { state: 'idle' } };
    return {
        admission,
        isCloudAvailable: vi.fn(),
        preference,
        runtimeStatus,
    };
});

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: mocks.admission,
}));

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
        mocks.admission.webLlm = true;
        mocks.preference.value = 'auto';
        mocks.runtimeStatus.value = { state: 'idle' };
        mocks.isCloudAvailable.mockReturnValue(true);
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    it('does not silently choose a hosted provider in automatic mode without WebGPU', () => {
        expect(getBackendChain()).toEqual([]);
    });

    it('fails closed for an explicit WebLLM preference without WebGPU', () => {
        mocks.preference.value = 'webllm';

        expect(getBackendChain()).toEqual([]);
    });

    it('fails closed when WebLLM admission is off even if WebGPU is available', () => {
        mocks.admission.webLlm = false;
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual([]);
    });

    it('resolves the local WebLLM route when WebGPU is available', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { gpu: {} },
            configurable: true,
            writable: true,
        });

        expect(getBackendChain()).toEqual(['webllm']);
    });

    it('uses a hosted provider only after explicit selection', () => {
        mocks.preference.value = 'cloud';

        expect(getBackendChain()).toEqual(['cloud']);
    });
});
