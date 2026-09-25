import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { isModelProviderFailureError } from '../../../errors/ModelProviderFailureError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../../models/AgentResourceLimits';
import {
    CREATIVE_INTERPRETATION_TOOL_NAME,
    createCreativeInterpretationToolSchema,
    type CreativeInterpretationCatalog,
} from '../../../models/CreativeInterpretation';
import { TOOL_PLAN_MAX_OUTPUT_TOKENS } from '../../../models/HostedToolPlanLimits';
import { type HostedTurnHistory } from '../../../models/HostedTurnHistory';
import { type ModelProviderResult } from '../../../models/ModelProviderProtocol';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../../../models/WorkflowCapability';
import { generateOpenAiCompatibleToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import {
    AUTO_TOOL_CHOICE,
    type HostedToolChoiceDirective,
} from '../../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import { type OpenAiCompatibleCloudRuntime } from '../../../repositories/cloudLlm/cloudSession';
import { agentResourceLimitsStore } from '../../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { PROJECT_DISCOVERY_TOOL_NAME, RECIPE_DISCOVERY_TOOL_NAME } from '../../agentToolCatalog';
import { configureAgentResourceLimits } from '../../configureAgentResourceLimits';
import { getPlanningProviderToolSchemas } from '../../getPlanningProviderToolSchemas';
import { getProviderRouteView } from '../../getProviderRouteView';
import { getPlanningProviderSchemaContract } from '../../planningProviderSchema';
import { recordAgentProviderUsage } from '../../recordAgentProviderUsage';
import { generateToolPlanningOutcome, WEBLLM_TOOL_BUDGET, type ProviderAttemptAdmission } from '../inference';

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

const compatibleRuntime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'compatible-model',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: false,
};

