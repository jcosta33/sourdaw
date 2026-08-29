import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { type admitCommittedSectionRenderRetry } from '../admitCommittedSectionRenderRetry';
import { confirmationAdmission } from '../resolveConfirmationAdmission';

type RetryAdmissionInput = Parameters<typeof admitCommittedSectionRenderRetry>[0];
type RetryAdmissionResult = ReturnType<typeof admitCommittedSectionRenderRetry>;

const mocks = vi.hoisted(() => ({
    admitRetry: vi.fn<(input: RetryAdmissionInput) => RetryAdmissionResult>(() => ({ status: 'ineligible' })),
    chat: vi.fn(),
    compileApproval: vi.fn(),
    getConfirmation: vi.fn(),
    getReplay: vi.fn(),
    invalidateForDivergence: vi.fn(),
    invalidateForProjectChange: vi.fn(),
    failRetryProof: vi.fn(),
    failUnreadableEvidence: vi.fn(),
    reboundApproval: vi.fn(),
    refreshBatch: vi.fn(),
    revision: vi.fn(() => 'revision-1'),
    chatState: { value: null as { isGenerating: boolean } | null },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    getVersionedCommandBatchIdempotentReplay: mocks.getReplay,
    refreshVersionedCommandBatchForApproval: mocks.refreshBatch,
}));
vi.mock('../../../stores/chatStore', () => ({ chatStore: mocks.chatState, updateChatMessage: mocks.chat }));
vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: mocks.getConfirmation,
    refreshPendingActionConfirmationApproval: mocks.reboundApproval,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRevision: mocks.revision }));
vi.mock('../admitCommittedSectionRenderRetry', () => ({ admitCommittedSectionRenderRetry: mocks.admitRetry }));
vi.mock('../../compileAgentRiskApproval', () => ({ compileAgentRiskApproval: mocks.compileApproval }));
vi.mock('../confirmationTerminalSettlement', () => ({
    confirmationTerminalSettlement: {
        failSectionRenderRetryProof: mocks.failRetryProof,
        failUnreadableCommitEvidence: mocks.failUnreadableEvidence,
        invalidateForDivergence: mocks.invalidateForDivergence,
        invalidateForProjectChange: mocks.invalidateForProjectChange,
    },
}));

const action = {
    type: 'setTrackGain',
    payload: { trackId: 'track-a', gain: 0.8, expectedGain: 1 },
} satisfies AppAction;

