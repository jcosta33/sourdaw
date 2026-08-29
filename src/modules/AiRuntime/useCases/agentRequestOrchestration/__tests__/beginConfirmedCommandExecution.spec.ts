import { beforeEach, describe, expect, it, vi } from 'vitest';

import { beginConfirmedCommandExecution } from '../beginConfirmedCommandExecution';

import type { AgentRunWorkLease } from '../../../models/AgentRun';
import type { PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';

const mocks = vi.hoisted(() => ({
    captureRevision: vi.fn(() => 'revision-1'),
    claimLease: vi.fn(),
    failPreflight: vi.fn(),
    getAffectedIds: vi.fn(() => []),
    getRun: vi.fn(),
    parseBatch: vi.fn(),
    reserveBudget: vi.fn(),
    transitionToExecuting: vi.fn(),
    updateConfirmation: vi.fn(),
    updateMessage: vi.fn(),
    validateApproval: vi.fn(() => ({ status: 'valid' })),
}));

vi.mock('#/modules/Command/useCases', () => ({
    parseVersionedCommandBatchEnvelope: mocks.parseBatch,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureRevision,
}));
vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.updateMessage }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
}));
vi.mock('../../agentRunLifecycle', () => ({ agentRunLifecycle: { get: mocks.getRun } }));
vi.mock('../../agentRunWorkLease', () => ({ agentRunWorkLease: { claim: mocks.claimLease } }));
vi.mock('../../agentWorkBudget', () => ({ agentWorkBudget: { reserveCommandWork: mocks.reserveBudget } }));
vi.mock('../../getPlannedActionAffectedIds', () => ({ getPlannedActionAffectedIds: mocks.getAffectedIds }));
vi.mock('../../validateAgentRiskApproval', () => ({ validateAgentRiskApproval: mocks.validateApproval }));
vi.mock('../agentRunExecutionSettlement', () => ({
    agentRunExecutionSettlement: { transitionToExecuting: mocks.transitionToExecuting },
}));
vi.mock('../confirmationTerminalSettlement', () => ({
    confirmationTerminalSettlement: { failApprovalPreflight: mocks.failPreflight },
}));

const commandBatch = {
    serialized: 'batch-serialized',
    authority: {
        projectId: 'project-1',
        baseRevision: 'revision-1',
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: [],
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
            maxAffectedTracks: 0,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    },
} satisfies NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;

