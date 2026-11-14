import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type AiBackendPreference } from '../../models/LlmOrchestrationTypes';
import { type ModelProviderRequestInput } from '../../models/ModelProviderProtocol';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { configureAgentResourceLimits } from '../configureAgentResourceLimits';
import { streamHostedModelText } from '../streamHostedModelText';

const mocks = vi.hoisted(() => ({
    streamCloudChatCompletion: vi.fn(),
    getCloudProviderInfo: vi.fn(() => ({ provider: 'anthropic' as const, model: 'hosted-model' })),
    compileRequest: vi.fn((_input: ModelProviderRequestInput) => undefined),
    isCloudAvailable: vi.fn(() => true),
    isWebGpuAvailable: vi.fn(() => true),
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: { webLlm: true },
}));

vi.mock('#/modules/BrowserAi/stores', () => ({
    isWebGpuAvailable: mocks.isWebGpuAvailable,
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../modelProviderProtocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../modelProviderProtocol')>();
    return {
        ...actual,
        createModelProviderProtocol: (input: Parameters<typeof actual.createModelProviderProtocol>[0]) => {
            const protocol = actual.createModelProviderProtocol(input);
            return {
                ...protocol,
                compileRequest: (request: ModelProviderRequestInput) => {
                    mocks.compileRequest(request);
                    return protocol.compileRequest(request);
                },
            };
        },
    };
});

beforeEach(() => {
    mocks.streamCloudChatCompletion.mockReset();
    mocks.isCloudAvailable.mockReturnValue(true);
    aiBackendPreferenceStore.set('cloud');
});

afterEach(() => {
    aiBackendPreferenceStore.set('auto');
});

describe('streamHostedModelText backend admission', () => {
    it.each<AiBackendPreference>(['auto', 'webllm'])(
        'sends nothing to a configured hosted provider while the backend preference is %s',
        async (preference) => {
            aiBackendPreferenceStore.set(preference);
            mocks.streamCloudChatCompletion.mockResolvedValue({ status: 'complete' as const });
            const onToken = vi.fn();

            const result = await streamHostedModelText({
                correlationId: `hosted-refused-${preference}`,
                messages: [{ role: 'user', content: 'Track: Lead vocal' }],
                maxOutputTokens: 1_000,
                onToken,
            });

            expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
            expect(onToken).not.toHaveBeenCalled();
            expect(result.status).toBe('unavailable');
            expect(result.failure?.code).toBe('hosted-provider-not-selected');
            expect(result.remoteDisclosure).toBeUndefined();
        }
    );

    it('sends the request to the hosted provider once the user selects it', async () => {
        mocks.streamCloudChatCompletion.mockResolvedValue({ status: 'complete' as const });

        const result = await streamHostedModelText({
            correlationId: 'hosted-selected',
            messages: [{ role: 'user', content: 'Track: Lead vocal' }],
            maxOutputTokens: 1_000,
            onToken: vi.fn(),
        });

        expect(mocks.streamCloudChatCompletion).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('complete');
    });

    it('sends nothing when the hosted provider is selected but unavailable', async () => {
        mocks.isCloudAvailable.mockReturnValue(false);

        const result = await streamHostedModelText({
            correlationId: 'hosted-selected-unavailable',
            messages: [{ role: 'user', content: 'Track: Lead vocal' }],
            maxOutputTokens: 1_000,
            onToken: vi.fn(),
        });

        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
        expect(result.status).toBe('unavailable');
    });
});

describe('streamHostedModelText', () => {
    it('returns one neutral result for hosted text, usage, and unknown events', async () => {
        const onToken = vi.fn();
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, emitToken, options) => {
            emitToken('Analysis');
            options?.onUsage?.({
                type: 'usage',
                mode: 'final',
                usage: { inputTokens: 5, outputTokens: 2, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            });
            options?.onUnknownEvent?.('anthropic:future_event');
            return { status: 'complete' as const };
        });

        const result = await streamHostedModelText({
            correlationId: 'mix-health-1',
            messages: [{ role: 'user', content: 'Analyze the mix.' }],
            maxOutputTokens: 1_000,
            onToken,
        });

        expect(result.correlationId).toBe('mix-health-1');
        expect(result.output.text).toBe('Analysis');
        expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, provenance: 'provider-reported' });
        expect(result.ignoredProviderEvents).toEqual(['anthropic:future_event']);
        expect(result.remoteDisclosure).toEqual({
            requestId: 'mix-health-1',
            categories: [
                'system-instructions',
                'prompt-text',
                'project-context',
                'metadata',
                'midi',
                'lyrics',
                'filename',
                'preset',
            ],
            retention: {
                applicationState: 'unknown',
                abuseMonitoring: 'unknown',
                promptCache: 'unknown',
                safetyLegalException: 'unknown',
                unknown: 'unknown',
            },
        });
    });

    it('preserves Anthropic cached-input detail when sparse final usage arrives', async () => {
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, _emitToken, options) => {
            options?.onUsage?.({
                type: 'usage',
                mode: 'cumulative-snapshot',
                usage: {
                    inputTokens: 17,
                    outputTokens: 0,
                    cachedInputTokens: 2,
                    cacheWriteInputTokens: 3,
                    reasoningTokens: null,
                },
                provenance: 'provider-reported',
            });
            options?.onUsage?.({
                type: 'usage',
                mode: 'final',
                usage: {
                    inputTokens: null,
                    outputTokens: 4,
                    cachedInputTokens: null,
                    reasoningTokens: null,
                },
                provenance: 'provider-reported',
            });
            return { status: 'complete' as const };
        });

        const result = await streamHostedModelText({
            correlationId: 'mix-health-cache',
            messages: [{ role: 'user', content: 'Analyze the mix.' }],
            maxOutputTokens: 1_000,
            onToken: vi.fn(),
        });

        expect(result.usage).toMatchObject({
            inputTokens: 17,
            outputTokens: 4,
            cachedInputTokens: 2,
            cacheWriteInputTokens: 3,
            provenance: 'provider-reported',
        });
    });
});