/** A published catalog in the shape production hands the schema builder. */
const creativeCatalog: CreativeInterpretationCatalog = {
    schemaVersion: 1,
    catalogId: 'creative-catalog-1',
    revision: 'revision-1',
    requestDigest: 'digest-1',
    selection: { trackId: null, clipId: null, clipIds: [], activeView: 'arrange' },
    unresolvedExplicitReferences: [],
    modes: ['edit'],
    targets: [],
    dimensions: [],
    constraints: [],
    creationSlots: [],
};

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
        agentRunLifecycle.clear();
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

    afterEach(() => {
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        vi.unstubAllGlobals();
    });

    it('dispatches a hosted provider through the provider-neutral tool protocol', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: false,
            usage: null,
        });
        const onProviderResult = vi.fn();

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                onProviderResult
            )
        ).resolves.toMatchObject({
            status: 'complete',
            toolCalls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
        });
        expect(mocks.generateCloudToolCalls).toHaveBeenCalledOnce();
        expect(onProviderResult).toHaveBeenCalledWith(
            expect.objectContaining({
                strictToolSchemas: false,
                cacheWriteInputTokens: null,
                usage: expect.objectContaining({ provenance: 'unavailable' }),
            })
        );
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'cloud',
            modelId: 'hosted-model',
        });
    });

    it('reports the provider-reported usage block for a completed hosted tool plan', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'anthropic',
            model: 'hosted-model',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        });
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cacheReadInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
            },
        });
        agentRunLifecycle.create({
            runId: 'run-hosted-usage',
            request: 'mute the first track',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });
        const onProviderResult = vi.fn((result: ModelProviderResult) => {
            recordAgentProviderUsage('run-hosted-usage', result, 'attempt-hosted-usage');
        });

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                onProviderResult
            )
        ).resolves.toMatchObject({ status: 'complete' });

        expect(onProviderResult).toHaveBeenCalledOnce();
        expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
            status: 'complete',
            strictToolSchemas: true,
            cacheWriteInputTokens: 8,
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cachedInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
                provenance: 'provider-reported',
            },
        });
        expect(agentRunLifecycle.get('run-hosted-usage')?.providerUsage[0]).toMatchObject({
            inputTokens: 63,
            outputTokens: 9,
            cachedInputTokens: 5,
            cacheWriteInputTokens: 8,
        });
        expect(getProviderRouteView({ runId: 'run-hosted-usage', candidates: [] })?.cost).toEqual([
            {
                category: 'remoteTokens',
                reserved: 72,
                actual: 72,
                provenance: 'provider-reported',
                final: true,
            },
        ]);
    });

    it('retains billed hosted usage when local admission rejects required tool arguments', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'anthropic',
            model: 'hosted-model',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        });
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: null } }],
            strictToolSchemas: true,
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cacheReadInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
            },
        });
        agentRunLifecycle.create({
            runId: 'run-locally-rejected-hosted-usage',
            request: 'mute the first track',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });
        const onProviderResult = vi.fn((result: ModelProviderResult) => {
            recordAgentProviderUsage('run-locally-rejected-hosted-usage', result, 'attempt-local-rejection');
        });

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                onProviderResult
            )
        ).rejects.toThrow('The model provider request failed.');

        expect(onProviderResult).toHaveBeenCalledOnce();
        expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
            status: 'failed',
            output: { toolCalls: [] },
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cachedInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
                provenance: 'provider-reported',
            },
        });
        expect(agentRunLifecycle.get('run-locally-rejected-hosted-usage')?.providerUsage).toHaveLength(1);
        expect(agentRunLifecycle.get('run-locally-rejected-hosted-usage')?.providerUsage[0]).toMatchObject({
            status: 'failed',
            inputTokens: 63,
            outputTokens: 9,
            cachedInputTokens: 5,
            cacheWriteInputTokens: 8,
        });
        expect(getProviderRouteView({ runId: 'run-locally-rejected-hosted-usage', candidates: [] })?.cost).toEqual([
            {
                category: 'remoteTokens',
                reserved: 72,
                actual: 72,
                provenance: 'provider-reported',
                final: true,
            },
        ]);
    });

    it('retains billed hosted usage once when local admission rejects excess tool calls', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'anthropic',
            model: 'hosted-model',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        });
        expect(configureAgentResourceLimits({ maxProviderToolCalls: 1 })).toMatchObject({ status: 'configured' });
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [
                { id: 'provider-call-1', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
                { id: 'provider-call-2', name: 'muteTrack', arguments: { trackId: 'track-2', muted: false } },
            ],
            strictToolSchemas: true,
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cacheReadInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
            },
        });
        agentRunLifecycle.create({
            runId: 'run-tool-count-rejected-hosted-usage',
            request: 'mute the first track and unmute the second track',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });
        const onProviderResult = vi.fn((result: ModelProviderResult) => {
            recordAgentProviderUsage('run-tool-count-rejected-hosted-usage', result, 'attempt-tool-count-rejection');
        });

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track and unmute the second track',
                toolSchemas,
                undefined,
                'mute the first track and unmute the second track',
                onProviderResult
            )
        ).rejects.toThrow('The model provider request failed.');

        expect(onProviderResult).toHaveBeenCalledOnce();
        expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
            status: 'partial',
            finishReason: 'error',
            failure: { code: 'provider-attempt-failed' },
            output: {
                toolCalls: [
                    { id: 'provider-call-1', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } },
                ],
            },
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cachedInputTokens: 5,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
                provenance: 'provider-reported',
            },
        });
        expect(agentRunLifecycle.get('run-tool-count-rejected-hosted-usage')?.providerUsage).toHaveLength(1);
        expect(agentRunLifecycle.get('run-tool-count-rejected-hosted-usage')?.providerUsage[0]).toMatchObject({
            status: 'partial',
            inputTokens: 63,
            outputTokens: 9,
            cachedInputTokens: 5,
            cacheWriteInputTokens: 8,
        });
        expect(getProviderRouteView({ runId: 'run-tool-count-rejected-hosted-usage', candidates: [] })?.cost).toEqual([
            {
                category: 'remoteTokens',
                reserved: 72,
                actual: 72,
                provenance: 'provider-reported',
                final: true,
            },
        ]);
    });

    it('attributes provider-reported usage from a rejected hosted tool plan to the reported result', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'anthropic',
            model: 'hosted-model',
            baseUrl: 'https://api.anthropic.com',
            authentication: 'api-key',
        });
        mocks.generateCloudToolCalls.mockRejectedValue(
            new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch', {
                inputTokens: 120,
                outputTokens: 8,
                cacheReadInputTokens: 100,
                cacheWriteInputTokens: 7,
                reasoningTokens: 6,
            })
        );
        agentRunLifecycle.create({
            runId: 'run-rejected-hosted-usage',
            request: 'mute the first track',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });
        const onProviderResult = vi.fn((result: ModelProviderResult) => {
            recordAgentProviderUsage('run-rejected-hosted-usage', result, 'attempt-rejected-hosted-usage');
        });

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                onProviderResult
            )
        ).resolves.toMatchObject({ status: 'rejected' });

        expect(onProviderResult).toHaveBeenCalledOnce();
        expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
            status: 'failed',
            finishReason: 'error',
            usage: {
                inputTokens: 120,
                outputTokens: 8,
                cachedInputTokens: 100,
                cacheWriteInputTokens: 7,
                reasoningTokens: 6,
                provenance: 'provider-reported',
            },
        });
        expect(agentRunLifecycle.get('run-rejected-hosted-usage')?.providerUsage).toHaveLength(1);
        expect(agentRunLifecycle.get('run-rejected-hosted-usage')?.providerUsage[0]).toMatchObject({
            status: 'failed',
            inputTokens: 120,
            outputTokens: 8,
            cachedInputTokens: 100,
            cacheWriteInputTokens: 7,
        });
        expect(getProviderRouteView({ runId: 'run-rejected-hosted-usage', candidates: [] })?.cost).toEqual([
            {
                category: 'remoteTokens',
                reserved: 128,
                actual: 128,
                provenance: 'provider-reported',
                final: true,
            },
        ]);
    });

    it('records compatible protocol-rejection usage from the real adapter without compiling a choice', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'openai-compatible',
            model: 'compatible-model',
            baseUrl: 'http://localhost:1234/v1',
            authentication: 'none',
        });
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: 'compatible-request-1',
                        choices: [
                            {
                                finish_reason: 'tool_calls',
                                message: {
                                    tool_calls: [
                                        {
                                            function: {
                                                name: 'muteTrack',
                                                arguments: '{"trackId":"track-1","muted":true}',
                                            },
                                        },
                                    ],
                                },
                            },
                            {
                                finish_reason: 'tool_calls',
                                message: {
                                    tool_calls: [
                                        {
                                            function: {
                                                name: 'muteTrack',
                                                arguments: '{"trackId":"track-2","muted":false}',
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                        usage: { prompt_tokens: 63, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 5 } },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        mocks.generateCloudToolCalls.mockImplementation(
            (
                systemPrompt: string,
                userMessage: string,
                schemas: readonly ToolSchema[],
                maxOutputTokens: number,
                directive: HostedToolChoiceDirective,
                signal?: AbortSignal
            ) =>
                generateOpenAiCompatibleToolCalls({
                    runtime: compatibleRuntime,
                    systemPrompt,
                    userMessage,
                    toolSchemas: schemas,
                    maxOutputTokens,
                    directive,
                    signal,
                })
        );
        agentRunLifecycle.create({
            runId: 'run-compatible-protocol-usage',
            request: 'mute the first track',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });
        const onProviderResult = vi.fn((result: ModelProviderResult) => {
            recordAgentProviderUsage('run-compatible-protocol-usage', result, 'attempt-compatible-protocol-usage');
        });

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                onProviderResult
            )
        ).rejects.toMatchObject({ code: 'provider-attempt-failed', retryable: true });

        expect(mocks.generateCloudToolCalls).toHaveBeenCalledOnce();
        expect(onProviderResult).toHaveBeenCalledOnce();
        expect(onProviderResult.mock.calls[0]?.[0]).toMatchObject({
            provider: 'openai-compatible',
            model: 'compatible-model',
            status: 'failed',
            failure: { code: 'provider-attempt-failed', retryable: true },
            output: { toolCalls: [] },
            usage: {
                inputTokens: 63,
                outputTokens: 9,
                cachedInputTokens: 5,
                cacheWriteInputTokens: null,
                provenance: 'provider-reported',
            },
        });
        expect(agentRunLifecycle.get('run-compatible-protocol-usage')?.providerUsage).toHaveLength(1);
        expect(getProviderRouteView({ runId: 'run-compatible-protocol-usage', candidates: [] })?.actual).toMatchObject({
            provider: 'openai-compatible',
            model: 'compatible-model',
        });
        expect(getProviderRouteView({ runId: 'run-compatible-protocol-usage', candidates: [] })?.cost).toEqual([
            {
                category: 'remoteTokens',
                reserved: 72,
                actual: 72,
                provenance: 'provider-reported',
                final: true,
            },
        ]);
    });

    it('forwards a required directive verbatim to generateCloudToolCalls with no abort signal supplied', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: null,
        });
        const directive: HostedToolChoiceDirective = { mode: 'required', toolNames: ['muteTrack', 'soloTrack'] };

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                undefined,
                'mute the first track',
                undefined,
                undefined,
                undefined,
                directive
            )
        ).resolves.toMatchObject({ status: 'complete' });

        expect(mocks.generateCloudToolCalls.mock.calls[0]?.[4]).toStrictEqual(directive);
    });

    it('forwards a required directive verbatim to generateCloudToolCalls with an abort signal supplied', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: null,
        });
        const directive: HostedToolChoiceDirective = { mode: 'required', toolNames: ['muteTrack', 'soloTrack'] };
        const controller = new AbortController();

        await expect(
            generateToolPlanningOutcome(
                'system',
                'mute the first track',
                toolSchemas,
                controller.signal,
                'mute the first track',
                undefined,
                undefined,
                undefined,
                directive
            )
        ).resolves.toMatchObject({ status: 'complete' });

        expect(mocks.generateCloudToolCalls.mock.calls[0]?.[4]).toStrictEqual(directive);
    });

    it('sends the first user message and replays the hosted turns behind it', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            assistantItems: [{ type: 'function_call', call_id: 'provider-call' }],
            strictToolSchemas: true,
            usage: null,
        });
        const history: HostedTurnHistory = [
            {
                turn: 1,
                provider: 'openai',
                assistantItems: [{ type: 'reasoning', id: 'rs_1' }],
                calls: [{ id: 'query-1', name: 'project.query', arguments: {} }],
                receipts: [
                    {
                        schema: 'sourdaw.application-tool-receipt',
                        schemaVersion: 1,
                        callId: 'query-1',
                        toolName: 'project.query',
                        turn: 1,
                        status: 'success',
                        revision: 'revision-2',
                        data: { items: [] },
                        summary: 'Queried the project.',
                        warnings: [],
                        error: null,
                    },
                ],
            },
        ];
        const onProviderAttempt = vi.fn((_input: ProviderAttemptAdmission) => ({ status: 'admitted' as const }));

        const outcome = await generateToolPlanningOutcome(
            'system',
            'receipts folded into the prompt',
            toolSchemas,
            undefined,
            'mute the first track',
            undefined,
            undefined,
            onProviderAttempt,
            AUTO_TOOL_CHOICE,
            { firstUserMessage: 'mute the first track', history, budgetNote: 'Remaining budget: 2 turn(s).' }
        );

        expect(outcome).toMatchObject({ status: 'complete' });
        // The hosted turn sends the run's first message, never the receipt-folded text form.
        expect(mocks.generateCloudToolCalls.mock.calls[0]?.[1]).toBe('mute the first track');
        expect(mocks.generateCloudToolCalls.mock.calls[0]?.[6]).toMatchObject({
            history,
            budgetNote: 'Remaining budget: 2 turn(s).',
        });
        // The protocol record states the same exchange: the earlier turn and its receipts
        // stand between the first user message and the note that closes them.
        expect(onProviderAttempt.mock.calls[0]?.[0].request.messages).toEqual([
            { role: 'system', content: 'system' },
            { role: 'user', content: 'mute the first track' },
            { role: 'assistant', content: JSON.stringify(history[0]?.assistantItems) },
            { role: 'tool', content: JSON.stringify(history[0]?.receipts[0]) },
            { role: 'user', content: 'Remaining budget: 2 turn(s).' },
        ]);
    });

    it('reports the hosted turn the cloud plan produced so a later turn can replay it', async () => {
        mocks.backendChain.value = ['cloud'];
        const assistantItems = [
            { type: 'reasoning', id: 'rs_2' },
            { type: 'function_call', call_id: 'provider-call' },
        ];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            assistantItems,
            strictToolSchemas: true,
            usage: null,
        });

        await expect(generateToolPlanningOutcome('system', 'mute the first track', toolSchemas)).resolves.toMatchObject(
            {
                status: 'complete',
                providerTurn: { provider: 'openai', assistantItems },
            }
        );
    });

    it('reports the hosted turn with no replayable items when the provider left a call unidentified', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            assistantItems: [{ type: 'function_call', call_id: 'provider-call' }],
            strictToolSchemas: true,
            usage: null,
        });

        // The turn is still reported, so its calls and receipts reach the next request; only the
        // items are withheld, because nothing in them carries the identifier the receipt answers.
        await expect(generateToolPlanningOutcome('system', 'mute the first track', toolSchemas)).resolves.toMatchObject(
            {
                status: 'complete',
                providerTurn: { provider: 'openai', assistantItems: null },
            }
        );
    });

    it('reports no hosted turn for a locally planned batch', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({
            status: 'complete',
            toolCalls: [{ name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
        });

        const outcome = await generateToolPlanningOutcome('system', 'mute the first track', toolSchemas);

        expect(outcome).toMatchObject({ status: 'complete' });
        expect(outcome.status === 'complete' ? outcome.providerTurn : 'unreached').toBeUndefined();
    });

    it('forwards the default auto directive to generateCloudToolCalls when no directive is supplied', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: null,
        });

        await expect(generateToolPlanningOutcome('system', 'mute the first track', toolSchemas)).resolves.toMatchObject(
            { status: 'complete' }
        );

        expect(mocks.generateCloudToolCalls.mock.calls[0]?.[4]).toStrictEqual(AUTO_TOOL_CHOICE);
    });

    it('admits a tool-call reply carrying null for an argument the source schema leaves optional', async () => {
        mocks.backendChain.value = ['cloud'];
        const addDeviceToolSchema: ToolSchema = {
            type: 'function',
            function: {
                name: 'addDevice',
                description: 'Add a device to the chain.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        deviceType: { type: 'string' },
                        afterDeviceId: { type: 'string' },
                    },
                    required: ['deviceType'],
                },
            },
        };
        // OpenAI's strict projection forces every optional property into `required` and
        // nullable, so a conforming reply carries an explicit `null` for `afterDeviceId`
        // even though the source schema (what `admitEvent` validates against) leaves it
        // optional and typed `string`. Without dropping it first, `admitEvent` rejects it.
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'addDevice', arguments: { deviceType: 'eq', afterDeviceId: null } }],
            strictToolSchemas: true,
            usage: null,
        });

        const outcome = await generateToolPlanningOutcome('system', 'add an eq', [addDeviceToolSchema]);

        expect(outcome).toMatchObject({ status: 'complete' });
        expect(outcome.status === 'complete' ? outcome.toolCalls : []).toEqual([
            { id: 'provider-call', name: 'addDevice', arguments: { deviceType: 'eq' } },
        ]);
    });

    it('still rejects a null value on an argument the source schema requires', async () => {
        mocks.backendChain.value = ['cloud'];
        const addDeviceToolSchema: ToolSchema = {
            type: 'function',
            function: {
                name: 'addDevice',
                description: 'Add a device to the chain.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        deviceType: { type: 'string' },
                        afterDeviceId: { type: 'string' },
                    },
                    required: ['deviceType'],
                },
            },
        };
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'addDevice', arguments: { deviceType: null } }],
            strictToolSchemas: true,
            usage: null,
        });

        await expect(generateToolPlanningOutcome('system', 'add an eq', [addDeviceToolSchema])).rejects.toThrow(
            'The model provider request failed.'
        );
    });

    it('admits a tool-call reply carrying null for an argument a nested items object leaves optional', async () => {
        mocks.backendChain.value = ['cloud'];
        const batchProposeToolSchema: ToolSchema = {
            type: 'function',
            function: {
                name: 'command.batch.propose',
                description: 'Propose a batch of commands.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    id: { type: 'string' },
                                    dependsOn: { type: 'array', items: { type: 'string' } },
                                },
                                required: ['id'],
                            },
                        },
                    },
                    required: ['items'],
                },
            },
        };
        // OpenAI's strict projection applies at every nesting depth: `dependsOn` inside each
        // `items` object comes back forced into that object's `required` list and nullable,
        // even though the source item schema leaves it optional.
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [
                {
                    id: 'provider-call',
                    name: 'command.batch.propose',
                    arguments: { items: [{ id: 'a', dependsOn: null }] },
                },
            ],
            strictToolSchemas: true,
            usage: null,
        });

        const outcome = await generateToolPlanningOutcome('system', 'propose a batch', [batchProposeToolSchema]);

        expect(outcome).toMatchObject({ status: 'complete' });
        expect(outcome.status === 'complete' ? outcome.toolCalls : []).toEqual([
            { id: 'provider-call', name: 'command.batch.propose', arguments: { items: [{ id: 'a' }] } },
        ]);
    });

    it('still rejects a null value on a nested items property the item schema requires', async () => {
        mocks.backendChain.value = ['cloud'];
        const batchProposeToolSchema: ToolSchema = {
            type: 'function',
            function: {
                name: 'command.batch.propose',
                description: 'Propose a batch of commands.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    id: { type: 'string' },
                                    dependsOn: { type: 'array', items: { type: 'string' } },
                                },
                                required: ['id', 'dependsOn'],
                            },
                        },
                    },
                    required: ['items'],
                },
            },
        };
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [
                {
                    id: 'provider-call',
                    name: 'command.batch.propose',
                    arguments: { items: [{ id: 'a', dependsOn: null }] },
                },
            ],
            strictToolSchemas: true,
            usage: null,
        });

        await expect(
            generateToolPlanningOutcome('system', 'propose a batch', [batchProposeToolSchema])
        ).rejects.toThrow('The model provider request failed.');
    });

    it('admits the compiled request with the single-sourced output budget and wires it to the provider call', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: null,
        });
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
            TOOL_PLAN_MAX_OUTPUT_TOKENS,
            expect.anything(),
            undefined,
            undefined
        );
    });

    it('admits the compiled request with the configured model output ceiling', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [{ id: 'provider-call', name: 'muteTrack', arguments: { trackId: 'track-1', muted: true } }],
            strictToolSchemas: true,
            usage: null,
        });
        expect(configureAgentResourceLimits({ maxModelOutputTokens: 1_024 })).toMatchObject({ status: 'configured' });
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

        const admission = onProviderAttempt.mock.calls[0]?.[0];
        expect(admission?.request.limits).toEqual({ maxOutputTokens: 1_024 });
        expect(admission?.request.budget).toEqual({
            maxInputTokens: 32_768,
            maxOutputTokens: 1_024,
            maxTotalTokens: 32_768 + 1_024,
        });
        expect(mocks.generateCloudToolCalls).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            1_024,
            expect.anything(),
            undefined,
            undefined
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
        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledWith(
            expect.any(String),
            'mute the first track',
            expect.any(Array),
            8192,
            undefined
        );
        expect(mocks.llmStatusSet).toHaveBeenLastCalledWith({
            state: 'ready',
            backend: 'webllm',
            modelId: 'Qwen3-4B-q4f16_1-MLC',
        });
    });

    it('passes admitted maxOutputTokens limit to WebLLM tool calls', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({
            status: 'complete',
            toolCalls: [],
        });

        await generateToolPlanningOutcome('system', 'mute the first track', toolSchemas);

        expect(mocks.generateWebLlmToolCalls).toHaveBeenCalledWith(
            expect.any(String),
            'mute the first track',
            expect.any(Array),
            8192,
            undefined
        );
    });

    it('keeps the five application tools available to WebLLM under budget selection pressure', async () => {
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
        expect(advertisedTools).toHaveLength(WEBLLM_TOOL_BUDGET);
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

    it('keeps the creative interpretation tool available to WebLLM under budget selection pressure', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });
        // Production appends the creative interpretation schema last, behind far more action tools
        // than the browser cap admits, so only application-tool standing keeps it advertised.
        const competingTools = Array.from({ length: 120 }, (_, index) =>
            toolSchema(`planAction${String(index)}`, 'plan a command')
        );
        const schemas = [
            toolSchema('project.query'),
            toolSchema('command.batch.propose'),
            toolSchema('command.batch.decline'),
            toolSchema('agent.command-index.search'),
            toolSchema('agent.catalog.discover'),
            ...competingTools,
            createCreativeInterpretationToolSchema(creativeCatalog),
        ];

        await expect(generateToolPlanningOutcome('system', 'plan a command', schemas)).resolves.toMatchObject({
            status: 'complete',
        });

        const advertisedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? [];
        expect(advertisedTools).toHaveLength(WEBLLM_TOOL_BUDGET);
        expect(advertisedTools.map((tool: ToolSchema) => tool.function.name)).toContain(
            CREATIVE_INTERPRETATION_TOOL_NAME
        );
    });

    it('advertises the production planning contract to WebLLM within the tool budget', async () => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });

        // The list production sends: the planning contract plus every workflow action tool.
        const planningContract = getPlanningProviderSchemaContract().schemas;
        const schemas = getPlanningProviderToolSchemas();

        // The list production sends must carry exactly the planning contract plus every workflow action tool, and this holds across catalog growth.
        expect(new Set(schemas.map((tool) => tool.function.name))).toEqual(
            new Set([...planningContract.map((tool) => tool.function.name), ...WORKFLOW_ACTION_TOOL_NAMES])
        );

        // Production appends the creative interpretation schema to that list on every run.
        const productionSchemas = [...schemas, createCreativeInterpretationToolSchema(creativeCatalog)];

        await expect(generateToolPlanningOutcome('system', 'plan a command', productionSchemas)).resolves.toMatchObject(
            {
                status: 'complete',
            }
        );

        const advertisedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? [];
        const advertisedNames = advertisedTools.map((tool: ToolSchema) => tool.function.name);

        // The mandatory set (workflow selector, the application tools, every workflow action tool)
        // leaves one free slot under the WebLLM budget, and it goes to the first non-mandatory
        // catalog tool.
        expect(advertisedNames).toHaveLength(WEBLLM_TOOL_BUDGET);
        expect(new Set(advertisedNames)).toEqual(
            new Set([
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
                CREATIVE_INTERPRETATION_TOOL_NAME,
                'project.discover',
            ])
        );
        // The free slot goes to the first non-mandatory catalog tool; agent.capabilities is not it.
        expect(advertisedNames).not.toContain('agent.capabilities');
    });

    it.each([
        'add an eq device to the vocals',
        'find a warm reverb preset for the vocal and load it',
        'show the command history',
        'the bass is muddy, clean it up',
    ])('never advertises recipe.discover to WebLLM for "%s"', async (prompt) => {
        mocks.backendChain.value = ['webllm'];
        mocks.generateWebLlmToolCalls.mockResolvedValue({ status: 'complete', toolCalls: [] });

        const schemas = getPlanningProviderToolSchemas();
        const productionSchemas = [...schemas, createCreativeInterpretationToolSchema(creativeCatalog)];

        await expect(generateToolPlanningOutcome('system', prompt, productionSchemas)).resolves.toMatchObject({
            status: 'complete',
        });

        const advertisedTools = mocks.generateWebLlmToolCalls.mock.calls[0]?.[2] ?? [];
        const advertisedNames = advertisedTools.map((tool: ToolSchema) => tool.function.name);

        // recipe.discover must never cost the local tier the planning tools it had before it existed:
        // the advertised list stays identical to the pre-recipe.discover contract for every prompt.
        expect(advertisedNames).toHaveLength(WEBLLM_TOOL_BUDGET);
        expect(advertisedNames).toContain(PROJECT_DISCOVERY_TOOL_NAME);
        expect(advertisedNames).not.toContain(RECIPE_DISCOVERY_TOOL_NAME);
    });

    it('still advertises recipe.discover to a hosted cloud backend', async () => {
        mocks.backendChain.value = ['cloud'];
        mocks.generateCloudToolCalls.mockResolvedValue({
            providerRequestId: null,
            calls: [],
            strictToolSchemas: false,
            usage: null,
        });

        const schemas = getPlanningProviderToolSchemas();
        const productionSchemas = [...schemas, createCreativeInterpretationToolSchema(creativeCatalog)];

        await expect(
            generateToolPlanningOutcome(
                'system',
                'find a warm reverb preset for the vocal and load it',
                productionSchemas
            )
        ).resolves.toMatchObject({ status: 'complete' });

        const sentTools = mocks.generateCloudToolCalls.mock.calls[0]?.[2] ?? [];
        expect(sentTools.map((tool: ToolSchema) => tool.function.name)).toContain(RECIPE_DISCOVERY_TOOL_NAME);
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
