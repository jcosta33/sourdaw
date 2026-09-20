import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../../models/AgentResourceLimits';
import { type AgentRunWorkLease } from '../../../models/AgentRun';
import { type ModelProviderRequestInput } from '../../../models/ModelProviderProtocol';
import { agentResourceLimitsStore } from '../../../stores/agentResourceLimitsStore';
import { configureAgentResourceLimits } from '../../configureAgentResourceLimits';
import { streamExplainChatResponse } from '../streamExplainChatResponse';

const mocks = vi.hoisted(() => ({
    appendChatMessage: vi.fn(),
    bindAbortController: vi.fn(() => () => undefined),
    buildAgentContext: vi.fn(() => ({
        message: 'system context',
        evidence: [],
        authorityComplete: true,
    })),
    cancel: vi.fn(),
    captureProjectRevision: vi.fn(() => 'revision-fixture'),
    compileRequest: vi.fn(
        (_input: ModelProviderRequestInput): { status: string; failure?: unknown; request?: unknown } => ({
            status: 'unavailable',
            failure: { safeMessage: 'The fixture protocol admits no request.' },
        })
    ),
    get: vi.fn(() => ({
        grants: {},
        budgets: { limits: {}, consumed: {} },
        plan: null,
        errors: [],
        contextEvidence: [],
    })),
    getActiveModelId: vi.fn(() => 'webllm-model'),
    getProjectContext: vi.fn(() => ({ tracks: [] })),
    loggerError: vi.fn(),
    normalizeAgentFailure: vi.fn(() => ({ code: 'provider' })),
    recordContextEvidence: vi.fn(),
    recordError: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    settleSafely: vi.fn(() => ({ accepted: false, warning: null })),
    updateChatMessage: vi.fn(),
    getCloudProviderInfo: vi.fn(() => null as { provider: string; model: string } | null),
    prepareDisclosure: vi.fn(() => ({})),
    publishDisclosure: vi.fn(() => true),
    reserveBudget: vi.fn(),
    streamCloudChatCompletion: vi.fn(),
    streamWriterFinish: vi.fn(() => ({ status: 'complete', failure: null })),
    streamWriterPush: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));

vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRevision: mocks.captureProjectRevision }));

vi.mock('../../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../createModelProviderStreamWriter', () => ({
    createModelProviderStreamWriter: () => ({ push: mocks.streamWriterPush, finish: mocks.streamWriterFinish }),
}));

vi.mock('../../../repositories/cloudLlm/isCloudAvailable', () => ({ isCloudAvailable: vi.fn(() => false) }));

vi.mock('../../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: mocks.getActiveModelId }));

vi.mock('../../../repositories/webLlm/getLlmEngine', () => ({ getLlmEngine: vi.fn(() => null) }));

vi.mock('../../../stores/chatStore', () => ({
    chatStore: { value: { messages: [] } },
    appendChatMessage: mocks.appendChatMessage,
    updateChatMessage: mocks.updateChatMessage,
    setChatGenerating: mocks.setChatGenerating,
    setActiveAborter: mocks.setActiveAborter,
}));

vi.mock('../../agentErrorAndSaga', () => ({ normalizeAgentFailure: mocks.normalizeAgentFailure }));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        get: mocks.get,
        recordContextEvidence: mocks.recordContextEvidence,
        recordError: mocks.recordError,
        reserveBudget: mocks.reserveBudget,
        transitionPhase: vi.fn(),
    },
}));

vi.mock('../../agentRunWorkLease', () => ({ agentRunWorkLease: { settle: vi.fn() } }));

vi.mock('../../buildAgentContext', () => ({ buildAgentContext: mocks.buildAgentContext }));

vi.mock('../../discloseRemoteTransmission', () => ({
    remoteTransmissionDisclosure: { prepare: mocks.prepareDisclosure, publish: mocks.publishDisclosure },
}));

vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: { bindAbortController: mocks.bindAbortController, cancel: mocks.cancel },
}));

vi.mock('../../getProjectContext', () => ({ getProjectContext: mocks.getProjectContext }));

vi.mock('../../modelProviderProtocol', () => ({
    createModelProviderProtocol: () => ({ compileRequest: mocks.compileRequest, start: vi.fn() }),
}));

vi.mock('../../recordAgentProviderUsage', () => ({ recordAgentProviderUsage: vi.fn() }));

vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    AGENT_RUN_STALE_COMPLETION_WARNING: 'stale',
    settleAgentRunWorkLeaseSafely: mocks.settleSafely,
}));