describe('streamHostedModelText output ceiling', () => {
    afterEach(() => {
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    async function compileHostedRequest(): Promise<{
        limitsMaxOutputTokens: number;
        budgetMaxOutputTokens: number;
        maxTotalTokens: number;
    }> {
        mocks.compileRequest.mockClear();
        mocks.streamCloudChatCompletion.mockImplementation(async () => ({ status: 'complete' as const }));
        await streamHostedModelText({
            correlationId: `hosted-ceiling-${crypto.randomUUID()}`,
            messages: [{ role: 'user', content: 'Analyze the mix.' }],
            maxOutputTokens: 2_048,
            onToken: vi.fn(),
        });
        const compiled = mocks.compileRequest.mock.calls[0]?.[0];
        if (compiled === undefined) {
            throw new Error('the hosted route compiled no provider request');
        }
        return {
            limitsMaxOutputTokens: compiled.limits.maxOutputTokens,
            budgetMaxOutputTokens: compiled.budget.maxOutputTokens,
            maxTotalTokens: compiled.budget.maxTotalTokens,
        };
    }

    it('lowers the caller ceiling and the total budget to a smaller configured model ceiling', async () => {
        expect(configureAgentResourceLimits({ maxModelOutputTokens: 256 })).toMatchObject({ status: 'configured' });

        await expect(compileHostedRequest()).resolves.toEqual({
            limitsMaxOutputTokens: 256,
            budgetMaxOutputTokens: 256,
            maxTotalTokens: 33_024,
        });
    });

    it('keeps the caller ceiling when the configured model ceiling is larger', async () => {
        await expect(compileHostedRequest()).resolves.toEqual({
            limitsMaxOutputTokens: 2_048,
            budgetMaxOutputTokens: 2_048,
            maxTotalTokens: 34_816,
        });
    });
});
