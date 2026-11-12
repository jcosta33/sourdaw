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
        isWebGpuAvailable: vi.fn(),
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

vi.mock('#/modules/BrowserAi/stores', () => ({
    isWebGpuAvailable: mocks.isWebGpuAvailable,
}));

// A ready hosted runtime moves the hosted candidate to the front of the automatic order; Automatic
// still drops it, so nothing the Prompt Bar or the chat plans under Automatic reaches a hosted provider.
describe('getBackendChain under Automatic with a ready hosted runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.admission.webLlm = true;
        mocks.preference.value = 'auto';
        mocks.runtimeStatus.value = { state: 'ready', backend: 'cloud', modelId: 'hosted-model' };
        mocks.isCloudAvailable.mockReturnValue(true);
    });

    it.each([
        { name: 'without WebGPU', webGpu: false, expected: [] },
        { name: 'beside verified WebGPU', webGpu: true, expected: ['webllm'] },
    ])('keeps a configured, ready hosted provider out of an automatic tool chain $name', ({ webGpu, expected }) => {
        mocks.isWebGpuAvailable.mockReturnValue(webGpu);
        Object.defineProperty(globalThis, 'navigator', {
            value: webGpu ? { gpu: {} } : {},
            configurable: true,
            writable: true,
        });

        expect(getBackendChain({ operation: 'tools', modality: 'text', streaming: false })).toEqual(expected);
    });
});
