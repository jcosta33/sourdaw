import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { executeCommittedSectionRenderRetry } from '../executeCommittedSectionRenderRetry';

const mocks = vi.hoisted(() => ({
    captureRevision: vi.fn(),
    chatState: { value: { isGenerating: false } },
    completeContinuation: vi.fn(),
    getConfirmation: vi.fn(),
    getRun: vi.fn(),
    logError: vi.fn(),
    project: vi.fn(),
    reconcileBudget: vi.fn(),
    replaceExecutions: vi.fn(),
    reserveBudget: vi.fn(),
    retryRenders: vi.fn(),
    setGenerating: vi.fn(),
    updateChat: vi.fn(),
    updateConfirmation: vi.fn(),
    updateFollowUp: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.logError } }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    retryAgentProjectSectionRenders: mocks.retryRenders,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRevision: mocks.captureRevision }));

vi.mock('../../../stores/chatStore', () => ({
    chatStore: mocks.chatState,
    setChatGenerating: mocks.setGenerating,
    updateChatMessage: mocks.updateChat,
}));

vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getConfirmation,
    replacePendingActionExecutions: mocks.replaceExecutions,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
    updatePendingActionFollowUp: mocks.updateFollowUp,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        completePendingEffectContinuation: mocks.completeContinuation,
        get: mocks.getRun,
        reconcileBudgetAttempt: mocks.reconcileBudget,
        reserveBudget: mocks.reserveBudget,
    },
}));

vi.mock('../projectSectionRenderConfirmation', () => ({
    projectSectionRenderConfirmation: mocks.project,
}));

const JOB = {
    jobId: 'render-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0,
};
const SECOND_JOB = {
    ...JOB,
    jobId: 'render-chorus',
    sectionId: 'section-chorus',
    sectionName: 'Chorus',
    startBeat: 16,
    endBeat: 32,
};

function createInput(): Parameters<typeof executeCommittedSectionRenderRetry>[0] {
    const action = {
        type: 'setTrackGain',
        payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
    } satisfies AppAction;
    const command = createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Set Kick gain.',
        normalizedProjectRevision: 'revision-source',
        objectReferences: [{ argument: 'trackId', id: 'track-kick', scope: 'stable' }],
        parameterUnits: [
            { argument: 'gain', unit: 'linear-gain' },
            { argument: 'expectedGain', unit: 'linear-gain' },
        ],
        reason: 'Apply the approved gain.',
        time: [],
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-retry',
        batchId: 'batch-retry',
        projectId: 'project-retry',
        baseRevision: 'revision-source',
        intent: 'Set Kick gain',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const durableReceipt = createVerifiedBatchReceipt({
        contentHash: 'content-retry',
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-source',
        resultingRevision: null,
        result: { status: 'committed', actions: [] },
    });
    return {
        durableReceipt,
        confirmation: {
            id: 'confirmation-retry',
            runId: 'run-retry',
            prompt: 'Render Verse',
            assistantMessageId: 'assistant-retry',
            actionLabels: ['Render Verse'],
            affectedIds: ['section-verse'],
            protectedUnchanged: [],
            risk: null,
            executedActions: [],
            status: 'failed',
            error: 'Renderer unavailable.',
            followUpProjectRevision: 'revision-source',
            followUpStatus: 'retryable',
            createdAt: 1,
            resolvedAt: 2,
            kind: 'app_actions',
            projectRevision: 'revision-source',
            actions: [action],
            approvalSnapshot: { actions: [action], actionLabels: ['Render Verse'], protectedUnchanged: [] },
            executionMode: 'atomic',
            groupId: 'batch-retry',
            groupLabel: 'Render Verse',
        },
    };
}

function projectionForJobs(jobs: (typeof JOB)[]) {
    return {
        executions: [],
        incompleteSectionRenders: jobs.length > 0 ? { jobs, missingJobIds: jobs.map(({ jobId }) => jobId) } : null,
        receipt: '- **renderProjectSections**: Render Verse',
    };
}

function projection(incomplete: boolean) {
    return projectionForJobs(incomplete ? [JOB] : []);
}

describe('executeCommittedSectionRenderRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.chatState.value = { isGenerating: false };
        mocks.captureRevision.mockReturnValue('revision-source');
        mocks.completeContinuation.mockImplementation(() => undefined);
        mocks.getRun.mockReturnValue({ budgetAttempts: [] });
        mocks.reconcileBudget.mockImplementation(() => undefined);
        mocks.reserveBudget.mockReturnValue({ status: 'reserved' });
        mocks.retryRenders.mockResolvedValue(undefined);
        mocks.getConfirmation.mockImplementation((id: string) =>
            id === 'confirmation-retry' ? createInput().confirmation : undefined
        );
        mocks.replaceExecutions.mockImplementation(() => createInput().confirmation);
    });

    it('rejects busy and stale retries before rendering or budget reservation', async () => {
        const input = createInput();
        mocks.chatState.value = { isGenerating: true };

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({ status: 'busy' });
        expect(mocks.project).not.toHaveBeenCalled();

        mocks.chatState.value = { isGenerating: false };
        mocks.project.mockReturnValue(projection(true));
        mocks.captureRevision.mockReturnValue('revision-changed');
        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'Project changed after the committed render receipt; the missing original artifacts cannot be recreated safely.',
        });
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.retryRenders).not.toHaveBeenCalled();
    });

    it('keeps completion retryable when durable continuation persistence fails', async () => {
        const input = createInput();
        mocks.project.mockReturnValue(projection(false));
        mocks.completeContinuation.mockImplementation(() => {
            throw new Error('persistence unavailable');
        });

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'persistence unavailable',
        });
        expect(mocks.updateFollowUp).toHaveBeenCalledWith({
            confirmationId: 'confirmation-retry',
            error: 'persistence unavailable',
            status: 'retryable',
        });
        expect(mocks.retryRenders).not.toHaveBeenCalled();
    });

    it('preserves retryability when the render budget hard limit is reached', async () => {
        const input = createInput();
        mocks.project.mockReturnValue(projection(true));
        mocks.reserveBudget.mockReturnValue({ status: 'hard-limit-reached', reason: 'maxRenderJobs' });

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'The missing section renders exceed the user budget for maxRenderJobs.',
        });
        expect(mocks.updateFollowUp).toHaveBeenCalledWith({
            confirmationId: 'confirmation-retry',
            error: 'The missing section renders exceed the user budget for maxRenderJobs.',
            status: 'retryable',
        });
        expect(mocks.retryRenders).not.toHaveBeenCalled();
        expect(mocks.setGenerating).not.toHaveBeenCalled();
        expect(mocks.reconcileBudget).not.toHaveBeenCalled();
    });

    it('reconciles reserved budget and clears generation after an incomplete retry', async () => {
        const input = createInput();
        mocks.project.mockReturnValue(projection(true));

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'Section render jobs remain incomplete: render-verse',
        });
        expect(mocks.retryRenders).toHaveBeenCalledWith({ jobs: [JOB], sourceRevision: 'revision-source' });
        expect(mocks.reconcileBudget).toHaveBeenCalledWith({
            runId: 'run-retry',
            attemptId: 'render-retry:confirmation-retry:1',
            consumed: 0,
            mode: 'final',
            provenance: 'versioned-estimate',
        });
        expect(mocks.setGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.updateChat).toHaveBeenLastCalledWith(
            'assistant-retry',
            expect.objectContaining({
                pendingActionFollowUpStatus: 'retryable',
                content: expect.stringContaining('project actions remain committed'),
            })
        );
    });

    it('keeps render failure primary and clears generation when budget reconciliation throws', async () => {
        const input = createInput();
        mocks.project.mockReturnValue(projection(true));
        mocks.retryRenders.mockRejectedValue(new Error('renderer unavailable'));
        mocks.reconcileBudget.mockImplementation(() => {
            throw new Error('budget persistence unavailable');
        });

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'renderer unavailable',
        });
        expect(mocks.setGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.updateFollowUp).toHaveBeenLastCalledWith({
            confirmationId: 'confirmation-retry',
            error: 'renderer unavailable',
            status: 'retryable',
        });
        expect(mocks.updateChat).toHaveBeenLastCalledWith(
            'assistant-retry',
            expect.objectContaining({
                error: 'renderer unavailable',
                pendingActionFollowUpStatus: 'retryable',
                content: expect.stringContaining('budget reconciliation could not be persisted'),
            })
        );
        expect(mocks.logError).toHaveBeenCalledOnce();
    });

    it('publishes success after continuation completion when budget reconciliation throws', async () => {
        const input = createInput();
        mocks.project.mockReturnValueOnce(projection(true)).mockReturnValue(projection(false));
        mocks.reconcileBudget.mockImplementation(() => {
            throw new Error('budget persistence unavailable');
        });

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({ status: 'executed' });
        expect(mocks.setGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.completeContinuation.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.updateConfirmation.mock.invocationCallOrder.at(-1) ?? 0
        );
        expect(mocks.updateFollowUp).toHaveBeenLastCalledWith({
            confirmationId: 'confirmation-retry',
            error: null,
            status: 'complete',
        });
        expect(mocks.updateChat).toHaveBeenLastCalledWith(
            'assistant-retry',
            expect.objectContaining({
                error: expect.stringContaining('budget reconciliation could not be persisted'),
                pendingActionFollowUpStatus: 'complete',
            })
        );
        expect(mocks.logError).toHaveBeenCalledOnce();
    });

    it('reconciles the exact completed count for a partial multi-job retry', async () => {
        const input = createInput();
        mocks.project
            .mockReturnValueOnce(projectionForJobs([JOB, SECOND_JOB]))
            .mockReturnValue(projectionForJobs([SECOND_JOB]));

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: 'Section render jobs remain incomplete: render-chorus',
        });
        expect(mocks.reserveBudget).toHaveBeenCalledWith(expect.objectContaining({ estimate: 2 }));
        expect(mocks.reconcileBudget).toHaveBeenCalledWith({
            runId: 'run-retry',
            attemptId: 'render-retry:confirmation-retry:1',
            consumed: 1,
            mode: 'final',
            provenance: 'versioned-estimate',
        });
    });

    it('completes durable continuation before publishing successful retry state', async () => {
        const input = createInput();
        mocks.project.mockReturnValueOnce(projection(true)).mockReturnValue(projection(false));

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({ status: 'executed' });
        expect(mocks.completeContinuation).toHaveBeenCalledWith({
            runId: 'run-retry',
            batchId: 'batch-retry',
            receiptIdentity: `2:run-retry:batch-retry:${input.durableReceipt.outcome}`,
        });
        expect(mocks.completeContinuation.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.updateConfirmation.mock.invocationCallOrder.at(-1) ?? 0
        );
        expect(mocks.setGenerating.mock.calls).toEqual([[true], [false]]);
        expect(mocks.updateChat).toHaveBeenLastCalledWith(
            'assistant-retry',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                pendingActionFollowUpStatus: 'complete',
                content: expect.stringContaining('without replaying project actions'),
            })
        );
    });
});
