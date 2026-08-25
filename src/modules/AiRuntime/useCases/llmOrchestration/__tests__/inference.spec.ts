import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolSchema } from '../../../models/ToolDefinitions';
import { generateToolPlanningOutcome } from '../inference';

const mocks = vi.hoisted(() => ({
    backendChain: { value: [] as ('cloud' | 'webllm')[] },
    failRemoteDisclosure: { value: false },
    generateCloudToolCalls: vi.fn(),
    generateWebLlmToolCalls: vi.fn(),
    getCloudProviderInfo: vi.fn(),
    initWebLlmEngine: vi.fn(),
    isWebLlmLoaded: vi.fn(),
    llmStatus: { value: { state: 'idle' } },
    llmStatusSet: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    providerStartFailure: { value: null as 'openai' | 'webllm' | null },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: () => mocks.backendChain.value,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/generateCloudToolCalls', () => ({
    generateCloudToolCalls: mocks.generateCloudToolCalls,
}));

vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
}));

vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: mocks.isWebLlmLoaded,
}));

vi.mock('../../../repositories/webLlm/toolCalling', () => ({
    generateWebLlmToolCalls: mocks.generateWebLlmToolCalls,
}));

vi.mock('../../../stores/llmStatusStore', () => ({
    llmStatusStore: {
        get value() {
            return mocks.llmStatus.value;
        },
        set: mocks.llmStatusSet,
    },
}));

vi.mock('../../discloseRemoteTransmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../discloseRemoteTransmission')>();
    return {
        remoteTransmissionDisclosure: {
            ...actual.remoteTransmissionDisclosure,
            publish: (input: Parameters<typeof actual.remoteTransmissionDisclosure.publish>[0]) =>
                mocks.failRemoteDisclosure.value ? false : actual.remoteTransmissionDisclosure.publish(input),
        },
    };
});

vi.mock('../../modelProviderProtocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../modelProviderProtocol')>();
    return {
        createModelProviderProtocol: (input: Parameters<typeof actual.createModelProviderProtocol>[0]) => {
            const protocol = actual.createModelProviderProtocol(input);
            return {
                ...protocol,
                start: (request: Parameters<typeof protocol.start>[0]) => {
                    if (mocks.providerStartFailure.value === input.provider) {
                        mocks.providerStartFailure.value = null;
                        throw new Error('Provider session could not start.');
                    }
                    return protocol.start(request);
                },
            };
        },
    };
});

const toolSchemas: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'muteTrack',
            description: 'Mute one track.',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    muted: { type: 'boolean' },
                    trackId: { type: 'string' },
                },
                required: ['trackId', 'muted'],
            },
        },
    },
];

describe('generateToolPlanningOutcome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.failRemoteDisclosure.value = false;
        mocks.getCloudProviderInfo.mockReturnValue({ provider: 'openai', model: 'hosted-model' });
        mocks.isWebLlmLoaded.mockReturnValue(true);
        mocks.providerStartFailure.value = null;
    });

    it('dispatches a hosted provider through the provider-neutral tool protocol', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue([
            { id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
        ]);

        await expect(generateToolPlanningOutcome('system', 'mute the first track', toolSchemas)).resolves.toMatchObject(
            {
                status: 'complete',
                toolCalls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            }
        );
        expect(mocks.generateCloudToolCalls).toHaveBeenCalledOnce();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'cloud',
            modelId: 'hosted-model',
        });
    });

    it('initializes and dispatches WebLLM through the same normalized outcome', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.isWebLlmLoaded.mockReturnValue(false);
        mocks.initWebLlmEngine.mockResolvedValue(undefined);
        mocks.generateWebLlmToolCalls.mockResolvedValue({
            status: 'complete',
            toolCalls: [{ id: 'browser-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
        });

        await expect(generateToolPlanningOutcome('system', 'mute the first track', toolSchemas)).resolves.toMatchObject(
            {
                status: 'complete',
                toolCalls: [{ id: 'browser-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            }
        );
        expect(mocks.initWebLlmEngine).toHaveBeenCalledOnce();
        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledOnce();
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'webllm',
            modelId: 'Qwen3-4B-q4f16_1-MLC',
        });
    });

    it.each(['disclosure-publication', 'provider-start'] as const)(
        'terminalizes an admitted pre-session %s failure before falling back',
        async (failurePoint) => {
            mocks.backendChain.value = ['cloud', 'webllm'];
            mocks.failRemoteDisclosure.value = failurePoint === 'disclosure-publication';
            mocks.providerStartFailure.value = failurePoint === 'provider-start' ? 'openai' : null;
            mocks.generateWebLlmToolCalls.mockResolvedValue({
                status: 'complete',
                toolCalls: [{ id: 'browser-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            });
            const onProviderAttempt = vi.fn(() => ({ status: 'admitted' as const }));
            const onProviderResult = vi.fn();

            await expect(
                generateToolPlanningOutcome(
                    'system',
                    'mute the first track',
                    toolSchemas,
                    undefined,
                    'mute the first track',
                    onProviderResult,
                    { runId: 'run-1', requestId: 'request-1', cancellationGeneration: 0 },
                    onProviderAttempt
                )
            ).resolves.toMatchObject({ status: 'complete' });

            expect(onProviderAttempt).toHaveBeenCalledTimes(2);
            expect(onProviderResult).toHaveBeenCalledTimes(2);
            expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
                provider: 'openai',
                status: 'failed',
                usage: { provenance: 'unavailable' },
                failure: { code: 'provider-attempt-failed', retryable: true },
            });
            expect(onProviderResult.mock.calls[1]?.[0]).toMatchObject({
                provider: 'webllm',
                status: 'complete',
            });
        }
    );
});