const lease: AgentRunWorkLease = {
    leaseId: 'lease-1',
    runId: 'run-1',
    workId: 'work-1',
    attempt: 1,
    ownerKind: 'provider',
    cancellationGeneration: 0,
    idempotencyKey: 'idempotency-1',
    receiptIdentity: 'receipt-1',
    cleanupOwner: 'AiRuntime',
    idempotent: true,
    retriable: true,
    claimedAt: 0,
    terminalState: null,
    settledAt: null,
};

async function compileExplainRequest(): Promise<{ maxOutputTokens: number; maxTotalTokens: number }> {
    mocks.compileRequest.mockClear();
    await streamExplainChatResponse({
        userText: 'Why is the low end muddy?',
        runId: 'run-1',
        backend: 'webllm',
        providerLease: lease,
        providerReceiptIdentity: 'receipt-1',
        providerWorkId: 'work-1',
    });
    const compiled = mocks.compileRequest.mock.calls[0]?.[0];
    if (compiled === undefined) {
        throw new Error('the explain route compiled no provider request');
    }
    return { maxOutputTokens: compiled.limits.maxOutputTokens, maxTotalTokens: compiled.budget.maxTotalTokens };
}

type CloudStreamOptions = {
    onReasoning?: (text: string) => void;
    onUsage?: (event: unknown) => void;
    onUnknownEvent?: (providerEventType: string) => void;
};

type ChatMessagePatch = { content?: string; reasoning?: string; isStreaming?: boolean };

function readLastChatPatch(): ChatMessagePatch {
    const calls = mocks.updateChatMessage.mock.calls;
    const last = calls[calls.length - 1];
    if (last === undefined) {
        throw new Error('the explain route wrote no chat message');
    }
    return last[1] as ChatMessagePatch;
}

describe('streamExplainChatResponse hosted reasoning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bindAbortController.mockReturnValue(() => undefined);
        mocks.getCloudProviderInfo.mockReturnValue({ provider: 'anthropic', model: 'claude-test' });
        mocks.prepareDisclosure.mockReturnValue({});
        mocks.publishDisclosure.mockReturnValue(true);
        mocks.reserveBudget.mockReturnValue({ status: 'reserved' });
        mocks.settleSafely.mockReturnValue({ accepted: true, warning: null });
        mocks.streamWriterFinish.mockReturnValue({ status: 'complete', failure: null });
        mocks.compileRequest.mockImplementation((input: ModelProviderRequestInput) => ({
            status: 'ready' as const,
            request: {
                correlationId: input.correlationId,
                messages: input.messages,
                limits: input.limits,
            },
        }));
    });

    it('renders streamed thinking as the assistant message reasoning beside its answer', async () => {
        mocks.streamCloudChatCompletion.mockImplementation(
            async (_messages: unknown, onToken: (text: string) => void, options: CloudStreamOptions) => {
                options.onReasoning?.('plan');
                onToken('ok');
                return { status: 'complete', finishReason: 'stop', providerRequestId: null };
            }
        );

        await streamExplainChatResponse({
            userText: 'Why is the low end muddy?',
            runId: 'run-1',
            backend: 'cloud',
            providerLease: lease,
            providerReceiptIdentity: 'receipt-1',
            providerWorkId: 'work-1',
        });

        expect(mocks.streamCloudChatCompletion).toHaveBeenCalledOnce();
        expect(readLastChatPatch()).toMatchObject({ content: 'ok', reasoning: 'plan', isStreaming: false });
    });
});

describe('streamExplainChatResponse output ceiling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.bindAbortController.mockReturnValue(() => undefined);
        mocks.compileRequest.mockReturnValue({
            status: 'unavailable',
            failure: { safeMessage: 'The fixture protocol admits no request.' },
        });
        mocks.settleSafely.mockReturnValue({ accepted: false, warning: null });
    });

    afterEach(() => {
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    });

    it('lowers the route ceiling and the total budget to a smaller configured model ceiling', async () => {
        expect(configureAgentResourceLimits({ maxModelOutputTokens: 512 })).toMatchObject({ status: 'configured' });

        await expect(compileExplainRequest()).resolves.toEqual({ maxOutputTokens: 512, maxTotalTokens: 33_280 });
    });

    it('keeps its own ceiling when the configured model ceiling is larger', async () => {
        expect(configureAgentResourceLimits({ maxModelOutputTokens: 65_536 })).toMatchObject({ status: 'configured' });

        await expect(compileExplainRequest()).resolves.toEqual({ maxOutputTokens: 2_048, maxTotalTokens: 34_816 });
    });
});
