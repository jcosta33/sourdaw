import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type compileVersionedCommandBatchEnvelope,
    type createVerifiedBatchReceipt,
    type getVersionedCommandBatchCommitProof,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { executePromptActionGroup } from '../executePromptActionGroup';
import * as receiptSaga from '../recordAgentRunReceiptSaga';

const mocks = vi.hoisted(() => ({
    projectRevision: { value: 'revision-2' },
    executePlannedActions: vi.fn(),
    notifyAiChange: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    getVersionedCommandBatchCommitProof: vi.fn(),
    issueApprovalBinding: vi.fn(() => ({ token: 'exact-approval' })),
    prepareDurablePromotionRecovery: vi.fn(),
    commitDurablePromotionRecovery: vi.fn(),
    completeDurablePromotionRecovery: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn(),
    completeDurableCleanupRecovery: vi.fn(),
    protectPreparedStemImportResources: vi.fn(),
    retainPreparedStemImportResources: vi.fn(),
    releasePreparedStemImportResources: vi.fn(),
    discardPreparedStemImportResources: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    generateGroupId: () => ({ groupId: 'group-1', groupLabel: 'Prompt action' }),
    isExecutableAppActionType: (type: string) => type !== 'removeAllTracks',
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
    getVersionedCommandBatchCommitProof: mocks.getVersionedCommandBatchCommitProof,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
    }),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: () => mocks.projectRevision.value,
}));
vi.mock('../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../issueAgentCommandApprovalBinding', () => ({
    issueAgentCommandApprovalBinding: mocks.issueApprovalBinding,
}));
vi.mock('../agentReference/registerPreparedStemImportResources', () => ({
    preparedStemImportResources: {
        protect: mocks.protectPreparedStemImportResources,
        retainForRecovery: mocks.retainPreparedStemImportResources,
        release: mocks.releasePreparedStemImportResources,
        discard: mocks.discardPreparedStemImportResources,
    },
}));

const RUN_ID = 'prompt-run-1';
const BATCH_ID = 'batch-1';
const IDEMPOTENCY_KEY = 'batch-key-1';
const expectedDurableCommitProof = Object.freeze({
    projectId: 'project:test',
    idempotencyKey: IDEMPOTENCY_KEY,
    contentHash: `sha256:${'a'.repeat(64)}`,
    runId: RUN_ID,
    batchId: BATCH_ID,
}) satisfies Awaited<ReturnType<typeof getVersionedCommandBatchCommitProof>>;
const BASE_REVISION = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});
const action = { type: 'togglePlayback' } satisfies AppAction;
type VerifiedReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-1',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-1',
        stems: [
            {
                stemId: 'stem-1',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 10,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-1',
                assetHash: 'asset-hash-1',
                assetLeaseId: 'asset-lease-1',
                trackId: 'track-1',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-1',
            },
        ],
    },
} satisfies AppAction;
const scope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const grants = {
    allowedOperationPrefixes: ['togglePlayback'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
const commandBatch = {
    serialized: 'command-batch',
    authority: {
        projectId: 'project:test',
        baseRevision: BASE_REVISION,
        scope,
        grants,
        budgets: {
            maxCommands: 1,
            maxCreatedTracks: 1,
            maxDeletedObjects: 0,
            maxAffectedTracks: 1,
            maxAffectedClips: 1,
            maxAutomationPoints: 0,
            maxImportedAssets: 1,
            maxRenderJobs: 0,
        },
    },
} satisfies Parameters<typeof getVersionedCommandBatchCommitProof>[0] &
    Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

function seedRun(phase: 'planning' | 'waiting-for-approval' = 'planning'): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Play',
        mode: 'apply',
        createdRevision: 'revision-1',
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning', revision: 'revision-1' });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Toggle playback',
        commandIds: ['command-1'],
        serializedBatchIdentity: IDEMPOTENCY_KEY,
        revision: 'revision-1',
        scope,
        grants,
        budgets: { limits: {}, consumed: {} },
        recordedAt: 101,
    });
    agentRunLifecycle.recordBatch({
        runId: RUN_ID,
        batch: {
            batchId: BATCH_ID,
            commandIds: ['command-1'],
            status: phase === 'waiting-for-approval' ? 'waiting-for-approval' : 'planned',
            receiptIdentity: null,
        },
        recordedAt: 102,
    });
    if (phase === 'waiting-for-approval') {
        agentRunLifecycle.transitionPhase({
            runId: RUN_ID,
            phase: 'waiting-for-approval',
            revision: 'revision-1',
        });
    }
}

