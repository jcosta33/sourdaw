import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    issueCommandApprovalBinding,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
    type executeVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunWorkLease } from '../../../models/AgentRun';
import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { executeConfirmedCommandBatch } from '../executeConfirmedCommandBatch';

type ExecuteBatch = typeof executeVersionedCommandBatchEnvelope;
type ApprovalBindingIssuer = typeof import('../../issueAgentCommandApprovalBinding').issueAgentCommandApprovalBinding;
type PrepareResourceLease =
    typeof import('../../../stores/pendingActionConfirmationStore').preparePendingActionResourceLeaseForCommit;
type ProtectResourceLease =
    typeof import('../../../stores/pendingActionConfirmationStore').protectPendingActionResourceLease;
type PrepareContinuation =
    typeof import('../../prepareAgentRunPendingEffectContinuation').prepareAgentRunPendingEffectContinuation;
type BindCancellation = typeof import('../../cancelAgentRun').agentRunCancellation.bindAbortController;
type CancelRun = typeof import('../../cancelAgentRun').agentRunCancellation.cancel;
type CaptureAuthorization = typeof import('#/modules/CrdtDocument/useCases').captureProjectMutationAuthorization;
type CaptureUnownedMutations = typeof import('#/modules/CrdtDocument/useCases').captureUnownedProjectMutations;

const mocks = vi.hoisted(() => ({
    bindCancellation: vi.fn<BindCancellation>(),
    cancelRun: vi.fn<CancelRun>(),
    captureAuthorization: vi.fn<CaptureAuthorization>(),
    captureUnownedMutations: vi.fn<CaptureUnownedMutations>(),
    executeBatch: vi.fn<ExecuteBatch>(),
    getArtifacts: vi.fn(() => []),
    issueApprovalBinding: vi.fn<ApprovalBindingIssuer>(),
    prepareContinuation: vi.fn<PrepareContinuation>(),
    prepareResourceLease: vi.fn<PrepareResourceLease>(),
    protectResourceLease: vi.fn<ProtectResourceLease>(),
    retainCommitted: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    updateConfirmation: vi.fn(),
    updateMessage: vi.fn(),
}));

const collaboration = vi.hoisted(() => ({ value: undefined as { localPeerId: string } | undefined }));

vi.mock('#/modules/AudioRendering/useCases', () => ({ getAgentSectionRenderArtifacts: mocks.getArtifacts }));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: collaboration }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeVersionedCommandBatchEnvelope: mocks.executeBatch,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectMutationAuthorization: mocks.captureAuthorization,
    captureUnownedProjectMutations: mocks.captureUnownedMutations,
}));
vi.mock('../../../stores/chatStore', () => ({
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateMessage,
}));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    preparePendingActionResourceLeaseForCommit: mocks.prepareResourceLease,
    protectPendingActionResourceLease: mocks.protectResourceLease,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
}));
vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: {
        bindAbortController: mocks.bindCancellation,
        cancel: mocks.cancelRun,
    },
}));
vi.mock('../../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));
vi.mock('../../prepareAgentRunPendingEffectContinuation', () => ({
    prepareAgentRunPendingEffectContinuation: mocks.prepareContinuation,
}));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: vi.fn((receipt, reason) => ({
            status: 'committed-effect-failed',
            receipt,
            reason,
        })),
    },
}));
vi.mock('../pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: { retainCommitted: mocks.retainCommitted },
}));

