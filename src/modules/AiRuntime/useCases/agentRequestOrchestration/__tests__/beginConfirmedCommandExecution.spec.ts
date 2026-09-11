import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginConfirmedCommandExecution } from '../beginConfirmedCommandExecution';
import { retainedRenderReceipts } from '../retainedRenderReceipts';

import type { createVerifiedBatchReceipt } from '#/modules/Command/useCases';
import type { AgentRenderReceipt } from '#/utils/agentRenderReceipt';
import type { AgentRunWorkLease } from '../../../models/AgentRun';
import type { PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type AdmitAgentRenderReceipt = typeof import('#/modules/Arrangement/useCases').admitAgentRenderReceipt;
type AgentSectionRenderArtifact = ReturnType<
    typeof import('#/modules/AudioRendering/useCases').getAgentSectionRenderArtifacts
>[number];
type FailApprovalPreflight =
    typeof import('../confirmationTerminalSettlement').confirmationTerminalSettlement.failApprovalPreflight;
type InvalidateForProjectChange =
    typeof import('../confirmationTerminalSettlement').confirmationTerminalSettlement.invalidateForProjectChange;
type ValidateAgentRiskApproval = typeof import('../../validateAgentRiskApproval').validateAgentRiskApproval;
type GetPlannedActionAffectedIds = typeof import('../../getPlannedActionAffectedIds').getPlannedActionAffectedIds;
type PendingProtectedTarget = PendingAppActionConfirmation['protectedUnchanged'][number];

const mocks = vi.hoisted(() => ({
    admitReceipt: vi.fn<AdmitAgentRenderReceipt>(),
    captureRevision: vi.fn(() => 'revision-1'),
    claimLease: vi.fn(),
    failPreflight: vi.fn<FailApprovalPreflight>(),
    getAffectedIds: vi.fn<GetPlannedActionAffectedIds>(() => []),
    getArtifacts: vi.fn<() => Pick<AgentSectionRenderArtifact, 'jobId'>[]>(),
    getRun: vi.fn(),
    invalidate: vi.fn<InvalidateForProjectChange>(),
    parseBatch: vi.fn(),
    revisionMatches: vi.fn<(revision: string) => boolean>(),
    reserveBudget: vi.fn(),
    transitionToExecuting: vi.fn(),
    updateConfirmation: vi.fn(),
    updateMessage: vi.fn(),
    validateApproval: vi.fn<ValidateAgentRiskApproval>(() => ({ status: 'valid' })),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    parseVersionedCommandBatchEnvelope: mocks.parseBatch,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({ admitAgentRenderReceipt: mocks.admitReceipt }));
vi.mock('#/modules/AudioRendering/useCases', () => ({ getAgentSectionRenderArtifacts: mocks.getArtifacts }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureRevision,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: mocks.revisionMatches,
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
    confirmationTerminalSettlement: {
        failApprovalPreflight: mocks.failPreflight,
        invalidateForProjectChange: mocks.invalidate,
    },
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
    supersedes: null,
    supersededBy: null,
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

const protectedAction = {
    type: 'setTrackGain',
    payload: { trackId: 'track-protected', gain: 0.8, expectedGain: 1 },
} satisfies PendingAppActionConfirmation['actions'][number];

const protectedTarget = { id: 'track-protected', name: 'Protected track' } satisfies PendingProtectedTarget;

const RENDER_PROVENANCE = {
    jobId: 'job-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 8,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0,
    sourceRevision: 'revision-1',
};

const gatedAction = {
    type: 'bounceSelection',
    payload: {
        trackId: 'track-verse',
        startBeat: RENDER_PROVENANCE.startBeat,
        endBeat: RENDER_PROVENANCE.endBeat,
    },
} satisfies PendingAppActionConfirmation['actions'][number];

const renderedReceipt = {
    phase: 'rendered',
    owner: { runId: 'run-1', workId: 'render-work', leaseId: 'render-lease', cancellationGeneration: 0 },
    provenance: RENDER_PROVENANCE,
    contentAddress: 'content-address-1',
    frameCount: 4,
    channelCount: 2,
    renderedAt: 10,
} satisfies AgentRenderReceipt;

function execute(options: { priorVerifiedBatchReceipt?: CommandVerifiedBatchReceipt | null } = {}) {
    return beginConfirmedCommandExecution({
        confirmation,
        priorVerifiedBatchReceipt: options.priorVerifiedBatchReceipt ?? null,
        recoveringPendingEffects: false,
    });
}

async function expectAuthorizationPreflightFailure(
    currentConfirmation: PendingAppActionConfirmation,
    reason: string
): Promise<void> {
    const result = beginConfirmedCommandExecution({
        confirmation: currentConfirmation,
        priorVerifiedBatchReceipt: null,
        recoveringPendingEffects: false,
    });

    expect(result.status).toBe('settled');
    if (result.status !== 'settled') {
        throw new Error('Expected authorization preflight rejection to settle.');
    }
    await result.result;
    expect(mocks.failPreflight).toHaveBeenCalledWith(currentConfirmation, reason, 'authorization');
    expect(mocks.parseBatch).not.toHaveBeenCalled();
    expect(mocks.reserveBudget).not.toHaveBeenCalled();
    expect(mocks.claimLease).not.toHaveBeenCalled();
    expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    expect(mocks.transitionToExecuting).not.toHaveBeenCalled();
    expect(mocks.updateMessage).not.toHaveBeenCalled();
}

async function createVerifiedRecoveryReceipt(): Promise<CommandVerifiedBatchReceipt> {
    const commandUseCases =
        await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
    const action = { type: 'setTempo', payload: { bpm: 132 } } as const;
    const command = commandUseCases.createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Tempo changes to 132 BPM.',
        groupId: 'batch-verified',
        normalizedProjectRevision: 'revision-1',
        objectReferences: [],
        parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
        reason: 'Apply the confirmed tempo change.',
        time: [],
    });
    const compiled = commandUseCases.compileVersionedCommandBatchEnvelope({
        runId: 'run-verified',
        batchId: 'batch-verified',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: 'Set tempo to 132 BPM.',
        commands: [commandUseCases.serializeVersionedCommandEnvelope(command)],
    });
    const parsed = commandUseCases.parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return commandUseCases.createVerifiedBatchReceipt({
        contentHash: 'verified-recovery-receipt',
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: {
            status: 'committed-with-warning',
            actions: [],
            warning: 'The committed render remains pending.',
            warningDetails: [
                {
                    kind: 'external-effect',
                    message: 'The committed render remains pending.',
                    commandId: command.commandId,
                    pendingEffect: {
                        commandId: command.commandId,
                        operation: 'setTempo',
                        reason: 'The committed render remains pending.',
                        state: 'pending',
                        kind: 'external-effect',
                        remediation: 'reconcile',
                    },
                },
            ],
        },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.admitReceipt.mockReturnValue({ status: 'admitted', action: gatedAction });
    mocks.getArtifacts.mockReturnValue([{ jobId: RENDER_PROVENANCE.jobId }]);
    mocks.getRun.mockReturnValue({ runId: confirmation.runId, cancellation: { generation: 0 } });
    mocks.parseBatch.mockReturnValue(parsedBatch);
    mocks.revisionMatches.mockImplementation((revision) => revision === 'revision-1');
    mocks.reserveBudget.mockReturnValue({ status: 'reserved', estimates: [{ category: 'maxCommands', amount: 1 }] });
    mocks.claimLease.mockReturnValue({ status: 'claimed', lease });
    mocks.failPreflight.mockResolvedValue({ status: 'failed', reason: 'preflight failed' });
    mocks.invalidate.mockResolvedValue({
        status: 'invalidated',
        reason: 'The project changed after this proposal was created. Review and submit the command again.',
    });
});

describe('beginConfirmedCommandExecution', () => {
    it('should settle approval failures before parsing, budget reservation, lease claim, or accepted writes', async () => {
        mocks.validateApproval.mockReturnValueOnce({
            status: 'invalid',
            reason: 'approval is stale',
            stale: false,
        });

        const result = execute();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected approval rejection to settle.');
        }
        await expect(result.result).resolves.toEqual({ status: 'failed', reason: 'preflight failed' });
        expect(mocks.failPreflight).toHaveBeenCalledWith(confirmation, 'approval is stale', 'authorization');
        expect(mocks.invalidate).not.toHaveBeenCalled();
        expect(mocks.parseBatch).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
    });

    it('settles a stale-proposal approval rejection as invalidated with the guard reason kept as internal detail', async () => {
        mocks.validateApproval.mockReturnValueOnce({
            status: 'invalid',
            reason: 'The approved source revision is stale.',
            stale: true,
        });
        mocks.invalidate.mockResolvedValueOnce({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
            detail: 'The approved source revision is stale.',
        });

        const result = execute();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected the stale-proposal rejection to settle.');
        }
        await expect(result.result).resolves.toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
            detail: 'The approved source revision is stale.',
        });
        expect(mocks.invalidate).toHaveBeenCalledWith(confirmation, 'The approved source revision is stale.');
        expect(mocks.failPreflight).not.toHaveBeenCalled();
        expect(mocks.parseBatch).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.transitionToExecuting).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
    });

    it('keeps a genuine approval rejection that is not stale-shaped on the failed preflight disposition', async () => {
        mocks.validateApproval.mockReturnValueOnce({
            status: 'invalid',
            reason: 'The approved action hashes no longer match.',
            stale: false,
        });

        await expectAuthorizationPreflightFailure(confirmation, 'The approved action hashes no longer match.');
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('validates approval against the confirmed revision when only the command checkpoint drifted', () => {
        mocks.captureRevision.mockReturnValueOnce('revision-with-checkpoint-drift');
        mocks.revisionMatches.mockImplementationOnce((revision) => revision === confirmation.projectRevision);

        const result = execute();

        expect(result.status).toBe('ready');
        expect(mocks.revisionMatches).toHaveBeenCalledWith(confirmation.projectRevision);
        expect(mocks.validateApproval).toHaveBeenCalledWith(
            expect.objectContaining({ currentRevision: confirmation.projectRevision })
        );
        expect(mocks.captureRevision).not.toHaveBeenCalled();
    });

    it('should settle a confirmation without an exact risk approval binding before admission continues', async () => {
        const confirmationWithoutApproval = {
            ...confirmation,
            approvalSnapshot: { ...confirmation.approvalSnapshot, agentApproval: undefined },
        } satisfies PendingAppActionConfirmation;

        await expectAuthorizationPreflightFailure(
            confirmationWithoutApproval,
            'The command batch has no exact risk approval binding.'
        );
    });

    it('should settle immutable proposal drift that does not target a protected current object', async () => {
        const driftedConfirmation = {
            ...confirmation,
            actionLabels: ['A changed action label'],
        } satisfies PendingAppActionConfirmation;

        await expectAuthorizationPreflightFailure(
            driftedConfirmation,
            'The executable action batch no longer matches the approved proposal.'
        );
    });

    it('should settle an approved snapshot that targets a protected object', async () => {
        const protectedConfirmation = {
            ...confirmation,
            actions: [protectedAction],
            protectedUnchanged: [protectedTarget],
            approvalSnapshot: {
                ...confirmation.approvalSnapshot,
                actions: [protectedAction],
                protectedUnchanged: [protectedTarget],
            },
        } satisfies PendingAppActionConfirmation;
        mocks.getAffectedIds.mockReturnValueOnce([]).mockReturnValueOnce([protectedTarget.id]);

        await expectAuthorizationPreflightFailure(
            protectedConfirmation,
            'The approved action batch targets protected IDs: track-protected.'
        );
    });

    it.each([
        [
            'missing batch',
            () => ({
                ...confirmation,
                approvalSnapshot: { ...confirmation.approvalSnapshot, commandBatch: undefined },
            }),
            'The confirmation has no approved command batch.',
            'authorization',
        ],
        ['invalid batch', () => confirmation, 'bad batch schema', 'schema'],
    ])(
        'should settle %s before command execution admission continues',
        async (name, createConfirmation, reason, category) => {
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
            expect(mocks.failPreflight).toHaveBeenCalledWith(currentConfirmation, reason, category);
            expect(mocks.claimLease).not.toHaveBeenCalled();
            expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        }
    );

    it('should settle verified-receipt recovery when its approved command batch is absent', async () => {
        const priorVerifiedBatchReceipt = await createVerifiedRecoveryReceipt();
        const confirmationWithoutBatch = {
            ...confirmation,
            approvalSnapshot: { ...confirmation.approvalSnapshot, commandBatch: undefined },
        } satisfies PendingAppActionConfirmation;

        const result = beginConfirmedCommandExecution({
            confirmation: confirmationWithoutBatch,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: true,
        });

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected verified-receipt recovery without a batch to settle.');
        }
        await result.result;
        expect(mocks.failPreflight).toHaveBeenCalledWith(
            confirmationWithoutBatch,
            'The confirmation has no approved command batch.',
            'authorization'
        );
        expect(mocks.validateApproval).not.toHaveBeenCalled();
        expect(mocks.parseBatch).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.transitionToExecuting).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
    });

    it('should settle verified-receipt recovery when its approved command batch is invalid', async () => {
        const priorVerifiedBatchReceipt = await createVerifiedRecoveryReceipt();
        mocks.parseBatch.mockReturnValueOnce({ status: 'invalid', reason: 'recovery batch schema is invalid' });

        const result = beginConfirmedCommandExecution({
            confirmation,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: true,
        });

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected verified-receipt recovery with an invalid batch to settle.');
        }
        await result.result;
        expect(mocks.failPreflight).toHaveBeenCalledWith(confirmation, 'recovery batch schema is invalid', 'schema');
        expect(mocks.validateApproval).not.toHaveBeenCalled();
        expect(mocks.parseBatch).toHaveBeenCalledWith(commandBatch.serialized, commandBatch.authority);
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).not.toHaveBeenCalled();
        expect(mocks.transitionToExecuting).not.toHaveBeenCalled();
        expect(mocks.updateMessage).not.toHaveBeenCalled();
    });

    it('should settle a hard command budget limit without claiming work or accepting the confirmation', async () => {
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

    it('should settle a work-lease conflict without accepting the confirmation', async () => {
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

    it('should admit untracked work without budgeting or claiming a lease', () => {
        mocks.getRun.mockReturnValueOnce(undefined);

        const result = execute();

        expect(result).toMatchObject({
            status: 'ready',
            confirmation,
            commandBatch,
            approvedBatchId: 'batch-1',
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
        expect(mocks.parseBatch).toHaveBeenCalledWith(commandBatch.serialized, commandBatch.authority);
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'accepted',
            content: 'Confirming:\n\n- Add an effect',
        });
    });

    it('should return ordinary admission synchronously after reserving budget, claiming work, and writing accepted state', () => {
        const result = execute();

        expect(result).toMatchObject({
            status: 'ready',
            confirmation,
            commandBatch,
            approvedBatchId: 'batch-1',
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

    it('should bypass approval, budget, and lease work for an already verified batch while admitting recovered execution', async () => {
        const priorVerifiedBatchReceipt = await createVerifiedRecoveryReceipt();
        expect(priorVerifiedBatchReceipt).toMatchObject({
            schemaVersion: 2,
            runId: 'run-verified',
            batchId: 'batch-verified',
            outcome: 'partially-committed',
            pendingEffects: [
                {
                    commandId: priorVerifiedBatchReceipt.commandOutcomes[0]?.commandId,
                    operation: 'setTempo',
                    state: 'pending',
                    kind: 'external-effect',
                    remediation: 'reconcile',
                },
            ],
        });

        const result = beginConfirmedCommandExecution({
            confirmation,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: true,
        });

        expect(result).toMatchObject({
            status: 'ready',
            commandBatch,
            approvedBatchId: 'batch-1',
            trackedWorkLease: null,
            commandBudget: null,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: true,
        });
        expect(mocks.validateApproval).not.toHaveBeenCalled();
        expect(mocks.parseBatch).toHaveBeenCalledWith(commandBatch.serialized, commandBatch.authority);
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
        expect(mocks.updateConfirmation).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', status: 'accepted' });
        expect(mocks.transitionToExecuting).toHaveBeenCalledWith(confirmation);
        expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'accepted',
            content: 'Confirming:\n\n- Add an effect',
        });
    });
});

describe('render receipt admission', () => {
    const rejectionPrefix = `Rendered section ${RENDER_PROVENANCE.jobId} no longer admits bounceSelection`;

    const gatedConfirmation = {
        ...confirmation,
        actions: [gatedAction],
        approvalSnapshot: { ...confirmation.approvalSnapshot, actions: [gatedAction] },
    } satisfies PendingAppActionConfirmation;

    function beginGatedExecution(priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null = null) {
        return beginConfirmedCommandExecution({
            confirmation: gatedConfirmation,
            priorVerifiedBatchReceipt,
            recoveringPendingEffects: false,
        });
    }

    afterEach(() => {
        retainedRenderReceipts.releaseRun(gatedConfirmation.runId);
    });

    it('settles a retained receipt the live revision has moved past as invalidated, keeping the adapter reason as detail', async () => {
        retainedRenderReceipts.retain(gatedConfirmation.runId, renderedReceipt);
        mocks.admitReceipt.mockReturnValue({ status: 'rejected', reason: 'stale-revision' });

        const result = beginGatedExecution();

        expect(result.status).toBe('settled');
        if (result.status !== 'settled') {
            throw new Error('Expected the stale render receipt to settle.');
        }
        await result.result;
        expect(mocks.invalidate).toHaveBeenCalledWith(gatedConfirmation, `${rejectionPrefix} (stale-revision)`);
        expect(mocks.failPreflight).not.toHaveBeenCalled();
        expect(mocks.reserveBudget).not.toHaveBeenCalled();
        expect(mocks.claimLease).not.toHaveBeenCalled();
    });

    it('settles a retained receipt whose artifact shape differs as an authorization preflight failure', async () => {
        retainedRenderReceipts.retain(gatedConfirmation.runId, renderedReceipt);
        mocks.admitReceipt.mockReturnValue({ status: 'rejected', reason: 'artifact-shape-mismatch' });

        await expectAuthorizationPreflightFailure(gatedConfirmation, `${rejectionPrefix} (artifact-shape-mismatch)`);

        expect(mocks.invalidate).not.toHaveBeenCalled();
    });

    it('releases a retained receipt whose rendered artifact is gone and leaves the mutation ordinary', () => {
        retainedRenderReceipts.retain(gatedConfirmation.runId, renderedReceipt);
        mocks.getArtifacts.mockReturnValue([]);

        const result = beginGatedExecution();

        expect(result).toMatchObject({ status: 'ready' });
        expect(retainedRenderReceipts.getRetained(gatedConfirmation.runId)).toEqual([]);
        expect(mocks.admitReceipt).not.toHaveBeenCalled();
    });

    it('never consults the adapter when a prior verified batch receipt already carries this work', async () => {
        retainedRenderReceipts.retain(gatedConfirmation.runId, renderedReceipt);
        mocks.admitReceipt.mockReturnValue({ status: 'rejected', reason: 'stale-revision' });

        const result = beginGatedExecution(await createVerifiedRecoveryReceipt());

        expect(result).toMatchObject({ status: 'ready' });
        expect(mocks.admitReceipt).not.toHaveBeenCalled();
        expect(mocks.invalidate).not.toHaveBeenCalled();
        expect(mocks.failPreflight).not.toHaveBeenCalled();
    });
});