const confirmation = {
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Add an effect',
    assistantMessageId: 'assistant-1',
    actionLabels: ['Add an effect'],
    affectedIds: [],
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
    actions: [],
    approvalSnapshot: {
        actions: [],
        actionLabels: ['Add an effect'],
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
            localActorId: 'standalone',
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
    groupLabel: 'Add an effect',
} satisfies PendingAppActionConfirmation;

const parsedBatch = {
    status: 'valid' as const,
    envelope: {
        batchId: 'batch-1',
        idempotencyKey: 'idempotency-1',
        commands: [],
    },
};

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

function execute(options: { priorVerifiedBatchReceipt?: object | null } = {}) {
    return beginConfirmedCommandExecution({
        confirmation,
        priorVerifiedBatchReceipt: (options.priorVerifiedBatchReceipt ?? null) as never,
        recoveringPendingEffects: false,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRun.mockReturnValue({ runId: confirmation.runId });
    mocks.parseBatch.mockReturnValue(parsedBatch);
    mocks.reserveBudget.mockReturnValue({ status: 'reserved', estimates: [{ category: 'maxCommands', amount: 1 }] });
    mocks.claimLease.mockReturnValue({ status: 'claimed', lease });
    mocks.failPreflight.mockResolvedValue({ status: 'failed', reason: 'preflight failed' });
});

describe('beginConfirmedCommandExecution', () => {
    it('settles approval failures before parsing, budget reservation, lease claim, or accepted writes', async () => {
        mocks.validateApproval.mockReturnValueOnce({ status: 'invalid', reason: 'approval is stale' });

        const result = execute();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected approval rejection to settle.');
        }
        await expect(result.result).resolves.toEqual({ status: 'failed', reason: 'preflight failed' });
        expect(mocks.failPreflight).toHaveBeenCalledWith(confirmation, 'approval is stale', 'authorization');
        expect(mocks.parseBatch).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    });

    it.each([
        [
            'missing batch',
            () => ({
                ...confirmation,
                approvalSnapshot: { ...confirmation.approvalSnapshot, commandBatch: undefined },
            }),
        ],
        ['invalid batch', () => confirmation],
    ])('settles %s before command execution admission continues', async (name, createConfirmation) => {
        const currentConfirmation = createConfirmation();
        if (name === 'invalid batch') {
            mocks.parseBatch.mockReturnValueOnce({ status: 'invalid', reason: 'bad batch schema' });
        }

        const result = beginConfirmedCommandExecution({
            confirmation: currentConfirmation,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected batch rejection to settle.');
        }
        await result.result;
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    });

    it('settles a hard command budget limit without claiming work or accepting the confirmation', async () => {
        mocks.reserveBudget.mockReturnValueOnce({ status: 'hard-limit-reached', reason: 'maxCommands', estimates: [] });

        const result = execute();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected budget rejection to settle.');
        }
        await result.result;
        expect(mocks.failPreflight).toHaveBeenCalledWith(
            confirmation,
            'The confirmed command work exceeds the user budget for maxCommands.',
            'budget'
        );
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    });

    it('settles a work-lease conflict without accepting the confirmation', async () => {
        mocks.claimLease.mockReturnValueOnce({ status: 'already-claimed' });

        const result = execute();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected lease conflict to settle.');
        }
        await result.result;
        expect(mocks.failPreflight).toHaveBeenCalledWith(
            confirmation,
            'The confirmed command work could not be claimed: already-claimed',
            'conflict'
        );
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    });

    it('admits untracked work without budgeting or claiming a lease', () => {
        mocks.getRun.mockReturnValueOnce(undefined);

        const result = execute();

        expect(result).toMatchObject({
            status: 'ready',
            confirmation,
            commandBatch,
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
        expect(mocks.parseBatch).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
    });

    it('returns ordinary admission synchronously after reserving budget, claiming work, and writing accepted state', () => {
        const result = execute();

        expect(result).toMatchObject({
            status: 'ready',
            confirmation,
            commandBatch,
            trackedWorkLease: lease,
            commandBudget: { attemptId: 'batch-1:1', estimates: [{ category: 'maxCommands', amount: 1 }] },
        });
        expect(result).not.toBeInstanceOf(Promise);
        expect(mocks.reserveBudget).toHaveBeenCalledWith({
            runId: 'run-1',
            envelope: parsedBatch.envelope,
            attemptId: 'batch-1:1',
        });
        expect(mocks.claimLease).toHaveBeenCalledWith({
            runId: 'run-1',
            workId: 'batch-1',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'idempotency-1',
            receiptIdentity: 'command:run-1:batch-1',
            idempotent: true,
            retriable: false,
        });
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', status: 'accepted' });
        expect(mocks.transitionToExecuting).toHaveBeenCalledWith(confirmation);
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'accepted',
            content: 'Confirming:\n\n- Add an effect',
        });
        const claimOrder = mocks.claimLease.mock.invocationCallOrder[0];
        const acceptedOrder = mocks.updateConfirmation.mock.invocationCallOrder[0];
        if (claimOrder === undefined || acceptedOrder === undefined) {
            throw new Error('Expected synchronous lease claim and acceptance writes.');
        }
        expect(claimOrder).toBeLessThan(acceptedOrder);
    });

    it('bypasses approval, budget, and lease work for an already verified batch while admitting recovered execution', () => {
        const priorVerifiedBatchReceipt = { outcome: 'partially-committed', pendingEffects: [{}] };

        const result = beginConfirmedCommandExecution({
            confirmation,
            priorVerifiedBatchReceipt: priorVerifiedBatchReceipt as never,
            recoveringPendingEffects: true,
        });

        expect(result).toMatchObject({
            status: 'ready',
            commandBatch,
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: true,
        });
        expect(mocks.validateApproval).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', status: 'accepted' });
        expect(mocks.transitionToExecuting).toHaveBeenCalledWith(confirmation);
    });
});
