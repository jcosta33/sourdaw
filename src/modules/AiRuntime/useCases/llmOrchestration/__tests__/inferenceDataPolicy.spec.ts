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

    it('stops a denied provider attempt before its adapter has any effect', async () => {
        const generateWithAdmission = generateToolPlanningOutcome as unknown as (
            systemPrompt: string,
            userMessage: string,
            toolSchemas: readonly [],
            signal: undefined,
            toolSelectionPrompt: string,
            onProviderResult: undefined,
            streamIdentity: undefined,
            onProviderAttempt: (input: { backend: string; correlationId: string }) => {
                status: 'rejected';
                reason: string;
            }
        ) => ReturnType<typeof generateToolPlanningOutcome>;

        const result = await generateWithAdmission(
            'system',
            'user',
            [],
            undefined,
            'user',
            undefined,
            undefined,
            () => ({ status: 'rejected', reason: 'remoteTokens' })
        );

        expect(result).toEqual({ status: 'rejected', reason: 'remoteTokens' });
        expect(mocks.generateCloudToolCalls).not.toHaveBeenCalled();
    });

    it('admits against the compiled system, context, schema, and output budget before invoking the adapter', async () => {
        const generateWithAdmission = generateToolPlanningOutcome as unknown as (
            systemPrompt: string,
            userMessage: string,
            toolSchemas: ReadonlyArray<{
                function: { name: string; description: string; parameters: Record<string, unknown> };
            }>,
            signal: undefined,
            toolSelectionPrompt: string,
            onProviderResult: undefined,
            streamIdentity: undefined,
            onProviderAttempt: (input: { estimatedTotalTokens: number }) => { status: 'rejected'; reason: string }
        ) => ReturnType<typeof generateToolPlanningOutcome>;
        const result = await generateWithAdmission(
            'system context '.repeat(500),
            'small prompt',
            Array.from({ length: 30 }, (_, index) => ({
                function: { name: `tool-${index}`, description: 'schema '.repeat(100), parameters: { type: 'object' } },
            })),
            undefined,
            'small prompt',
            undefined,
            undefined,
            ({ estimatedTotalTokens }) =>
                estimatedTotalTokens > 1027
                    ? { status: 'rejected', reason: 'remoteTokens' }
                    : { status: 'rejected', reason: 'underestimated' }
        );

        expect(result).toEqual({ status: 'rejected', reason: 'remoteTokens' });
        expect(mocks.generateCloudToolCalls).not.toHaveBeenCalled();
    });
});
