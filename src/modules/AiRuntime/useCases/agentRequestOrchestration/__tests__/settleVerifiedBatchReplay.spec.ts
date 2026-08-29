import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { settleVerifiedBatchReplay } from '../settleVerifiedBatchReplay';

const mocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    createFailure: vi.fn((receipt, reason) => ({
        status: 'failed',
        durableCommit: true,
        reason,
        effects: receipt.pendingEffects,
    })),
    disposition: vi.fn(),
    getReplay: vi.fn(),
    message: vi.fn(),
    recordFailure: vi.fn(),
    recordReceipt: vi.fn(() => ({ warning: null, effectsPending: false })),
    recover: vi.fn(),
    retain: vi.fn(),
    status: vi.fn(),
    completeNoOp: vi.fn(),
}));

vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.message }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    updatePendingActionConfirmationStatus: mocks.status,
}));
vi.mock('../../getVerifiedBatchReplayDisposition', () => ({ getVerifiedBatchReplayDisposition: mocks.getReplay }));
vi.mock('../../recoverPreparedStemImportResources', () => ({ recoverPreparedStemImportResources: mocks.recover }));
vi.mock('../agentRunExecutionSettlement', () => ({
    agentRunExecutionSettlement: {
        cancelFromVerifiedReceipt: mocks.cancel,
        completeNoOp: mocks.completeNoOp,
        recordFailure: mocks.recordFailure,
    },
}));
vi.mock('../confirmedBatchOutcomeSupport', () => ({
    confirmedBatchOutcomeSupport: {
        createCommittedEffectFailureResult: mocks.createFailure,
        getVerifiedReceiptIdentity: vi.fn(() => 'receipt-identity'),
        recordTrackedAgentRunReceipt: mocks.recordReceipt,
    },
}));
vi.mock('../pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: { retainCommitted: mocks.retain, settleBestEffort: mocks.disposition },
}));

type Input = Parameters<typeof settleVerifiedBatchReplay>[0];
type AddDeviceAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'addDevice' }>;

const action = {
    type: 'addDevice',
    payload: { trackId: 'track-a', deviceType: 'builtin-compressor', deviceId: 'device-a' },
} satisfies AddDeviceAction;