const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies AppAction;
const command = createVersionedCommandEnvelope({
    action,
    availableDeviceVersions: {},
    expectedEffect: 'Tempo changes to 132 BPM.',
    normalizedProjectRevision: 'revision-1',
    objectReferences: [],
    parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
    reason: 'Apply the confirmed tempo change.',
    time: [],
});
const commandBatch = compileVersionedCommandBatchEnvelope({
    runId: 'run-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    baseRevision: 'revision-1',
    intent: 'Set tempo to 132 BPM.',
    commands: [serializeVersionedCommandEnvelope(command)],
});
const parsedBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
if (parsedBatch.status === 'invalid') {
    throw new Error(parsedBatch.reason);
}
const receipt = createVerifiedBatchReceipt({
    contentHash: 'receipt-1',
    envelope: parsedBatch.envelope,
    observedBaseRevision: 'revision-1',
    resultingRevision: 'revision-2',
    result: { status: 'committed', actions: [] },
});
const completedBatchResult = { status: 'committed' as const, actions: [], receipt };

function createNonDurableReceipt(status: 'no-op' | 'cancelled' | 'ambiguous' | 'failed') {
    return createVerifiedBatchReceipt({
        contentHash: `receipt-${status}`,
        envelope: parsedBatch.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: {
            status,
            actions: [],
            reason: `The prior batch was ${status}.`,
        },
    });
}

const confirmation = {
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Set tempo to 132 BPM.',
    assistantMessageId: 'assistant-1',
    actions: [action],
    actionLabels: ['Set tempo to 132 BPM'],
    affectedIds: [],
    protectedUnchanged: [],
    risk: null,
    executedActions: [],
    status: 'accepted',
    error: null,
    followUpProjectRevision: null,
    followUpStatus: null,
    createdAt: 0,
    resolvedAt: null,
    kind: 'app_actions',
    projectRevision: 'revision-1',
    approvalSnapshot: {
        actions: [action],
        actionLabels: ['Set tempo to 132 BPM'],
        commandBatch,
        agentApproval: {
            schemaVersion: 1,
            actionHashes: [],
            sourceRevision: 'revision-1',
            targetFingerprints: {},
            advertisedTargetFingerprints: {},
            consequences: {
                audioUpload: false,
                fileAccess: false,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
                remoteGeneration: false,
            },
            localActorId: 'actor-1',
            policy: {
                decision: 'confirm',
                reasons: [],
                requiredTrustMode: 'apply-reversible',
                risk: 'bounded-reversible',
            },
        },
        protectedUnchanged: [],
    },
    executionMode: 'atomic',
    groupId: 'group-1',
    groupLabel: 'Set tempo',
} satisfies PendingAppActionConfirmation;

const lease = {
    leaseId: 'lease-1',
    runId: 'run-1',
    workId: 'batch-1',
    attempt: 1,
    ownerKind: 'command',
    cancellationGeneration: 0,
    idempotencyKey: 'idempotency-1',
    receiptIdentity: 'command:run-1:batch-1',
    cleanupOwner: 'command-executor',
    idempotent: true,
    retriable: false,
    claimedAt: 0,
    terminalState: null,
    settledAt: null,
} satisfies AgentRunWorkLease;

let projectMutationAuthorized = true;

