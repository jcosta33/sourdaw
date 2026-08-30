import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ModelProviderResult } from '../../../models/ModelProviderProtocol';
import { type ProviderAttemptAdmission } from '../../llmOrchestration/inference';
import { type planPromptActions } from '../../planPromptActions';
import { orchestratePromptChatRequest } from '../orchestratePromptChatRequest';

type PlanPromptActionsInput = Parameters<typeof planPromptActions>[0];

const mocks = vi.hoisted(() => ({
    appendChatMessage: vi.fn(),
    bindAbortController: vi.fn(),
    captureProjectRevision: vi.fn(),
    cancel: vi.fn(),
    claim: vi.fn(),
    create: vi.fn(),
    executeImmediatePromptCommand: vi.fn(),
    executePromptCommandPreview: vi.fn(),
    getActiveModelId: vi.fn(),
    getCloudProviderInfo: vi.fn(),
    loggerError: vi.fn(),
    materializePromptCommandPlan: vi.fn(),
    normalizeAgentFailure: vi.fn(),
    planPromptActions: vi.fn(),
    persistPromptActionConfirmation: vi.fn(),
    recordAgentProviderUsage: vi.fn(),
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
    agentRunCancellation: { bindAbortController: mocks.bindAbortController, cancel: mocks.cancel },
}));

vi.mock('../../describePendingActionConfirmation', () => ({ describePendingActionConfirmation: vi.fn() }));
vi.mock('../../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../../recordAgentProviderUsage', () => ({ recordAgentProviderUsage: mocks.recordAgentProviderUsage }));
vi.mock('../executeImmediatePromptCommand', () => ({
    executeImmediatePromptCommand: mocks.executeImmediatePromptCommand,
}));
vi.mock('../executePromptCommandPreview', () => ({
    executePromptCommandPreview: mocks.executePromptCommandPreview,
}));
vi.mock('../materializePromptCommandPlan', () => ({
    materializePromptCommandPlan: mocks.materializePromptCommandPlan,
}));
vi.mock('../persistPromptActionConfirmation', () => ({
    persistPromptActionConfirmation: mocks.persistPromptActionConfirmation,
}));
vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    AGENT_RUN_STALE_COMPLETION_WARNING: 'stale completion warning',
    settleAgentRunWorkLeaseSafely: mocks.settleSafely,
}));

function createProviderAttempt(
    backend: Extract<ProviderAttemptAdmission['backend'], 'cloud' | 'webllm'>
): ProviderAttemptAdmission {
    const provider = backend === 'cloud' ? 'openai' : 'webllm';
    return {
        backend,
        provider,
        correlationId: `${backend}-provider-attempt`,
        request: {
            schemaVersion: 2,
            runId: 'agent-run-fixture',
            requestId: `${backend}-provider-attempt`,
            correlationId: `${backend}-provider-attempt`,
            cancellationGeneration: 0,
            operation: 'tools',
            modality: 'text',
            messages: [],
            stream: false,
            limits: { maxOutputTokens: 256 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 1_024, maxOutputTokens: 256, maxTotalTokens: 1_280 },
            dataPolicy: backend === 'cloud' ? 'remote-allowed' : 'local-only',
        },
        estimatedTotalTokens: 256,
        estimate: {
            method: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
            inputTokenCeiling: 128,
            outputTokenCeiling: 128,
            totalTokenCeiling: 256,
        },
    };
}

