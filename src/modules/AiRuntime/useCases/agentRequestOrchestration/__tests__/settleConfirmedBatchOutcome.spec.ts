import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { settleConfirmedBatchOutcome } from '../settleConfirmedBatchOutcome';

const mocks = vi.hoisted(() => ({
    admitRetry: vi.fn(() => ({ status: 'rejected' })),
    createFailure: vi.fn((receipt, reason) => ({
        status: 'failed',
        durableCommit: true,
        reason,
        effects: receipt.pendingEffects,
    })),
    formatReview: vi.fn(() => 'render-a (clipped)'),
    getConfirmation: vi.fn(),
    getLabels: vi.fn(() => new Map()),
    getAffectedIds: vi.fn(() => ['track-a']),
    loggerError: vi.fn(),
    notify: vi.fn(),
    project: vi.fn(),
    pushHistory: vi.fn(),
    recordExecution: vi.fn(),
    recordReceipt: vi.fn(() => ({ warning: null, effectsPending: false })),
    requireManualRepair: vi.fn((..._args: unknown[]): string | null => null),
    updateConfirmation: vi.fn(),
    updateFollowUp: vi.fn(),
    updateMessage: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('../../../stores/aiActionHistoryStore', () => ({ pushAiActionGroup: mocks.pushHistory }));
vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.updateMessage }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getConfirmation,
    recordPendingActionExecution: mocks.recordExecution,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
    updatePendingActionFollowUp: mocks.updateFollowUp,
}));
vi.mock('../../getPlannedActionAffectedIds', () => ({ getPlannedActionAffectedIds: mocks.getAffectedIds }));
vi.mock('../../notifyAiChange', () => ({ notifyAiChange: mocks.notify }));
vi.mock('../admitCommittedSectionRenderRetry', () => ({ admitCommittedSectionRenderRetry: mocks.admitRetry }));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: mocks.createFailure,
        getApprovalLabelsByCommandId: mocks.getLabels,
        recordTrackedAgentRunReceipt: mocks.recordReceipt,
    },
}));
vi.mock('../formatSectionRenderReviewSummary', () => ({ formatSectionRenderReviewSummary: mocks.formatReview }));
vi.mock('../projectSectionRenderConfirmation', () => ({ projectSectionRenderConfirmation: mocks.project }));
vi.mock('../requireSectionRenderManualRepair', () => ({ requireSectionRenderManualRepair: mocks.requireManualRepair }));

type Input = Parameters<typeof settleConfirmedBatchOutcome>[0];

type AddDeviceAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'addDevice' }>;

const addDeviceAction = {
    type: 'addDevice',
    payload: {
        trackId: 'track-a',
        deviceType: 'builtin-compressor',
        deviceId: 'device-compressor',
        expectedDeviceIds: ['device-eq'],
        expectedFrozen: false,
    },
} satisfies AddDeviceAction;

const commandReceipt = {
    commandId: 'command-1',
    schemaVersion: 1,
    applicationAssigned: { ids: [], timestamps: [] },
} as const;