function execute(
    options: {
        trackedWorkLease?: AgentRunWorkLease | null;
        priorVerifiedBatchReceipt?: typeof receipt | null;
        recoveringPendingEffects?: boolean;
    } = {}
) {
    return executeConfirmedCommandBatch({
        confirmation,
        commandBatch,
        trackedWorkLease: options.trackedWorkLease === undefined ? lease : options.trackedWorkLease,
        priorVerifiedBatchReceipt: options.priorVerifiedBatchReceipt ?? null,
        recoveringPendingEffects: options.recoveringPendingEffects ?? false,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    collaboration.value = { localPeerId: 'actor-1' };
    projectMutationAuthorized = true;
    mocks.captureAuthorization.mockReturnValue(() => projectMutationAuthorized);
    mocks.captureUnownedMutations.mockReturnValue(4);
    mocks.prepareResourceLease.mockResolvedValue(undefined);
    mocks.protectResourceLease.mockReturnValue(undefined);
    mocks.prepareContinuation.mockReturnValue({ promote: () => undefined, discard: () => undefined });
    mocks.issueApprovalBinding.mockImplementation(({ commandBatch: approvedBatch }) =>
        issueCommandApprovalBinding({
            authority: approvedBatch.authority,
            serialized: approvedBatch.serialized,
            validate: () => ({ status: 'valid' }),
        })
    );
    mocks.bindCancellation.mockReturnValue(vi.fn());
    mocks.cancelRun.mockResolvedValue({
        status: 'cancelled',
        phase: 'cancelled',
        cancelledWorkIds: [],
        cleanupPendingAssetIds: [],
        releasedAssetIds: [],
    });
    mocks.retainCommitted.mockResolvedValue(undefined);
    mocks.executeBatch.mockResolvedValue(completedBatchResult);
});

describe('executeConfirmedCommandBatch', () => {
    it('should wire the confirmed batch through prepared resources, protection, and exact executor options', async () => {
        const events: string[] = [];
        const releaseCancellation = vi.fn(() => events.push('release-cancellation'));
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        mocks.prepareResourceLease.mockImplementation(async () => {
            events.push('prepare');
        });
        mocks.protectResourceLease.mockImplementation(() => {
            events.push('protect');
        });
        mocks.executeBatch.mockImplementation(async (input) => {
            events.push('execute');
            input.options?.onDeferredEffectAttempt?.({ operation: 'renderProjectSections' });
            input.options?.onDeferredEffectAttempt?.({ operation: 'other' });
            input.onProjectCommitPrepared?.();
            input.options?.onProjectCommitCheckpoint?.({ receipt });
            return completedBatchResult;
        });

        const result = await execute();

        expect(result).toMatchObject({
            status: 'completed',
            batchResult: completedBatchResult,
            group: { groupId: 'group-1', groupLabel: 'Set tempo' },
            renderJobAttempts: 1,
            cancellationTriggeredByInvalidation: false,
            abortSignal: expect.objectContaining({ aborted: false }),
        });
        expect(mocks.prepareResourceLease).toHaveBeenCalledWith('confirmation-1', commandBatch);
        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({
            approval: confirmation.approvalSnapshot.agentApproval,
            commandBatch,
        });
        expect(mocks.executeBatch).toHaveBeenCalledWith({
            authority: commandBatch.authority,
            approvalBinding: expect.any(Object),
            serialized: commandBatch.serialized,
            onProjectCommitPrepared: expect.any(Function),
            options: expect.objectContaining({
                groupId: 'group-1',
                groupLabel: 'Set tempo',
                source: 'prompt',
                requireCompensation: true,
                signal: expect.any(AbortSignal),
            }),
        });
        expect(mocks.prepareContinuation).toHaveBeenCalledWith({ runId: 'run-1', receipt, commandBatch });
        expect(events).toEqual(['prepare', 'execute', 'protect', 'release-cancellation']);
        const boundController = mocks.bindCancellation.mock.calls[0]?.[0].controller;
        expect(mocks.bindCancellation).toHaveBeenCalledWith({
            runId: 'run-1',
            lease,
            controller: boundController,
            reason: 'User cancelled the run while confirmed command execution was active.',
        });
        expect(mocks.setActiveAborter).toHaveBeenNthCalledWith(1, boundController);
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenNthCalledWith(1, true);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });

    it.each([
        {
            name: 'actor changes',
            configure: () => {
                collaboration.value = { localPeerId: 'actor-2' };
            },
        },
        {
            name: 'the abort controller is aborted',
            configure: () => {
                const controller = mocks.setActiveAborter.mock.calls[0]?.[0];
                if (!(controller instanceof AbortController)) {
                    throw new Error('Expected the active abort controller.');
                }
                controller.abort();
            },
        },
        {
            name: 'a foreign project mutation invalidates authorization',
            configure: () => {
                projectMutationAuthorized = false;
            },
        },
    ])('should refuse execution when $name', async ({ configure }) => {
        mocks.executeBatch.mockImplementation(async (input) => {
            configure();
            expect(input.options?.shouldExecute?.()).toBe(false);
            return { status: 'cancelled', reason: 'execution refused', actions: [] };
        });

        const result = await execute();

        expect(result).toMatchObject({ status: 'completed', batchResult: { status: 'cancelled' } });
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'resource preparation fails',
            configure: () => mocks.prepareResourceLease.mockRejectedValue(new Error('resource preparation failed')),
        },
        {
            name: 'the command executor fails',
            configure: () => mocks.executeBatch.mockRejectedValue(new Error('command execution failed')),
        },
    ])('should clean up and return the error to the adapter when $name', async ({ configure }) => {
        const releaseCancellation = vi.fn();
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        configure();

        const result = await execute();

        expect(result).toMatchObject({ status: 'failed' });
        expect(releaseCancellation).toHaveBeenCalledOnce();
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
        expect(mocks.retainCommitted).not.toHaveBeenCalled();
    });

    it('should omit a fresh approval binding and preserve durable state during verified receipt recovery', async () => {
        const result = await execute({
            trackedWorkLease: null,
            priorVerifiedBatchReceipt: receipt,
            recoveringPendingEffects: true,
        });

        expect(result).toMatchObject({ status: 'completed', batchResult: completedBatchResult });
        expect(mocks.issueApprovalBinding).not.toHaveBeenCalled();
        expect(mocks.bindCancellation).not.toHaveBeenCalled();
        expect(mocks.cancelRun).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
        expect(mocks.retainCommitted).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'resource preparation rejects before replay completes',
            configure: () =>
                mocks.prepareResourceLease.mockRejectedValue(new Error('pending-effect continuation failed')),
            recoveringPendingEffects: false,
        },
        {
            name: 'the command executor rejects during pending-effect recovery',
            configure: () => mocks.executeBatch.mockRejectedValue(new Error('pending-effect continuation failed')),
            recoveringPendingEffects: true,
        },
    ])('should retain durable receipt resources when $name', async ({ configure, recoveringPendingEffects }) => {
        const releaseCancellation = vi.fn();
        mocks.bindCancellation.mockReturnValue(releaseCancellation);
        configure();

        const result = await execute({ priorVerifiedBatchReceipt: receipt, recoveringPendingEffects });

        expect(result).toMatchObject({ status: 'recovery-failed' });
        expect(mocks.retainCommitted).toHaveBeenCalledWith('confirmation-1');
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'pending-effect continuation failed',
        });
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'failed',
            error: 'pending-effect continuation failed',
            content:
                'The project change remains durably committed, but pending-effect reconciliation could not continue: pending-effect continuation failed',
        });
        expect(releaseCancellation).toHaveBeenCalledOnce();
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });

    it.each(['no-op', 'cancelled', 'ambiguous', 'failed'] as const)(
        'should return ordinary failure for a non-durable prior $status receipt',
        async (status) => {
            mocks.prepareResourceLease.mockRejectedValue(new Error('resource preparation failed'));

            const result = await execute({
                priorVerifiedBatchReceipt: createNonDurableReceipt(status),
                recoveringPendingEffects: true,
            });

            expect(result).toMatchObject({ status: 'failed' });
            expect(mocks.retainCommitted).not.toHaveBeenCalled();
            expect(mocks.updateConfirmation).not.toHaveBeenCalled();
            expect(mocks.updateMessage).not.toHaveBeenCalled();
        }
    );

    it('should release preview resources and return the exact preview-mode failure', async () => {
        const resource = { release: vi.fn() };
        mocks.executeBatch.mockResolvedValue({ status: 'previewed', resource });

        const result = await execute();

        expect(resource.release).toHaveBeenCalledOnce();
        expect(result).toEqual({
            status: 'failed',
            error: new Error('A confirmed command batch cannot execute in preview mode'),
        });
        expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
    });
});
