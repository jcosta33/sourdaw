import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
    getVersionedCommandBatchIdempotentReplay: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({ releaseStagedAsset: mocks.releaseStagedAsset }),
}));

import { type ExecutableRuntimeAction } from '../../../models/ExecutableRuntimeAction';
import { persistAgentRunState, readAgentRunState } from '../../../stores/agentRunStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
    protectPendingActionResourceLease,
} from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunCancellation } from '../../cancelAgentRun';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';
import { preparedStemImportResources } from '../registerPreparedStemImportResources';

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-cleanup',
        groupName: 'Cleanup Stems',
        projectTempo: 120,
        folderId: 'folder-cleanup',
        stems: [
            {
                stemId: 'stem-cleanup',
                sourceName: 'Cleanup.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 4,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'decoded-buffer-1',
                assetLeaseId: 'staged-asset-1',
                trackId: 'track-cleanup',
                trackName: 'Cleanup',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-cleanup',
            },
        ],
    },
} satisfies ExecutableRuntimeAction;
const stems = stemAction.payload.stems;

function createRecoveryCommandBatch(serialized: string) {
    return {
        authority: {
            projectId: 'project-cleanup',
            baseRevision: 'revision-cleanup',
            scope: {
                targetIds: [],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            grants: {
                allowedOperationPrefixes: ['importStemSet'],
                create: true,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: true,
                audioUpload: true,
                remoteGeneration: false,
                autoCommit: false,
            },
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
        serialized,
    };
}

describe('prepared stem import resource cleanup', () => {
    beforeEach(() => {
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        vi.clearAllMocks();
    });

    it('deletes decoded audio and staged assets through the registered production owner before metadata removal', async () => {
        agentRunLifecycle.create({
            runId: 'stem-delete',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-delete', stems });

        await expect(deleteAgentRunArtifacts('stem-delete')).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: ['decoded-buffer-1'],
            failedAssetIds: [],
        });
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
        expect(agentRunLifecycle.get('stem-delete')?.temporaryAssets).toEqual([]);
    });

    it('hands committed stem resources to the project without deleting them later', async () => {
        agentRunLifecycle.create({
            runId: 'stem-committed',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-committed', stems });

        preparedStemImportResources.release({ runId: 'stem-committed', stems });

        await expect(deleteAgentRunArtifacts('stem-committed')).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: [],
            failedAssetIds: [],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });

    it('discards uncommitted stem resources and clears their run-owned records', async () => {
        agentRunLifecycle.create({
            runId: 'stem-discarded',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-discarded', stems });

        await preparedStemImportResources.discard({ runId: 'stem-discarded', stems });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
        expect(agentRunLifecycle.get('stem-discarded')?.temporaryAssets).toEqual([]);

        expect(() => preparedStemImportResources.register({ runId: 'stem-discarded', stems })).not.toThrow();
        preparedStemImportResources.release({ runId: 'stem-discarded', stems });
        expect(agentRunLifecycle.get('stem-discarded')?.temporaryAssets).toEqual([]);
    });

    it('refuses protection at durable capacity before resources become commit-protected', async () => {
        const admittedRecoveries = Array.from({ length: 256 }, (_, index) => ({
            schemaVersion: 1 as const,
            runId: `evicted-capacity-run-${String(index)}`,
            batchId: `evicted-capacity-batch-${String(index)}`,
            serializedCommandBatch: `evicted-capacity-proof-${String(index)}`,
            resources: [
                {
                    audioBufferId: `evicted-capacity-buffer-${String(index)}`,
                    assetLeaseId: `evicted-capacity-lease-${String(index)}`,
                },
            ],
            status: 'pending' as const,
            lastError: null,
            manualRepairRequiredAt: null,
        }));
        persistAgentRunState({
            schemaVersion: 1,
            runs: [],
            preparedStemImportRecoveryLedger: admittedRecoveries,
        });
        const runId = 'stem-capacity-refusal';
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems });

        expect(() =>
            preparedStemImportResources.protect({
                runId,
                stems,
                recovery: {
                    batchId: 'batch-capacity-refusal',
                    commandBatch: {
                        authority: {
                            projectId: 'project-capacity-refusal',
                            baseRevision: 'revision-capacity-refusal',
                            scope: {
                                targetIds: [],
                                targetRanges: [],
                                protectedTargetIds: [],
                                protectedRanges: [],
                            },
                            grants: {
                                allowedOperationPrefixes: ['importStemSet'],
                                create: true,
                                delete: false,
                                routing: false,
                                tempo: false,
                                master: false,
                                file: true,
                                audioUpload: true,
                                remoteGeneration: false,
                                autoCommit: false,
                            },
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
                        serialized: 'serialized-capacity-refusal',
                    },
                },
            })
        ).toThrow('Agent run prepared-stem recovery ledger reached its persistent capacity');

        await preparedStemImportResources.discard({ runId, stems });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toEqual(admittedRecoveries);
    });

    it('retains protected stems after cancellation and generic discard until transfer settles ownership', async () => {
        const runId = 'stem-protected-transfer';
        agentRunLifecycle.create({
            runId,
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId, stems });
        preparedStemImportResources.protect({ runId, stems });

        await expect(
            agentRunCancellation.cancel({ runId, reason: 'Abort during post-commit effects.' })
        ).resolves.toMatchObject({
            status: 'cancelled',
            cleanupPendingAssetIds: ['decoded-buffer-1'],
            releasedAssetIds: [],
        });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'cleanup-pending' }),
        ]);
        await expect(deleteAgentRunArtifacts(runId)).resolves.toEqual({
            status: 'partial',
            deletedAssetIds: [],
            failedAssetIds: ['decoded-buffer-1'],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

        await preparedStemImportResources.discard({ runId, stems });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'cleanup-pending' }),
        ]);

        preparedStemImportResources.release({ runId, stems });

        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        await expect(deleteAgentRunArtifacts(runId)).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: [],
            failedAssetIds: [],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('retains a protected confirmation lease through generic clear until verified noncommit discards once', async () => {
        const runId = 'stem-protected-confirmation-clear';
        const batchId = 'batch-protected-confirmation-clear';
        const confirmationId = 'confirmation-protected-confirmation-clear';
        const commandBatch = createRecoveryCommandBatch('serialized-protected-confirmation-clear');
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems });
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'Import stems.',
            assistantMessageId: 'assistant-protected-confirmation-clear',
            actions: [stemAction],
            actionLabels: ['Import stems'],
            projectRevision: 'r1',
            resourceLease: createStemImportConfirmationResourceLease(runId, [stemAction], {
                batchId,
                commandBatch,
            }),
        });

        protectPendingActionResourceLease(confirmationId);
        clearPendingActionConfirmations();
        await Promise.resolve();

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1' }),
        ]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({
                runId,
                batchId,
                serializedCommandBatch: commandBatch.serialized,
                resources: [{ audioBufferId: 'decoded-buffer-1', assetLeaseId: 'staged-asset-1' }],
            }),
        ]);

        mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce({
            schemaVersion: 1,
            runId,
            batchId,
            outcome: 'failed',
            links: { render: [], analysis: [] },
            warnings: [],
            errors: ['proven noncommit'],
            modelSummary: 'proven noncommit',
        });
        await expect(
            preparedStemImportResources.reconcile({
                runId,
                batchId,
                getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
            })
        ).resolves.toEqual({ status: 'discarded' });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
    });

    it.each([
        { receiptOutcome: 'committed', settlement: 'transferred', physicalDeletes: 0 },
        { receiptOutcome: 'failed', settlement: 'discarded', physicalDeletes: 1 },
    ] as const)(
        'settles retained exact stems once as $settlement from a proven $receiptOutcome Command receipt',
        async ({ receiptOutcome, settlement, physicalDeletes }) => {
            const runId = `stem-recovery-${receiptOutcome}`;
            const batchId = `batch-${receiptOutcome}`;
            const commandBatch = { authority: {} as never, serialized: `serialized-${receiptOutcome}` };
            agentRunLifecycle.create({
                runId,
                request: 'Import stems.',
                mode: 'plan',
                createdRevision: 'r1',
            });
            preparedStemImportResources.register({ runId, stems });
            preparedStemImportResources.protect({
                runId,
                stems,
                recovery: { batchId, commandBatch },
            });
            preparedStemImportResources.retainForRecovery({ runId, stems });
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([
                {
                    schemaVersion: 1,
                    batchId,
                    serializedCommandBatch: commandBatch.serialized,
                    resources: [{ audioBufferId: 'decoded-buffer-1', assetLeaseId: 'staged-asset-1' }],
                },
            ]);
            expect(readAgentRunState().preparedStemImportRecoveryLedger).toEqual([
                expect.objectContaining({ runId, batchId, status: 'pending' }),
            ]);
            mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce({
                schemaVersion: 1,
                runId,
                batchId,
                outcome: receiptOutcome,
                links: { render: [], analysis: [] },
                warnings: [],
                errors: [],
                modelSummary: receiptOutcome,
            });

            const settlements = await Promise.all([
                preparedStemImportResources.reconcile({
                    runId,
                    batchId,
                    getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
                }),
                preparedStemImportResources.reconcile({
                    runId,
                    batchId,
                    getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
                }),
            ]);

            expect(settlements).toEqual([{ status: settlement }, { status: settlement }]);
            await expect(
                preparedStemImportResources.reconcile({
                    runId,
                    batchId,
                    getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
                })
            ).resolves.toEqual({ status: 'missing' });

            expect(mocks.getVersionedCommandBatchIdempotentReplay).toHaveBeenCalledOnce();
            expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(physicalDeletes);
            expect(mocks.releaseStagedAsset).toHaveBeenCalledTimes(physicalDeletes);
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
            expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
        }
    );

    it.each([
        { label: 'missing', receipt: null },
        {
            label: 'mismatched',
            receipt: {
                schemaVersion: 1,
                runId: 'different-run',
                batchId: 'different-batch',
                outcome: 'committed',
                links: { render: [], analysis: [] },
                warnings: [],
                errors: [],
                modelSummary: 'mismatched',
            },
        },
    ])('retains exact recovery ownership for a $label receipt until later proof settles it', async ({ receipt }) => {
        const runId = `stem-recovery-${receipt ? 'mismatched' : 'missing'}`;
        const batchId = `batch-${runId}`;
        const commandBatch = { authority: {} as never, serialized: `serialized-${runId}` };
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems });
        preparedStemImportResources.protect({ runId, stems, recovery: { batchId, commandBatch } });
        preparedStemImportResources.retainForRecovery({ runId, stems });
        mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce(receipt);

        await expect(
            preparedStemImportResources.reconcile({
                runId,
                batchId,
                getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
            })
        ).resolves.toEqual({ status: 'retained' });
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'cleanup-pending' }),
        ]);
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toHaveLength(1);
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

        mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce({
            schemaVersion: 1,
            runId,
            batchId,
            outcome: 'failed',
            links: { render: [], analysis: [] },
            warnings: [],
            errors: ['not committed'],
            modelSummary: 'not committed',
        });
        await expect(
            preparedStemImportResources.reconcile({
                runId,
                batchId,
                getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
            })
        ).resolves.toEqual({ status: 'discarded' });
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledOnce();
        expect(mocks.releaseStagedAsset).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
    });
});