describe('orchestratePromptChatRequest', () => {
    const releaseProviderCancellation = vi.fn();
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
        mocks.bindAbortController.mockReturnValue(releaseProviderCancellation);
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
        expect(mocks.settleSafely.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.recordError.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(mocks.settleSafely.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.appendChatMessage.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(releaseProviderCancellation).toHaveBeenCalledOnce();
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
        expect(mocks.settleSafely.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.appendChatMessage.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(releaseProviderCancellation).toHaveBeenCalledOnce();
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

    it('denies provider and local work admissions without materializing or dispatching a plan', async () => {
        const providerAttempt = createProviderAttempt('cloud');
        mocks.reserveBudget.mockReturnValue({ status: 'hard-limit-reached', reason: 'remoteTokens' });
        mocks.reserveBudgetBatch.mockReturnValue({ status: 'hard-limit-reached', reason: 'storageBytes' });
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            expect(input.onProviderAttempt?.(providerAttempt)).toEqual({
                status: 'rejected',
                reason: 'remoteTokens',
            });
            expect(input.onLocalWorkAttempt?.({ analysisCount: 1, downloadBytes: 2, storageBytes: 3 })).toBe(false);
            return {
                context: {},
                result: { actions: [], rejectionReason: 'Planning admissions were denied.' },
                projectRevision: 'revision-planned',
            };
        });

        await orchestratePromptChatRequest({
            userText: 'prepare stems',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(mocks.reserveBudget).toHaveBeenCalledWith(
            expect.objectContaining({
                category: 'remoteTokens',
                attemptId: providerAttempt.correlationId,
                estimate: providerAttempt.estimatedTotalTokens,
            })
        );
        expect(mocks.reserveBudgetBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                attempts: [
                    expect.objectContaining({ category: 'localAnalysis', estimate: 1 }),
                    expect.objectContaining({ category: 'downloadBytes', estimate: 2 }),
                    expect.objectContaining({ category: 'storageBytes', estimate: 3 }),
                ],
            })
        );
        expect(mocks.materializePromptCommandPlan).not.toHaveBeenCalled();
        expect(mocks.executePromptCommandPreview).not.toHaveBeenCalled();
        expect(mocks.persistPromptActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.executeImmediatePromptCommand).not.toHaveBeenCalled();
    });

    it.each([
        { backend: 'cloud' as const, expectedCategory: 'remoteTokens' },
        { backend: 'webllm' as const, expectedCategory: 'localAnalysis' },
    ])('admits a $backend provider attempt in its $expectedCategory budget category', async (expectation) => {
        const providerAttempt = createProviderAttempt(expectation.backend);
        let admittedRunId: string | undefined;
        mocks.reserveBudget.mockReturnValue({ status: 'reserved' });
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId;
            expect(input.onProviderAttempt?.(providerAttempt)).toEqual({ status: 'admitted' });
            return {
                context: {},
                result: { actions: [] },
                projectRevision: 'revision-planned',
            };
        });

        await orchestratePromptChatRequest({
            userText: 'plan a command',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(admittedRunId).toBeDefined();
        expect(mocks.reserveBudget).toHaveBeenCalledWith({
            runId: admittedRunId,
            attemptId: providerAttempt.correlationId,
            category: expectation.expectedCategory,
            estimate: providerAttempt.estimatedTotalTokens,
            provenance: 'versioned-estimate',
            estimateMethod: providerAttempt.estimate.method,
        });
    });

    it('admits local work with the exact reserved local, download, and storage estimates', async () => {
        let admittedRunId: string | undefined;
        mocks.reserveBudgetBatch.mockReturnValue({ status: 'reserved' });
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId;
            expect(input.onLocalWorkAttempt?.({ analysisCount: 2, downloadBytes: 4, storageBytes: 8 })).toBe(true);
            return {
                context: {},
                result: { actions: [] },
                projectRevision: 'revision-planned',
            };
        });

        await orchestratePromptChatRequest({
            userText: 'prepare stems',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(admittedRunId).toBeDefined();
        expect(mocks.reserveBudgetBatch).toHaveBeenCalledWith({
            runId: admittedRunId,
            attempts: [
                {
                    attemptId: 'stem-preparation:localAnalysis',
                    category: 'localAnalysis',
                    estimate: 2,
                    provenance: 'versioned-estimate',
                },
                {
                    attemptId: 'stem-preparation:downloadBytes',
                    category: 'downloadBytes',
                    estimate: 4,
                    provenance: 'versioned-estimate',
                },
                {
                    attemptId: 'stem-preparation:storageBytes',
                    category: 'storageBytes',
                    estimate: 8,
                    provenance: 'versioned-estimate',
                },
            ],
        });
    });

    it('forwards a provider result to usage accounting with its admitted run identity', async () => {
        const providerResult = {
            schemaVersion: 2,
            provider: 'webllm',
            model: 'fixture-model',
            correlationId: 'provider-result-correlation',
            status: 'complete',
            output: { text: 'fixture response', reasoning: '', toolCalls: [], structuredOutput: null },
            usage: {
                inputTokens: 128,
                outputTokens: 64,
                cachedInputTokens: null,
                reasoningTokens: null,
                provenance: 'provider-reported',
            },
            finishReason: 'stop',
            partialOutputDisposition: 'none',
            failure: null,
            ignoredProviderEvents: [],
        } satisfies ModelProviderResult;
        let admittedRunId: string | undefined;
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId;
            input.onProviderResult?.(providerResult);
            return {
                context: {},
                result: { actions: [] },
                projectRevision: 'revision-planned',
            };
        });

        await orchestratePromptChatRequest({
            userText: 'inspect the mix',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(admittedRunId).toBeDefined();
        expect(mocks.recordAgentProviderUsage).toHaveBeenCalledWith(
            admittedRunId,
            providerResult,
            providerResult.correlationId
        );
    });

    it('cancels an aborted completed plan before materialization and releases provider cancellation once', async () => {
        let activeAborter: AbortController | null = null;
        mocks.setActiveAborter.mockImplementation((aborter: AbortController | null) => {
            if (aborter instanceof AbortController) {
                activeAborter = aborter;
            }
        });
        mocks.planPromptActions.mockImplementation(async () => {
            activeAborter?.abort();
            return {
                context: {},
                result: { actions: [{ type: 'addTrack' }] },
                projectRevision: 'revision-planned',
            };
        });

        await orchestratePromptChatRequest({
            userText: 'add a track',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(mocks.cancel).toHaveBeenCalledWith(
            expect.objectContaining({ reason: 'User cancelled the run before planning completed.' })
        );
        expect(mocks.materializePromptCommandPlan).not.toHaveBeenCalled();
        expect(mocks.executePromptCommandPreview).not.toHaveBeenCalled();
        expect(mocks.persistPromptActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.executeImmediatePromptCommand).not.toHaveBeenCalled();
        expect(releaseProviderCancellation).toHaveBeenCalledOnce();
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });

    it('maps a zero-action accepted plan to completed lifecycle and its exact terminal message', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            result: { actions: [] },
            projectRevision: 'revision-planned',
        });

        await orchestratePromptChatRequest({
            userText: 'do nothing',
            requestedRoute: 'auto',
            backend: 'webllm',
            interactionMode: 'apply',
            options: undefined,
        });

        expect(mocks.transitionPhase).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'planning' }));
        expect(mocks.transitionPhase).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'completed' }));
        expect(mocks.appendChatMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                role: 'assistant',
                content: 'No actions were matched or executed for your command.',
                error: 'No actions matched',
            })
        );
        expect(releaseProviderCancellation).toHaveBeenCalledOnce();
    });

    it('rejects a non-claimed provider lease before planning or cancellation registration', async () => {
        mocks.claim.mockReturnValue({ status: 'already-settled' });

        await expect(
            orchestratePromptChatRequest({
                userText: 'add a track',
                requestedRoute: 'auto',
                backend: 'webllm',
                interactionMode: 'apply',
                options: undefined,
            })
        ).rejects.toThrow('Agent provider work could not be claimed: already-settled');

        expect(mocks.planPromptActions).not.toHaveBeenCalled();
        expect(mocks.bindAbortController).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();
        expect(mocks.materializePromptCommandPlan).not.toHaveBeenCalled();
        expect(mocks.executePromptCommandPreview).not.toHaveBeenCalled();
        expect(mocks.persistPromptActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.executeImmediatePromptCommand).not.toHaveBeenCalled();
    });
});
