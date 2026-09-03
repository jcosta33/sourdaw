import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { isModelProviderFailureError } from '../../../errors/ModelProviderFailureError';
import { TOOL_PLAN_MAX_OUTPUT_TOKENS } from '../../../models/HostedToolPlanLimits';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../../../models/WorkflowCapability';
import { getPlanningProviderSchemaContract } from '../../planningProviderSchema';
import { generateToolPlanningOutcome, type ProviderAttemptAdmission } from '../inference';

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

function toolSchema(name: string, description?: string): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description: description ?? `${name} tool.`,
            parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        },
    };
}

describe('generateToolPlanningOutcome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendChain.value = [];
        mocks.failRemoteDisclosure.value = false;
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'openai',
            model: 'hosted-model',
            baseUrl: 'https://api.openai.com/v1',
            authentication: 'api-key',
        });
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

    it('admits the compiled request with the single-sourced output budget and wires it to the provider call', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue([
            { id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
        ]);
        const onProviderAttempt = vi.fn((_input: ProviderAttemptAdmission) => ({ status: 'admitted' as const }));

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                undefined,
                undefined,
                onProviderAttempt
            )
        ).resolves.toMatchObject({ status: 'complete' });

        expect(onProviderAttempt).toHaveBeenCalledOnce();
        const admission = onProviderAttempt.mock.calls[0]?.[0];
        expect(admission?.request.limits).toEqual({ maxOutputTokens: TOOL_PLAN_MAX_OUTPUT_TOKENS });
        expect(admission?.request.budget).toEqual({
            maxInputTokens: 32_768,
            maxOutputTokens: TOOL_PLAN_MAX_OUTPUT_TOKENS,
            maxTotalTokens: 32_768 + TOOL_PLAN_MAX_OUTPUT_TOKENS,
        });
        expect(admission?.estimate.outputTokenCeiling).toBe(TOOL_PLAN_MAX_OUTPUT_TOKENS);

        // The wire request must derive `max_tokens` from what was admitted above, not from a
        // constant of its own — otherwise the two are free to drift apart.
        expect(mocks.generateCloudToolCalls).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            TOOL_PLAN_MAX_OUTPUT_TOKENS
        );
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

    it('keeps the five application tools available to WebLLM under 30-tool selection pressure', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });
        // 120 competing tools whose names and descriptions match the "plan a command" prompt.
        // Decline is excluded because it scores 101 against 102 for each competitor; last position
        // is only the tiebreak backstop, and decline cannot reach it when not mandatory.
        const competingTools = Array.from({ length: 120 }, (_, index) =>
            toolSchema(`planAction${String(index)}`, 'plan a command')
        );
        const schemas = [
            toolSchema('project.query'),
            toolSchema('command.batch.propose'),
            toolSchema('agent.command-index.search'),
            toolSchema('agent.catalog.discover'),
            ...competingTools,
            toolSchema('command.batch.decline'),
        ];

        await expect(generateToolPlanningOutcome('system', 'plan a command', schemas)).resolves.toMatchObject({
            status: 'complete',
        });

        const advertisedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? [];
        expect(advertisedTools).toHaveLength(30);
        expect(advertisedTools.map((tool: ToolSchema) => tool.function.name)).toEqual(
            expect.arrayContaining([
                'project.query',
                'command.batch.propose',
                'command.batch.decline',
                'agent.command-index.search',
                'agent.catalog.discover',
            ])
        );
    });

    it('advertises the production planning contract to WebLLM at the 30-tool cap', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });

        // Build the exact schema list parsePromptToActions.ts assembles: the planning provider
        // contract (12 schemas: 11 agent-catalog tools + selectWorkflowCapability) plus the
        // deduplicated workflow action tool schemas (23), for 35 total.
        const planningContract = getPlanningProviderSchemaContract().schemas;
        const executableSchemas = getExecutableAppActionToolSchemas();
        const specializedWorkflowToolSchemas: readonly ToolSchema[] = [
            toolSchema('automateTrackGainRange', 'Automate track gain over a named section range'),
            toolSchema('automateSendRange', 'Automate send reduction over a named section range'),
        ];
        const workflowToolSchemas = [
            ...DAW_TOOL_SCHEMAS.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
            ...executableSchemas.filter((tool) => WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)),
            ...specializedWorkflowToolSchemas,
        ];
        const uniqueWorkflowToolSchemas = Array.from(
            new Map(workflowToolSchemas.map((tool) => [tool.function.name, tool])).values()
        );
        const schemas = [...planningContract, ...uniqueWorkflowToolSchemas];

        // Precondition: this must stay production-shaped (12 contract schemas + 23 workflow action
        // schemas). If it drifts, the case below is no longer testing what parsePromptToActions.ts
        // actually sends.
        expect(schemas).toHaveLength(35);

        await expect(generateToolPlanningOutcome('system', 'plan a command', schemas)).resolves.toMatchObject({
            status: 'complete',
        });

        const advertisedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? [];
        const advertisedNames = advertisedTools.map((tool: ToolSchema) => tool.function.name);

        // The mandatory set is 29 of the 30-tool cap (selectWorkflowCapability + the 5 application
        // tools + the 23 workflow action tools), so exactly one free slot remains for the
        // highest-ranked non-mandatory catalog tool.
        expect(advertisedNames).toEqual([
            'selectWorkflowCapability',
            'project.query',
            'agent.catalog.discover',
            'agent.command-index.search',
            'command.batch.propose',
            'command.batch.decline',
            'removeTrack',
            'muteTrack',
            'soloTrack',
            'setTrackGain',
            'setTrackPan',
            'addDevice',
            'setDeviceParameter',
            'removeDevice',
            'arpeggiate',
            'createBus',
            'addSend',
            'setTrackOutput',
            'addSidechainRoute',
            'removeSidechainRoute',
            'importStemSet',
            'removeShortMidiOverlaps',
            'createDrumPreviewBranches',
            'copyMidiArticulations',
            'addAdjustmentRegion',
            'automateSendRange',
            'automateTrackGainRange',
            'automateSendRanges',
            'renderProjectSections',
            'project.resolve',
        ]);
        // The free slot goes to the first non-mandatory catalog tool; agent.capabilities is not it.
        expect(advertisedNames).not.toContain('agent.capabilities');
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

    it.each([
        {
            status: 401,
            messageFragment: 'API key',
            retryable: false,
        },
        {
            status: 429,
            messageFragment: 'rate limited',
            retryable: true,
        },
    ] as const)(
        'surfaces hosted HTTP $status on cloud tool-planning failure',
        async ({ status, messageFragment, retryable }) => {
            mocks.backendChain.value = ['cloud'];
            mocks.generateCloudToolCalls.mockRejectedValue(
                new HostedAiHttpStatusError(status, `Hosted AI tool request failed with status ${String(status)}`)
            );

            const error = await generateToolPlanningOutcome('system', 'mute the first track', toolSchemas).catch(
                (error: unknown) => error
            );

            expect(isModelProviderFailureError(error)).toBe(true);
            if (!isModelProviderFailureError(error)) {
                return;
            }
            expect(error.message).toContain(`HTTP ${String(status)}`);
            expect(error.message).toContain(messageFragment);
            expect(error.message).not.toBe('The model provider request failed.');
            expect(error.retryable).toBe(retryable);
            expect(error.code).toBe(`hosted-http-${String(status)}`);
            expect(mocks.logger.warn).toHaveBeenCalledWith(
                expect.stringContaining(`[AI Engine] Backend "cloud" failed:`)
            );
            expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining(`HTTP ${String(status)}`));
        }
    );

    it('snapshots hosted HTTP status once so spoofed getters cannot leak secrets into safeMessage', async () => {
        mocks.backendChain.value = ['cloud'];
        let statusReadCount = 0;
        const spoofedError = new Error('ignored');
        spoofedError.name = 'HostedAiHttpStatusError';
        Object.defineProperty(spoofedError, 'status', {
            get() {
                statusReadCount += 1;
                return statusReadCount === 1 ? 401 : 'key=sk-secret';
            },
            configurable: true,
        });
        mocks.generateCloudToolCalls.mockRejectedValue(spoofedError);

        const error = await generateToolPlanningOutcome('system', 'mute the first track', toolSchemas).catch(
            (error: unknown) => error
        );

        expect(isModelProviderFailureError(error)).toBe(true);
        if (!isModelProviderFailureError(error)) {
            return;
        }
        expect(error.message).toContain('HTTP 401');
        expect(error.message).not.toContain('sk-secret');
        expect(error.code).toBe('hosted-http-401');
        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.not.stringContaining('sk-secret'));
    });
});