const envelope = {
    schemaVersion: 1,
    runId: 'run-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    baseRevision: 'revision-1',
    idempotencyKey: 'key-1',
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
            arguments: action.payload,
            argumentsDigest: 'digest-1',
            groupId: 'group-1',
            dependencyIds: [],
            reason: 'Add effect',
            expectedEffect: 'Adds effect.',
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

const confirmation = {
    id: 'confirmation-1',
    runId: 'run-1',
    prompt: 'Add an effect',
    assistantMessageId: 'assistant-1',
    actionLabels: ['Add compressor'],
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
    actions: [action],
    approvalSnapshot: { actions: [action], actionLabels: ['Add compressor'], protectedUnchanged: [] },
    executionMode: 'atomic',
    groupId: 'group-1',
} satisfies PendingAppActionConfirmation;

function createInput(pendingEffect = false): Input {
    const receipt = createVerifiedBatchReceipt({
        contentHash: 'content-hash',
        envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-1',
        result: pendingEffect
            ? {
                  status: 'committed-with-warning',
                  warning: 'render pending',
                  actions: [{ action }],
                  warningDetails: [
                      {
                          kind: 'external-effect',
                          message: 'render pending',
                          commandId: 'command-1',
                          pendingEffect: {
                              commandId: 'command-1',
                              kind: 'external-effect',
                              operation: 'addDevice',
                              reason: 'render pending',
                              remediation: 'manual-repair',
                              state: 'pending',
                          },
                      },
                  ],
              }
            : { status: 'committed', actions: [{ action }] },
    });
    return { confirmation, receipt } satisfies Input;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const promise = new Promise<void>((resolve) => {
        deferred.resolve = () => resolve();
    });
    return {
        promise,
        resolve: () => {
            const resolveDeferred = deferred.resolve;
            if (!resolveDeferred) {
                throw new Error('Deferred resolver was not initialized.');
            }
            resolveDeferred();
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReplay.mockReturnValue({ status: 'committed' });
});

describe('settleVerifiedBatchReplay', () => {
    it.each([
        ['committed', 'executed', 'retain'],
        ['executed', 'executed', 'retain'],
        ['no-op', 'executed', 'discard'],
        ['cancelled', 'cancelled', 'discard'],
        ['ambiguous', 'failed', 'retain'],
        ['failed', 'failed', 'discard'],
    ] as const)('settles a $status replay without replaying command effects', async (status, expected, disposition) => {
        mocks.getReplay.mockReturnValue({
            status,
            ...(status === 'ambiguous' || status === 'failed' ? { reason: 'replay failed' } : {}),
        });

        await expect(settleVerifiedBatchReplay(createInput())).resolves.toMatchObject({ status: expected });

        if (status === 'committed' || status === 'executed') {
            expect(mocks.retain).toHaveBeenCalledWith('confirmation-1');
        } else {
            expect(mocks.disposition).toHaveBeenCalledWith({ confirmationId: 'confirmation-1', disposition });
        }
        if (status === 'ambiguous') {
            expect(mocks.recover).toHaveBeenCalledWith({ runId: 'run-1' });
            expect(mocks.recordFailure).toHaveBeenCalledWith(confirmation, {
                category: 'conflict',
                retriable: false,
                workId: 'batch-1',
                receiptIdentity: 'receipt-identity',
                compensation: 'manual-repair',
            });
        }
    });

    it.each(['committed', 'executed'] as const)(
        'waits for committed-resource promotion before reporting a $status replay',
        async (status) => {
            mocks.getReplay.mockReturnValue({ status });
            const resourcePromotion = createDeferred();
            mocks.retain.mockReturnValueOnce(resourcePromotion.promise);
            let replaySettled = false;
            const replay = settleVerifiedBatchReplay(createInput()).then((result) => {
                replaySettled = true;
                return result;
            });

            expect(mocks.retain).toHaveBeenCalledWith('confirmation-1');
            expect(replaySettled).toBe(false);
            expect(mocks.status).not.toHaveBeenCalled();
            expect(mocks.message).not.toHaveBeenCalled();

            resourcePromotion.resolve();

            await expect(replay).resolves.toEqual({ status: 'executed' });
            expect(mocks.status).toHaveBeenCalledWith({
                confirmationId: 'confirmation-1',
                status: 'executed',
                error: undefined,
            });
            expect(mocks.message).toHaveBeenCalledWith(
                'assistant-1',
                expect.objectContaining({ pendingActionConfirmationStatus: 'executed' })
            );
        }
    );

    it('preserves a verified replay warning in the confirmation and chat status', async () => {
        mocks.getReplay.mockReturnValue({ status: 'committed', warning: 'prior warning' });

        await expect(settleVerifiedBatchReplay(createInput())).resolves.toEqual({ status: 'executed' });

        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'executed',
            error: 'prior warning',
        });
        expect(mocks.message).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'executed',
                error: 'prior warning',
                content: expect.stringContaining('prior warning'),
            })
        );
    });

    it('keeps partial committed effects durable and non-replayable', async () => {
        const input = createInput(true);

        await expect(settleVerifiedBatchReplay(input)).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            reason: 'render pending',
        });

        expect(mocks.retain).toHaveBeenCalledWith('confirmation-1');
        expect(mocks.createFailure).toHaveBeenCalledWith(input.receipt, 'render pending');
        expect(mocks.message).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({ content: expect.stringContaining('will not replay') })
        );
    });

    it('retains partially committed resources after a stale lease completion', async () => {
        const input = {
            ...createInput(true),
            leaseSettlement: { accepted: false, warning: 'stale warning' },
        };
        const resourcePromotion = createDeferred();
        mocks.retain.mockReturnValueOnce(resourcePromotion.promise);
        let replaySettled = false;
        const replay = settleVerifiedBatchReplay(input).then((result) => {
            replaySettled = true;
            return result;
        });

        expect(mocks.retain).toHaveBeenCalledWith('confirmation-1');
        expect(replaySettled).toBe(false);
        expect(mocks.status).not.toHaveBeenCalled();
        expect(mocks.message).not.toHaveBeenCalled();

        resourcePromotion.resolve();

        await expect(replay).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            reason: 'render pending',
        });
        expect(mocks.status).toHaveBeenCalledWith({
            confirmationId: 'confirmation-1',
            status: 'failed',
            error: 'render pending stale warning',
        });
        expect(mocks.message).toHaveBeenCalledWith(
            'assistant-1',
            expect.objectContaining({
                pendingActionConfirmationStatus: 'failed',
                error: 'render pending stale warning',
            })
        );
    });
});
