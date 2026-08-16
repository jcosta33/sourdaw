import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    backendChain: { value: ['cloud'] as Array<'cloud' | 'webllm' | 'native'> },
    calls: [] as string[],
    generateCloudToolCalls: vi.fn(async () => []),
    generateWebLlmToolCalls: vi.fn(async () => ({ status: 'complete' as const, toolCalls: [] })),
    notifyAiChange: vi.fn(),
}));

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: () => mocks.backendChain.value,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: async (...args: Parameters<typeof mocks.generateCloudToolCalls>) => {
        mocks.calls.push('cloud-invoke');
        return mocks.generateCloudToolCalls(...args);
    },
}));

vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/webLlm/toolCalling', () => ({
    generateWebLlmToolCalls: async (...args: Parameters<typeof mocks.generateWebLlmToolCalls>) => {
        mocks.calls.push('webllm-invoke');
        return mocks.generateWebLlmToolCalls(...args);
    },
}));
vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({ initWebLlmEngine: vi.fn() }));
vi.mock('../../../repositories/nativeModelProviderAdapter', () => ({ runNativeModelProviderRequest: vi.fn() }));
vi.mock('../../notifyAiChange', () => ({
    notifyAiChange: (...args: Parameters<typeof mocks.notifyAiChange>) => {
        mocks.calls.push('disclosure');
        mocks.notifyAiChange(...args);
    },
}));

import { generateToolPlanningOutcome } from '../inference';

describe('tool-planning remote data disclosure', () => {
    afterEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = ['cloud'];
        mocks.calls.length = 0;
    });

    it('publishes a cloud disclosure before the actual cloud tool-planning invoke', async () => {
        await generateToolPlanningOutcome('system', 'user', []);

        expect(mocks.notifyAiChange).toHaveBeenCalledOnce();
        expect(mocks.calls).toEqual(['disclosure', 'cloud-invoke']);
    });

    it('does not publish a cloud disclosure when WebLLM completes before a cloud fallback', async () => {
        mocks.backendChain.value = ['webllm', 'cloud'];

        await generateToolPlanningOutcome('system', 'user', []);

        expect(mocks.calls).toEqual(['webllm-invoke']);
        expect(mocks.generateCloudToolCalls).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });
});
