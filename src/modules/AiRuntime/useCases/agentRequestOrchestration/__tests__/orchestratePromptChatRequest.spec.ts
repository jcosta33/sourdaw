import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orchestratePromptChatRequest } from '../orchestratePromptChatRequest';

const mocks = vi.hoisted(() => ({
    appendChatMessage: vi.fn(),
    bindAbortController: vi.fn(),
    captureProjectRevision: vi.fn(),
    claim: vi.fn(),
    create: vi.fn(),
    getActiveModelId: vi.fn(),
    getCloudProviderInfo: vi.fn(),
    loggerError: vi.fn(),
    normalizeAgentFailure: vi.fn(),
    planPromptActions: vi.fn(),
    recordError: vi.fn(),
    reserveBudget: vi.fn(),
    reserveBudgetBatch: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    settle: vi.fn(),
    settleSafely: vi.fn(),
    transitionPhase: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-fixture'),
}));

vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../../repositories/webLlm/getActiveModelId', () => ({ getActiveModelId: mocks.getActiveModelId }));

vi.mock('../../../stores/chatStore', () => ({
    appendChatMessage: mocks.appendChatMessage,
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../agentErrorAndSaga', () => ({ normalizeAgentFailure: mocks.normalizeAgentFailure }));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        create: mocks.create,
        recordApplicationToolEvidence: vi.fn(),
        recordError: mocks.recordError,
        reserveBudget: mocks.reserveBudget,
        reserveBudgetBatch: mocks.reserveBudgetBatch,
        transitionPhase: mocks.transitionPhase,
    },
}));

vi.mock('../../agentRunWorkLease', () => ({
    agentRunWorkLease: { claim: mocks.claim, settle: mocks.settle },
}));

vi.mock('../../applicationOwnedToolLoop', () => ({
    ApplicationOwnedToolLoopRequestError: class ApplicationOwnedToolLoopRequestError extends Error {
        receipts: never[] = [];
    },
}));

vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: { bindAbortController: mocks.bindAbortController, cancel: vi.fn() },
}));

vi.mock('../../describePendingActionConfirmation', () => ({ describePendingActionConfirmation: vi.fn() }));
vi.mock('../../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../../recordAgentProviderUsage', () => ({ recordAgentProviderUsage: vi.fn() }));
vi.mock('../executeImmediatePromptCommand', () => ({ executeImmediatePromptCommand: vi.fn() }));
vi.mock('../executePromptCommandPreview', () => ({ executePromptCommandPreview: vi.fn() }));
vi.mock('../materializePromptCommandPlan', () => ({ materializePromptCommandPlan: vi.fn() }));
vi.mock('../persistPromptActionConfirmation', () => ({ persistPromptActionConfirmation: vi.fn() }));
vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    AGENT_RUN_STALE_COMPLETION_WARNING: 'stale completion warning',
    settleAgentRunWorkLeaseSafely: mocks.settleSafely,
}));

describe('orchestratePromptChatRequest', () => {
    const providerLease = {
        runId: 'agent-run-fixture',
        workId: 'provider-planning',
        cancellationGeneration: 0,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getActiveModelId.mockReturnValue('fixture-model');
        mocks.getCloudProviderInfo.mockReturnValue(null);
        mocks.claim.mockReturnValue({ status: 'claimed', lease: providerLease });
        mocks.bindAbortController.mockReturnValue(vi.fn());
        mocks.settleSafely.mockReturnValue({ accepted: true, warning: null });
        mocks.normalizeAgentFailure.mockReturnValue({ code: 'agent.fixture' });
    });

    it('settles provider planning before mapping a rejected plan to the retained terminal chat messages', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            result: { actions: [], rejectionReason: 'The requested command cannot be resolved.' },
            projectRevision: 'revision-planned',
        });

        await expect(
            orchestratePromptChatRequest({
                userText: 'add a track',
                requestedRoute: 'auto',
                backend: 'webllm',
                interactionMode: 'apply',
                options: undefined,
            })
        ).resolves.toBeUndefined();

        expect(mocks.claim).toHaveBeenCalledWith(
            expect.objectContaining({
                workId: 'provider-planning',
                ownerKind: 'provider',
                cleanupOwner: 'provider-adapter',
            })
        );
        expect(mocks.settleSafely).toHaveBeenCalledWith(
            expect.objectContaining({ lease: providerLease, terminalState: 'completed', evidence: 'none' })
        );
        expect(mocks.recordError).toHaveBeenCalledWith(expect.objectContaining({ terminal: true }));
        expect(mocks.appendChatMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                role: 'assistant',
                content: 'Command not executed: The requested command cannot be resolved.',
                error: 'The requested command cannot be resolved.',
            })
        );
    });

    it('settles failed provider planning before exposing the planning failure in chat', async () => {
        mocks.planPromptActions.mockRejectedValue(new Error('Planning provider failed'));

        await expect(
            orchestratePromptChatRequest({
                userText: 'add a track',
                requestedRoute: 'auto',
                backend: 'webllm',
                interactionMode: 'apply',
                options: undefined,
            })
        ).resolves.toBeUndefined();

        expect(mocks.settleSafely).toHaveBeenCalledWith(
            expect.objectContaining({ lease: providerLease, terminalState: 'failed', evidence: 'none' })
        );
        expect(mocks.appendChatMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                role: 'assistant',
                content: 'Failed to process prompt command.',
                error: 'Planning provider failed',
            })
        );
    });

    it('does not claim a completed plan when provider settlement cannot retain it', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            result: { actions: [], rejectionReason: 'The requested command cannot be resolved.' },
            projectRevision: 'revision-planned',
        });
        mocks.settleSafely.mockReturnValue({ accepted: false, warning: 'provider settlement warning' });

        await orchestratePromptChatRequest({
            userText: 'add a track',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(mocks.recordError).not.toHaveBeenCalled();
        expect(mocks.appendChatMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                role: 'assistant',
                content: 'Command plan was not retained. provider settlement warning',
                error: 'provider settlement warning',
            })
        );
    });
});