function admitted(agentApproval: unknown = null) {
    return {
        runId: RUN_ID,
        prepared: {
            commandBatch,
            agentApproval: agentApproval as never,
            requiresConfirmation: agentApproval !== null,
        },
    };
}

function verifiedReceipt(
    outcome: 'committed' | 'executed' = 'committed',
    identity: { runId?: string; batchId?: string } = {}
): VerifiedReceipt {
    const revision = {
        normalizedRevision: 'revision-1',
        documentIdentityEpoch: null,
        mutationEpoch: null,
        documents: [],
    };
    return {
        schemaVersion: 1,
        runId: identity.runId ?? RUN_ID,
        batchId: identity.batchId ?? BATCH_ID,
        outcome,
        atomicity: 'atomic',
        base: revision,
        observedBase: revision,
        resulting: revision,
        commandOutcomes: [],
        affectedIds: [],
        createdBindings: [],
        warnings: [],
        errors: [],
        pendingEffects: [],
        links: { render: [], analysis: [] },
        compensation: { available: false, commandIds: [] },
        semanticDiff: null,
        modelSummary: `Batch outcome: ${outcome}.`,
    };
}

describe('executePromptActionGroup', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        agentRunLifecycle.clear();
        mocks.projectRevision.value = 'revision-2';
        mocks.issueApprovalBinding.mockReturnValue({ token: 'exact-approval' });
        mocks.getVersionedCommandBatchCommitProof.mockImplementation(async () => ({
            ...expectedDurableCommitProof,
        }));
        mocks.prepareDurablePromotionRecovery.mockResolvedValue({ status: 'prepared' });
        mocks.commitDurablePromotionRecovery.mockResolvedValue({ status: 'committed' });
        mocks.completeDurablePromotionRecovery.mockResolvedValue({ status: 'completed' });
        mocks.transitionDurablePromotionRecoveryToCleanup.mockResolvedValue({ status: 'prepared' });
        mocks.completeDurableCleanupRecovery.mockResolvedValue({ status: 'completed' });
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: RUN_ID,
                batchId: BATCH_ID,
                idempotencyKey: IDEMPOTENCY_KEY,
                commands: [{ commandId: 'command-1' }],
            },
        });
    });

    it('binds the exact application-issued approval to the admitted command batch', async () => {
        const approval = { actorId: 'artist-1', fingerprint: 'compiled-risk-fingerprint' };
        seedRun('waiting-for-approval');
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [],
            receipt: verifiedReceipt(),
        });

        await executePromptActionGroup({
            actions: [action],
            prompt: 'Play',
            projectRevision: 'revision-1',
            ...admitted(approval),
        });

        expect(mocks.issueApprovalBinding).toHaveBeenCalledWith({ approval, commandBatch });
        expect(mocks.executePlannedActions).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: RUN_ID,
                commandBatch: expect.objectContaining({ approvalBinding: { token: 'exact-approval' } }),
            })
        );
    });

    it.each(['committed', 'executed'] as const)(
        'completes durable stem promotion recovery after an exact verified %s receipt without deleting media',
        async (status) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue({
                status,
                actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
                receipt: verifiedReceipt(status),
            });

            await expect(
                executePromptActionGroup({
                    actions: [stemAction],
                    prompt: 'Import stems',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status });

            expect(mocks.getVersionedCommandBatchCommitProof).toHaveBeenCalledExactlyOnceWith(commandBatch);
            expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`,
                [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }],
                expectedDurableCommitProof
            );
            expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`
            );
            expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`
            );
            expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
            expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
                runId: RUN_ID,
                stems: stemAction.payload.stems,
            });
            expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        }
    );

    it('prepares durable stem promotion before command execution can reach project commit', async () => {
        const controller = new AbortController();
        const order: string[] = [];
        seedRun();
        mocks.prepareDurablePromotionRecovery.mockImplementation(async () => {
            order.push('prepared');
            return { status: 'prepared' };
        });
        mocks.commitDurablePromotionRecovery.mockImplementation(async () => {
            order.push('committed');
            return { status: 'committed' };
        });
        mocks.completeDurablePromotionRecovery.mockImplementation(async () => {
            order.push('completed');
            return { status: 'completed' };
        });
        mocks.releasePreparedStemImportResources.mockImplementation(() => order.push('legacy-released'));
        mocks.executePlannedActions.mockImplementation(async () => {
            order.push('post-commit');
            controller.abort();
            await Promise.resolve();
            return {
                status: 'committed',
                actions: [{ actionType: 'importStemSet', label: 'Import stems' }],
                receipt: verifiedReceipt('committed'),
            };
        });

        await expect(
            executePromptActionGroup({
                actions: [stemAction],
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                signal: controller.signal,
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(order).toEqual(['legacy-released', 'prepared', 'post-commit', 'committed', 'completed']);
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each([
        { execution: { status: 'invalidated', reason: 'Revision changed' }, outcome: 'failed' },
        { execution: { status: 'failed', reason: 'Execution failed' }, outcome: 'failed' },
        { execution: { status: 'cancelled' }, outcome: 'cancelled' },
        { execution: { status: 'no-op' }, outcome: 'no-op' },
    ] as const)(
        'transitions durable stem promotion recovery to cleanup after a non-committed $execution.status terminal',
        async ({ execution, outcome }) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue(execution);

            await expect(
                executePromptActionGroup({
                    actions: [stemAction],
                    prompt: 'Import stems',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status: outcome });

            expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
                runId: RUN_ID,
                stems: stemAction.payload.stems,
            });
            expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
            expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`,
                [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
            );
            expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${RUN_ID}:${BATCH_ID}`
            );
            expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        }
    );

    it('retains prepared stem recovery ownership for an ambiguous execution outcome', async () => {
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({ status: 'ambiguous', reason: 'Commit truth is unresolved' });

        await expect(
            executePromptActionGroup({
                actions: [stemAction],
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'ambiguous' });

        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.retainPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each([
        {
            result: { status: 'committed', actions: [], receipt: verifiedReceipt('committed') },
            phase: 'completed',
            committedRevision: 'revision-2',
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '1:prompt-run-1:batch-1:committed',
            notification: null,
        },
        {
            result: { status: 'executed', actions: [], receipt: verifiedReceipt('executed') },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'committed',
            leaseState: 'completed',
            receiptIdentity: '1:prompt-run-1:batch-1:executed',
            notification: null,
        },
        {
            result: { status: 'invalidated', reason: 'Revision changed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command not executed: Revision changed', []],
        },
        {
            result: { status: 'failed', reason: 'Execution failed' },
            phase: 'failed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command not executed: Execution failed', []],
        },
        {
            result: { status: 'ambiguous', reason: 'Receipt missing' },
            phase: 'partially-completed',
            committedRevision: null,
            batchStatus: 'failed',
            leaseState: 'failed',
            receiptIdentity: null,
            notification: ['Command outcome is uncertain: Receipt missing. Inspect the project before retrying.', []],
        },
        {
            result: { status: 'cancelled' },
            phase: 'cancelled',
            committedRevision: null,
            batchStatus: 'cancelled',
            leaseState: 'cancelled',
            receiptIdentity: null,
            notification: ['Command cancelled before it committed. No project changes were applied.', []],
        },
        {
            result: { status: 'no-op' },
            phase: 'completed',
            committedRevision: null,
            batchStatus: 'no-op',
            leaseState: 'completed',
            receiptIdentity: null,
            notification: ['No project changes were needed.', []],
        },
    ])(
        'reconciles $result.status to exact run, batch, lease, receipt, and notification truth',
        async ({ result, phase, committedRevision, batchStatus, leaseState, receiptIdentity, notification }) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue(result);

            await expect(
                executePromptActionGroup({
                    actions: [action],
                    prompt: 'Play',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status: result.status === 'invalidated' ? 'failed' : result.status });

            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase,
                revisions: { committed: committedRevision },
                batches: [{ batchId: BATCH_ID, status: batchStatus, receiptIdentity }],
                workLeases: [
                    {
                        runId: RUN_ID,
                        workId: BATCH_ID,
                        idempotencyKey: IDEMPOTENCY_KEY,
                        terminalState: leaseState,
                    },
                ],
            });
            if (notification === null) {
                expect(mocks.notifyAiChange).not.toHaveBeenCalled();
            } else {
                expect(mocks.notifyAiChange).toHaveBeenCalledWith(...(notification as [string, []]));
            }
        }
    );

    it('persists the exact command batch for pending-effect continuation after a committed receipt', async () => {
        const pendingEffect = {
            commandId: 'command-1',
            kind: 'runtime-graph' as const,
            operation: 'togglePlayback' as const,
            reason: 'runtime graph repair remains pending',
            remediation: 'repair' as const,
            state: 'pending' as const,
        };
        const receipt = {
            ...verifiedReceipt(),
            outcome: 'partially-committed' as const,
            atomicity: 'durable-atomic-with-non-atomic-effects' as const,
            commandOutcomes: [
                {
                    commandId: pendingEffect.commandId,
                    operation: pendingEffect.operation,
                    outcome: 'committed' as const,
                    affectedIds: [],
                    compensationAvailable: true,
                },
            ],
            pendingEffects: [pendingEffect],
            warnings: ['A post-commit effect remains pending.'],
            compensation: { available: true, commandIds: [pendingEffect.commandId] },
        } satisfies VerifiedReceipt;
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt,
        });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'committed' });

        const expectedContinuation = {
            batchId: BATCH_ID,
            effects: [pendingEffect],
            recovery: 'reconcile-batch',
            serializedBatch: commandBatch.serialized,
            authority: commandBatch.authority,
        };
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [expectedContinuation],
        });
        expect(readAgentRunState().runs.find((run) => run.runId === RUN_ID)).toMatchObject({
            pendingEffectContinuations: [expectedContinuation],
        });
    });

    it.each([
        {
            label: 'missing',
            receipt: undefined,
            warning:
                'Command outcome is uncertain: Command execution completed without an exact verified receipt. Inspect the project before retrying.',
        },
        {
            label: 'different-run',
            receipt: verifiedReceipt('committed', { runId: 'different-run' }),
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
        {
            label: 'different-batch',
            receipt: verifiedReceipt('committed', { batchId: 'different-batch' }),
            warning:
                'Command outcome is uncertain: Command execution returned a receipt for a different admitted batch. Inspect the project before retrying.',
        },
    ])('keeps a $label committed receipt outcome uncertain', async ({ receipt, warning }) => {
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({ status: 'committed', actions: [], receipt });

        await expect(
            executePromptActionGroup({
                actions: [stemAction],
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'ambiguous' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            revisions: { committed: null },
            batches: [{ batchId: BATCH_ID, status: 'failed', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: 'failed' }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledTimes(1);
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(warning, []);
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.retainPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it('reconciles a thrown execution before propagating the failure', async () => {
        seedRun();
        mocks.executePlannedActions.mockRejectedValue(new Error('Executor crashed'));

        await expect(
            executePromptActionGroup({
                actions: [stemAction],
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).rejects.toThrow('Executor crashed');

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed', receiptIdentity: null }],
            workLeases: [{ workId: BATCH_ID, terminalState: 'failed' }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Command not executed: Executor crashed', []);
        expect(mocks.releasePreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledOnce();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`,
            [{ leaseId: 'asset-lease-1', expectedHash: 'asset-hash-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${RUN_ID}:${BATCH_ID}`
        );
        expect(mocks.discardPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it.each(['lease-settlement', 'receipt-persistence'] as const)(
        'keeps a verified committed receipt authoritative when %s throws',
        async (failurePoint) => {
            seedRun();
            mocks.executePlannedActions.mockResolvedValue({
                status: 'committed',
                actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
                receipt: verifiedReceipt(),
            });
            if (failurePoint === 'lease-settlement') {
                vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
                    throw new Error('Lease persistence unavailable');
                });
            } else {
                vi.spyOn(receiptSaga, 'recordAgentRunReceiptSaga').mockImplementationOnce(() => {
                    throw new Error('Receipt persistence unavailable');
                });
            }

            await expect(
                executePromptActionGroup({
                    actions: [action],
                    prompt: 'Play',
                    projectRevision: 'revision-1',
                    ...admitted(),
                })
            ).resolves.toEqual({ status: 'committed' });

            expect(mocks.notifyAiChange).toHaveBeenCalledWith(
                expect.stringMatching(/project change committed.*do not retry automatically/i),
                ['togglePlayback']
            );
            expect(mocks.notifyAiChange).not.toHaveBeenCalledWith(
                expect.stringMatching(/command not executed/i),
                expect.anything()
            );
            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase: failurePoint === 'lease-settlement' ? 'partially-completed' : 'completed',
                batches: [
                    {
                        batchId: BATCH_ID,
                        status: 'committed',
                        receiptIdentity: '1:prompt-run-1:batch-1:committed',
                    },
                ],
                workLeases: [
                    {
                        workId: BATCH_ID,
                        terminalState: failurePoint === 'lease-settlement' ? null : 'completed',
                    },
                ],
            });
        }
    );

    it('keeps a committed receipt authoritative when lease settlement returns stale', async () => {
        seedRun();
        mocks.executePlannedActions.mockResolvedValue({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt: verifiedReceipt(),
        });
        vi.spyOn(agentRunWorkLease, 'settle').mockReturnValueOnce({ status: 'stale' });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'committed' });

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'partially-completed',
            batches: [
                {
                    batchId: BATCH_ID,
                    status: 'committed',
                    receiptIdentity: '1:prompt-run-1:batch-1:committed',
                },
            ],
            workLeases: [{ workId: BATCH_ID, terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            expect.stringMatching(/project change committed.*cancelled or replaced.*do not retry automatically/i),
            ['togglePlayback']
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalledWith(
            expect.stringMatching(/command not executed/i),
            expect.anything()
        );
    });

    it('rejects a prepared batch whose persisted run identity differs from the admitted run', async () => {
        seedRun();
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: 'different-run',
                batchId: BATCH_ID,
                idempotencyKey: IDEMPOTENCY_KEY,
                commands: [{ commandId: 'command-1' }],
            },
        });

        await expect(
            executePromptActionGroup({
                actions: [action],
                prompt: 'Play',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).rejects.toThrow('does not belong to admitted run');

        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
            workLeases: [],
        });
    });

    it('fails the admitted tracked batch when a prepared envelope supplies a different batch id', async () => {
        seedRun();
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: RUN_ID,
                batchId: 'untrusted-batch',
                idempotencyKey: IDEMPOTENCY_KEY,
                commands: [{ commandId: 'command-1' }],
            },
        });

        await expect(
            executePromptActionGroup({
                actions: [stemAction],
                prompt: 'Import stems',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).rejects.toThrow('does not belong to admitted run');

        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
        });
        expect(mocks.discardPreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            stems: stemAction.payload.stems,
        });
    });

    it('terminalizes actions rejected by the approved command boundary', async () => {
        seedRun();

        await expect(
            executePromptActionGroup({
                actions: [{ type: 'removeAllTracks' }],
                prompt: 'Delete everything',
                projectRevision: 'revision-1',
                ...admitted(),
            })
        ).resolves.toEqual({ status: 'failed' });

        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: BATCH_ID, status: 'failed' }],
            workLeases: [],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            'Command not executed: one or more actions are not available through the approved command boundary.',
            []
        );
    });
});