const batchEnvelope = {
    schemaVersion: 1,
    runId: 'run-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    baseRevision: 'revision-1',
    idempotencyKey: 'idempotency-1',
    intent: 'Add an effect',
    mode: 'commit',
    scope: { targetIds: ['track-a'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    preconditions: [],
    commands: [
        {
            schemaVersion: 1,
            commandId: 'command-1',
            issuedAt: 0,
            operation: 'addDevice',
            arguments: addDeviceAction.payload,
            argumentsDigest: 'digest-1',
            groupId: 'group-1',
            dependencyIds: [],
            reason: 'Add an effect',
            expectedEffect: 'A compressor is added.',
            objectReferences: [{ argument: 'trackId', id: 'track-a', scope: 'stable' }],
            time: [],
            parameterUnits: [],
            seed: null,
            normalizedProjectRevision: 'revision-1',
            availableDeviceVersions: {},
            applicationAssignedIds: [],
        },
    ],
    postconditions: [],
    dependencies: [],
    batchLocalBindings: [],
    grants: {
        allowedOperationPrefixes: ['addDevice'],
        create: false,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    },
    budgets: {
        maxCommands: 1,
        maxCreatedTracks: 0,
        maxDeletedObjects: 0,
        maxAffectedTracks: 1,
        maxAffectedClips: 0,
        maxAutomationPoints: 0,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
    },
} satisfies Parameters<typeof createVerifiedBatchReceipt>[0]['envelope'];

function createInput(status: Input['batchResult']['status'], options: { pendingEffect?: boolean } = {}): Input {
    const warning = status.endsWith('warning') ? 'follow-up warning' : undefined;
    const receiptWarning = options.pendingEffect ? 'render still pending' : warning;
    const pendingEffect = options.pendingEffect
        ? {
              commandId: 'command-1',
              kind: 'external-effect' as const,
              operation: 'addDevice' as const,
              reason: 'render still pending',
              remediation: 'manual-repair' as const,
              state: 'pending' as const,
          }
        : undefined;
    const receipt = createVerifiedBatchReceipt({
        contentHash: 'content-hash',
        envelope: batchEnvelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-1',
        result: {
            status,
            actions: [{ action: addDeviceAction, receipt: commandReceipt }],
            ...(receiptWarning ? { warning: receiptWarning } : {}),
            ...(pendingEffect
                ? {
                      warningDetails: [
                          {
                              kind: 'external-effect' as const,
                              message: 'render still pending',
                              commandId: 'command-1',
                              pendingEffect,
                          },
                      ],
                  }
                : {}),
        },
    });
    const confirmation = {
        id: 'confirmation-1',
        runId: 'run-1',
        prompt: 'Add an effect',
        assistantMessageId: 'assistant-1',
        actionLabels: ['Approved effect'],
        affectedIds: ['track-a'],
        protectedUnchanged: [],
        risk: null,
        executedActions: [],
        status: 'proposed',
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: 0,
        resolvedAt: null,
        kind: 'app_actions',
        projectRevision: 'revision-1',
        actions: [addDeviceAction],
        approvalSnapshot: {
            actions: [addDeviceAction],
            actionLabels: ['Approved effect'],
            protectedUnchanged: [],
        },
        executionMode: 'atomic',
        groupId: 'group-1',
        groupLabel: 'Effect',
    } satisfies PendingAppActionConfirmation;
    const batchResult =
        status === 'committed-with-warning' || status === 'executed-with-warning'
            ? {
                  status,
                  actions: [{ action: addDeviceAction, label: 'Generated effect', receipt: commandReceipt }],
                  warning: 'follow-up warning',
                  receipt,
              }
            : {
                  status,
                  actions: [{ action: addDeviceAction, label: 'Generated effect', receipt: commandReceipt }],
                  receipt,
              };
    return {
        confirmation,
        batchResult,
        groupId: 'group-1',
        committedProjectRevision: 'revision-1',
        trackedLeaseSettlement: { accepted: true, warning: null },
        budgetPersistenceWarning: null,
        canRebindSectionRenderArtifacts: true,
        retainCommittedPendingActionResources: vi.fn(),
    } satisfies Input;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockImplementation(({ executions }) => ({
        executions: executions ?? [],
        receipt: 'receipt',
        incompleteSectionRenders: null,
        reviewRequiredSectionRenders: [],
    }));
    mocks.getConfirmation.mockReturnValue(undefined);
    mocks.recordReceipt.mockReturnValue({ warning: null, effectsPending: false });
    mocks.admitRetry.mockReturnValue({ status: 'rejected' });
    mocks.requireManualRepair.mockReturnValue(null);
});

describe('settleConfirmedBatchOutcome', () => {
    it.each([
        ['committed', 'project', undefined],
        ['committed-with-warning', 'project', 'follow-up warning'],
        ['executed', 'runtime', undefined],
        ['executed-with-warning', 'runtime', 'follow-up warning'],
    ] as const)('preserves %s execution kind and warning reporting', async (status, executionKind, warning) => {
        const input = createInput(status);
        const retainResources = vi.fn();
        input.retainCommittedPendingActionResources = retainResources;

        await expect(settleConfirmedBatchOutcome(input)).resolves.toEqual({ status: 'executed' });

        expect(mocks.recordReceipt).toHaveBeenCalledWith(
            input.confirmation,
            input.batchResult.receipt,
            expect.objectContaining({
                completesRun: true,
                committedRevision: 'revision-1',
                ...(executionKind === 'project' ? { revertGroupId: 'group-1' } : {}),
            })
        );
        expect(mocks.recordExecution).toHaveBeenCalledWith(
            expect.objectContaining({
                execution: expect.objectContaining({ executionKind, outcome: status, label: 'Approved effect' }),
            })
        );
        expect(mocks.pushHistory).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'group-1',
                groupId: 'group-1',
                prompt: 'Add an effect',
                executionKind,
                actions: [
                    expect.objectContaining({
                        kind: 'appAction',
                        actionType: 'addDevice',
                        label: 'Approved effect',
                    }),
                ],
            })
        );
        expect(mocks.notify).toHaveBeenCalledWith('Confirmed: Add an effect', ['addDevice']);
        expect(mocks.updateConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'executed', ...(warning ? { error: warning } : {}) })
        );
        expect(mocks.updateMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({ ...(warning ? { error: warning } : {}) })
        );
        const receiptRecordOrder = mocks.recordReceipt.mock.invocationCallOrder[0];
        const resourceRetainOrder = retainResources.mock.invocationCallOrder[0];
        if (receiptRecordOrder === undefined || resourceRetainOrder === undefined) {
            throw new Error('Expected receipt recording and resource transfer to run.');
        }
        expect(receiptRecordOrder).toBeLessThan(resourceRetainOrder);
    });

    it('returns a durable failure while retaining a committed pending effect', async () => {
        const input = createInput('committed-with-warning', { pendingEffect: true });
        mocks.recordReceipt.mockReturnValue({ warning: null, effectsPending: true });

        await expect(settleConfirmedBatchOutcome(input)).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            reason: 'render still pending',
        });

        expect(input.retainCommittedPendingActionResources).toHaveBeenCalledWith('confirmation-1');
        expect(mocks.updateConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', error: 'follow-up warning' })
        );
        expect(mocks.createFailure).toHaveBeenCalledWith(input.batchResult.receipt, 'render still pending');
        expect(mocks.notify).toHaveBeenCalledWith('Committed with pending external effects: Add an effect', [
            'addDevice',
        ]);
    });

    it('arms a retry only for incomplete warned project renders', async () => {
        const input = createInput('committed-with-warning');
        mocks.project.mockReturnValueOnce({ executions: [], receipt: 'receipt' }).mockReturnValueOnce({
            incompleteSectionRenders: { jobs: [{ jobId: 'render-a' }] },
            reviewRequiredSectionRenders: [],
        });
        mocks.admitRetry.mockReturnValue({ status: 'admitted' });

        await settleConfirmedBatchOutcome(input);

        expect(mocks.updateFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'retryable', projectRevision: 'revision-1' })
        );
        expect(mocks.requireManualRepair).not.toHaveBeenCalled();
    });

    it('uses manual repair when retry proof cannot safely follow the committed revision', async () => {
        const input = createInput('committed-with-warning');
        input.canRebindSectionRenderArtifacts = false;
        mocks.project.mockReturnValueOnce({ executions: [], receipt: 'receipt' }).mockReturnValueOnce({
            incompleteSectionRenders: { jobs: [{ jobId: 'render-a' }] },
            reviewRequiredSectionRenders: [],
        });

        await settleConfirmedBatchOutcome(input);

        expect(mocks.requireManualRepair).toHaveBeenCalledWith(
            expect.objectContaining({ batchId: 'batch-1', reason: expect.stringContaining('cannot be retried safely') })
        );
        expect(mocks.updateFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', projectRevision: null })
        );
    });

    it('does not report a persistence failure when review settles during deferred resource retention', async () => {
        const input = createInput('committed-with-warning');
        input.canRebindSectionRenderArtifacts = false;
        let releaseResources: (() => void) | undefined;
        input.retainCommittedPendingActionResources = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    releaseResources = resolve;
                })
        );
        mocks.project.mockReturnValueOnce({ executions: [], receipt: 'receipt' }).mockReturnValueOnce({
            incompleteSectionRenders: { jobs: [{ jobId: 'render-a' }] },
            reviewRequiredSectionRenders: [],
        });
        let reviewSettled = false;
        mocks.requireManualRepair.mockImplementation(() =>
            reviewSettled
                ? null
                : 'The retained render manual-repair state could not be persisted. Do not reconcile or replay this committed batch until durable run state is repaired.'
        );

        const settlement = settleConfirmedBatchOutcome(input);
        expect(mocks.recordReceipt).toHaveBeenCalledOnce();
        expect(input.retainCommittedPendingActionResources).toHaveBeenCalledOnce();
        reviewSettled = true;
        releaseResources?.();

        await expect(settlement).resolves.toEqual({ status: 'executed' });
        expect(mocks.requireManualRepair).toHaveBeenCalledOnce();
        expect(mocks.updateConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'executed',
                error: expect.not.stringContaining('could not be persisted'),
            })
        );
    });

    it('reports the durable outcome if execution reporting throws', async () => {
        const input = createInput('executed');
        mocks.recordExecution.mockImplementation(() => {
            throw new Error('history unavailable');
        });

        await expect(settleConfirmedBatchOutcome(input)).resolves.toEqual({ status: 'executed' });

        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Confirmed AI action reporting failed after execution' })
        );
        expect(mocks.updateMessage).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                content: expect.stringContaining('runtime command executed, but reporting it failed'),
            })
        );
    });
});