function createBatch(baseRevision = 'revision-1', batchId = 'batch-1') {
    const command = createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Set Track A gain to 0.8.',
        normalizedProjectRevision: baseRevision,
        objectReferences: [{ argument: 'trackId', id: 'track-a', scope: 'stable' }],
        parameterUnits: [
            { argument: 'gain', unit: 'linear-gain' },
            { argument: 'expectedGain', unit: 'linear-gain' },
        ],
        reason: 'Apply the approved gain adjustment.',
        time: [],
    });
    return compileVersionedCommandBatchEnvelope({
        runId: 'run-1',
        batchId,
        projectId: 'project-1',
        baseRevision,
        intent: 'Set Track A gain',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
}

function createReceipt(commandBatch: ReturnType<typeof createBatch>) {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return createVerifiedBatchReceipt({
        contentHash: `receipt:${parsed.envelope.batchId}`,
        envelope: parsed.envelope,
        observedBaseRevision: parsed.envelope.baseRevision,
        resultingRevision: parsed.envelope.baseRevision,
        result: { status: 'committed', actions: [] },
    });
}

function getBatchCommandEnvelopes(commandBatch: ReturnType<typeof createBatch>): string[] {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return parsed.envelope.commands.map(serializeVersionedCommandEnvelope);
}

function getBatchId(commandBatch: ReturnType<typeof createBatch>): string {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return parsed.envelope.batchId;
}

function createConfirmation(
    input: {
        commandBatch?: ReturnType<typeof createBatch>;
        projectRevision?: string;
        status?: PendingAppActionConfirmation['status'];
    } = {}
): PendingAppActionConfirmation {
    return {
        id: 'confirmation-1',
        runId: 'run-1',
        prompt: 'Set Track A gain',
        assistantMessageId: 'assistant-1',
        actionLabels: ['Set Track A gain'],
        affectedIds: ['track-a'],
        protectedUnchanged: [],
        risk: null,
        executedActions: [],
        status: input.status ?? 'proposed',
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: 0,
        resolvedAt: null,
        kind: 'app_actions',
        projectRevision: input.projectRevision ?? 'revision-1',
        actions: [action],
        approvalSnapshot: {
            actions: [action],
            actionLabels: ['Set Track A gain'],
            protectedUnchanged: [],
            ...(input.commandBatch ? { commandBatch: input.commandBatch } : {}),
        },
        executionMode: 'atomic',
        groupId: input.commandBatch ? getBatchId(input.commandBatch) : 'batch-1',
    };
}

function reapprovalDivergence() {
    return { kind: 'target-changed', targetIds: ['track-a'], repairCandidates: [] } as const;
}

beforeEach(() => {
    vi.clearAllMocks();
    const confirmation = createConfirmation({ commandBatch: createBatch() });
    mocks.chatState.value = { isGenerating: false };
    mocks.getConfirmation.mockReturnValue(confirmation);
    mocks.getReplay.mockResolvedValue(null);
    mocks.revision.mockReturnValue('revision-1');
    mocks.admitRetry.mockReturnValue({ status: 'ineligible' });
    mocks.failRetryProof.mockReturnValue({ status: 'failed', reason: 'retry proof mismatch' });
    mocks.compileApproval.mockReturnValue({ approval: 'rebound' });
    mocks.failUnreadableEvidence.mockReturnValue({ status: 'failed', reason: 'unreadable evidence' });
    mocks.invalidateForDivergence.mockResolvedValue({ status: 'invalidated', reason: 'divergence' });
    mocks.invalidateForProjectChange.mockResolvedValue({ status: 'invalidated', reason: 'stale' });
    mocks.reboundApproval.mockReturnValue(confirmation);
});

describe('resolveConfirmationAdmission', () => {
    it('handles a missing confirmation without entering execution', async () => {
        mocks.getConfirmation.mockReturnValue(null);
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'missing' })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'missing' },
        });
    });

    it('preserves a non-pending status', async () => {
        mocks.getConfirmation.mockReturnValue(createConfirmation({ status: 'failed' }));
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: 'confirmation-1' })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'not_pending', currentStatus: 'failed' },
        });
    });

    it('returns an ordinary ready decision with recovery facts', async () => {
        const confirmation = createConfirmation({ commandBatch: createBatch() });
        mocks.getConfirmation.mockReturnValue(confirmation);
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({
            status: 'ready',
            confirmation,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });
    });

    it('returns the exact busy result and preserves the proposal when generation starts during admission', async () => {
        const commandBatch = createBatch();
        const confirmation = createConfirmation({ commandBatch });
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.chatState.value = { isGenerating: true };

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'busy' } });
        expect(mocks.getReplay).toHaveBeenCalledWith({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        expect(mocks.chat).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'proposed',
            content: 'Another AI command is still running. This proposal remains pending:\n\n- Set Track A gain',
        });
        expect(mocks.refreshBatch).not.toHaveBeenCalled();
    });

    it('reports unreadable evidence as a handled failure before any execution decision', async () => {
        const confirmation = createConfirmation({ commandBatch: createBatch() });
        const evidenceError = new Error('receipt store unavailable');
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.getReplay.mockRejectedValue(evidenceError);

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'failed', reason: 'unreadable evidence' } });
        expect(mocks.failUnreadableEvidence).toHaveBeenCalledWith(confirmation, evidenceError, false);
        expect(mocks.refreshBatch).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', null],
        ['executed', createConfirmation({ commandBatch: createBatch(), status: 'executed' })],
        [
            'rebound batch',
            {
                ...createConfirmation({ commandBatch: createBatch() }),
                approvalSnapshot: {
                    ...createConfirmation({ commandBatch: createBatch() }).approvalSnapshot,
                    commandBatch: { ...createBatch(), serialized: 'rebound-batch' },
                },
            },
        ],
    ] as const)(
        'does not settle unreadable evidence when the live confirmation is %s',
        async (_case, liveConfirmation) => {
            const confirmation = createConfirmation({ commandBatch: createBatch() });
            mocks.getConfirmation.mockReturnValueOnce(confirmation).mockReturnValue(liveConfirmation);
            mocks.getReplay.mockRejectedValue(new Error('receipt store unavailable'));

            await expect(
                confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
            ).resolves.toEqual(
                liveConfirmation
                    ? { status: 'handled', result: { status: 'not_pending', currentStatus: liveConfirmation.status } }
                    : { status: 'handled', result: { status: 'missing' } }
            );
            expect(mocks.failUnreadableEvidence).not.toHaveBeenCalled();
        }
    );

    it('does not retain retry settlement when its live eligibility changed during an unreadable lookup', async () => {
        const commandBatch = createBatch();
        const confirmation = {
            ...createConfirmation({ commandBatch }),
            status: 'executed' as const,
            followUpStatus: 'retryable' as const,
            followUpProjectRevision: 'revision-1',
        };
        const liveConfirmation = { ...confirmation, followUpStatus: 'failed' as const };
        mocks.getConfirmation.mockReturnValueOnce(confirmation).mockReturnValue(liveConfirmation);
        mocks.getReplay.mockRejectedValue(new Error('receipt store unavailable'));
        mocks.admitRetry.mockReturnValueOnce({ status: 'requires-proof' }).mockReturnValue({ status: 'ineligible' });

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'not_pending', currentStatus: 'executed' } });
        expect(mocks.failUnreadableEvidence).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', null],
        ['changed status', createConfirmation({ commandBatch: createBatch(), status: 'failed' })],
    ] as const)('rereads %s confirmation state after deferred durable receipt lookup', async (_case, refreshed) => {
        const confirmation = createConfirmation({ commandBatch: createBatch() });
        let resolveReceipt!: (receipt: ReturnType<typeof createReceipt> | null) => void;
        mocks.getReplay.mockReturnValue(
            new Promise<ReturnType<typeof createReceipt> | null>((resolve) => {
                resolveReceipt = resolve;
            })
        );
        mocks.getConfirmation.mockReturnValueOnce(confirmation).mockReturnValue(refreshed);

        const admission = confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id });
        resolveReceipt(null);

        await expect(admission).resolves.toEqual(
            refreshed
                ? { status: 'handled', result: { status: 'not_pending', currentStatus: 'failed' } }
                : { status: 'handled', result: { status: 'missing' } }
        );
    });

    it('invalidates a stale confirmation without an approved command batch', async () => {
        const confirmation = createConfirmation();
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.revision.mockReturnValue('revision-2');
        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({
            status: 'handled',
            result: { status: 'invalidated', reason: 'stale' },
        });
        expect(mocks.invalidateForProjectChange).toHaveBeenCalledWith(confirmation);
    });

    it('settles a conflicted refreshed approval through the exact divergence invalidation', async () => {
        const commandBatch = createBatch();
        const confirmation = createConfirmation({ commandBatch });
        const divergence = reapprovalDivergence();
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.revision.mockReturnValue('revision-2');
        mocks.refreshBatch.mockReturnValue({ status: 'conflicted', divergence });

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'invalidated', reason: 'divergence' } });
        expect(mocks.invalidateForDivergence).toHaveBeenCalledWith(confirmation, divergence);
    });

    it('rebinds a revalidated approval, updates chat, and requires a new confirmation', async () => {
        const originalBatch = createBatch();
        const refreshedBatch = createBatch('revision-2', 'batch-2');
        const confirmation = createConfirmation({ commandBatch: originalBatch });
        const rebound = createConfirmation({ commandBatch: refreshedBatch, projectRevision: 'revision-2' });
        const divergence = { kind: 'unrelated-change', targetIds: [], repairCandidates: [] } as const;
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.revision.mockReturnValue('revision-2');
        mocks.refreshBatch.mockReturnValue({
            status: 'ready',
            commandBatch: refreshedBatch,
            commandEnvelopes: getBatchCommandEnvelopes(refreshedBatch),
            currentRevision: 'revision-2',
            divergence,
        });
        mocks.reboundApproval.mockReturnValue(rebound);

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'reapproval_required', divergence } });
        expect(mocks.reboundApproval).toHaveBeenCalledWith({
            agentApproval: expect.any(Object),
            commandBatch: refreshedBatch,
            commandEnvelopes: getBatchCommandEnvelopes(refreshedBatch),
            confirmationId: confirmation.id,
            projectRevision: 'revision-2',
        });
        expect(mocks.chat).toHaveBeenCalledWith('assistant-1', {
            pendingActionConfirmationStatus: 'proposed',
            content:
                'The project changed after the prior approval. Divergence was classified as unrelated-change; the unchanged command plan was revalidated and rebound to the current project revision. Review and confirm again:\n\n- Set Track A gain',
        });
    });

    it('invalidates when the refreshed approval cannot be rebound to the stored proposal', async () => {
        const commandBatch = createBatch();
        const refreshedBatch = createBatch('revision-2', 'batch-2');
        const confirmation = createConfirmation({ commandBatch });
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.revision.mockReturnValue('revision-2');
        mocks.refreshBatch.mockReturnValue({
            status: 'ready',
            commandBatch: refreshedBatch,
            commandEnvelopes: getBatchCommandEnvelopes(refreshedBatch),
            currentRevision: 'revision-2',
            divergence: reapprovalDivergence(),
        });
        mocks.reboundApproval.mockReturnValue(null);

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({ status: 'handled', result: { status: 'invalidated', reason: 'stale' } });
        expect(mocks.invalidateForProjectChange).toHaveBeenCalledWith(confirmation);
    });

    it('returns an exact render-retry admission only after receipt proof succeeds', async () => {
        const commandBatch = createBatch();
        const durableReceipt = createReceipt(commandBatch);
        const confirmation = {
            ...createConfirmation({ commandBatch }),
            status: 'executed' as const,
            followUpStatus: 'retryable' as const,
            followUpProjectRevision: 'revision-1',
        };
        mocks.getConfirmation.mockReturnValue(confirmation);
        mocks.getReplay.mockResolvedValue(durableReceipt);
        mocks.admitRetry.mockImplementation(({ phase }) =>
            phase === 'eligibility' ? { status: 'requires-proof' } : { status: 'admitted', durableReceipt }
        );

        await expect(
            confirmationAdmission.resolveConfirmationAdmission({ confirmationId: confirmation.id })
        ).resolves.toEqual({
            status: 'render-retry',
            confirmation,
            durableReceipt,
            commandBatch,
        });
    });

    it('proves the live retry admission before treating a proof mismatch as terminal', () => {
        const commandBatch = createBatch();
        const durableReceipt = createReceipt(commandBatch);
        const confirmation = {
            ...createConfirmation({ commandBatch }),
            status: 'executed' as const,
            followUpStatus: 'retryable' as const,
            followUpProjectRevision: 'revision-1',
        };
        const liveConfirmation = {
            ...confirmation,
            approvalSnapshot: { ...confirmation.approvalSnapshot },
        };
        mocks.getConfirmation.mockReturnValue(liveConfirmation);
        mocks.admitRetry.mockReturnValue({ status: 'proof-mismatch' });

        expect(
            confirmationAdmission.consumeConfirmationAdmission({
                status: 'render-retry',
                confirmation,
                durableReceipt,
                commandBatch,
            })
        ).toEqual({ status: 'handled', result: { status: 'failed', reason: 'retry proof mismatch' } });
        expect(mocks.admitRetry).toHaveBeenCalledWith({
            confirmation: liveConfirmation,
            durableReceipt,
            expectedCommandBatch: commandBatch,
            phase: 'proof',
        });
        expect(mocks.admitRetry.mock.calls[0]?.[0]?.confirmation).toBe(liveConfirmation);
        expect(mocks.failRetryProof).toHaveBeenCalledWith(liveConfirmation);
    });

    it.each([
        [
            'serialized batch',
            (confirmation: PendingAppActionConfirmation) => ({
                ...confirmation,
                approvalSnapshot: {
                    ...confirmation.approvalSnapshot,
                    commandBatch: { ...confirmation.approvalSnapshot.commandBatch!, serialized: 'different-batch' },
                },
            }),
        ],
        [
            'authority',
            (confirmation: PendingAppActionConfirmation) => ({
                ...confirmation,
                approvalSnapshot: {
                    ...confirmation.approvalSnapshot,
                    commandBatch: {
                        ...confirmation.approvalSnapshot.commandBatch!,
                        authority: {
                            ...confirmation.approvalSnapshot.commandBatch!.authority,
                            grants: { ...confirmation.approvalSnapshot.commandBatch!.authority.grants, tempo: true },
                        },
                    },
                },
            }),
        ],
    ])('rejects a same-status consumption whose %s changed after admission', (_binding, change) => {
        const confirmation = createConfirmation({ commandBatch: createBatch() });
        mocks.getConfirmation.mockReturnValue(change(confirmation));

        expect(
            confirmationAdmission.consumeConfirmationAdmission({
                status: 'ready',
                confirmation,
                priorVerifiedBatchReceipt: null,
                recoveringPendingEffects: false,
            })
        ).toEqual({ status: 'handled', result: { status: 'not_pending', currentStatus: 'proposed' } });
    });
});
