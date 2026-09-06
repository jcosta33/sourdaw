import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    type getVersionedCommandBatchCommitProof,
    type getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction, type StemImportTrackSnapshot } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    cancelDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    commitDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'committed' }),
    completeDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    completeDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    prepareDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    prepareDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    releaseDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'released' }),
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn().mockResolvedValue({ status: 'prepared' }),
    getVersionedCommandBatchCommitProof: vi.fn(),
    getVersionedCommandBatchIdempotentReplay: vi.fn<typeof getVersionedCommandBatchIdempotentReplay>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        cancelDurablePromotionRecovery: mocks.cancelDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        releaseDurableStagedAsset: mocks.releaseDurableStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
    }),
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    getVersionedCommandBatchCommitProof: mocks.getVersionedCommandBatchCommitProof,
}));

import { persistAgentRunState, readAgentRunState } from '../../../stores/agentRunStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
    protectPendingActionResourceLease,
} from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunCancellation } from '../../cancelAgentRun';
import { compilePendingActionCommandEnvelopes } from '../../compilePendingActionCommandEnvelopes';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';
import { preparedStemImportCleanup } from '../discardPreparedStemImportResources';
import { preparedStemImportResources } from '../registerPreparedStemImportResources';

const stems = [
    {
        audioBufferId: 'decoded-buffer-1',
        assetHash: 'hash-staged-asset-1',
        assetLeaseId: 'staged-asset-1',
        clipId: 'clip-staged-asset-1',
        decodedBytes: 2_048,
        durationSeconds: 12,
        role: 'other',
        sourceBytes: 1_024,
        sourceName: 'stem.wav',
        sourceTempo: 120,
        stemId: 'stem-staged-asset-1',
        trackGain: 1,
        trackId: 'track-staged-asset-1',
        trackName: 'Stem',
        trackPan: 0,
    },
] satisfies StemImportTrackSnapshot[];

const importStemSetAction = {
    type: 'importStemSet',
    payload: {
        folderId: 'folder-stem-import',
        groupName: 'Imported stems',
        projectTempo: 120,
        selectionId: 'selection-stem-import',
        stems,
    },
} satisfies Extract<AppAction, { type: 'importStemSet' }>;

const importStemSetActions = [importStemSetAction] satisfies readonly AppAction[];

const commitProofCommandBatch = {
    authority: {
        baseRevision: 'revision-stem-import',
        budgets: {
            maxAffectedClips: 1,
            maxAffectedTracks: 1,
            maxAutomationPoints: 0,
            maxCommands: 1,
            maxCreatedTracks: 1,
            maxDeletedObjects: 0,
            maxImportedAssets: 1,
            maxRenderJobs: 0,
        },
        grants: {
            allowedOperationPrefixes: ['importStemSet'],
            audioUpload: true,
            autoCommit: false,
            create: true,
            delete: false,
            file: true,
            master: false,
            remoteGeneration: false,
            routing: false,
            tempo: false,
        },
        projectId: 'project:test',
        scope: {
            protectedRanges: [],
            protectedTargetIds: [],
            targetIds: ['track-staged-asset-1'],
            targetRanges: [],
        },
    },
    serialized: 'serialized',
} satisfies Parameters<typeof getVersionedCommandBatchCommitProof>[0];

const expectedDurableCommitProof = Object.freeze({
    projectId: 'project:test',
    idempotencyKey: 'command:test',
    contentHash: `sha256:${'a'.repeat(64)}`,
    runId: 'run:test',
    batchId: 'batch:test',
    baseRevision: 'revision-stem-import',
    commands: [{ commandId: 'command-stem-import', operation: 'importStemSet' }] satisfies Awaited<
        ReturnType<typeof getVersionedCommandBatchCommitProof>
    >['commands'],
}) satisfies Awaited<ReturnType<typeof getVersionedCommandBatchCommitProof>>;

const stemAction = importStemSetAction;

function createRecoveryCommandBatch(runId: string, batchId: string) {
    const commands = compilePendingActionCommandEnvelopes({
        actions: [importStemSetAction],
        actionLabels: ['Import the prepared stems'],
        group: { groupId: batchId, groupLabel: 'Recover prepared stem import resources' },
        projectRevision: 'revision-cleanup',
    });
    return compileVersionedCommandBatchEnvelope({
        runId,
        batchId,
        projectId: 'project-cleanup',
        baseRevision: 'revision-cleanup',
        idempotencyKey: `stem-recovery:${runId}:${batchId}`,
        intent: 'Recover prepared stem import resources',
        commands,
    });
}

async function createRecoveryReceiptFixture(input: {
    commandBatch: ReturnType<typeof createRecoveryCommandBatch>;
    contentHash?: string;
    outcome: 'committed' | 'failed';
}) {
    const productionCommandUseCases =
        await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
    const proof = await productionCommandUseCases.getVersionedCommandBatchCommitProof(input.commandBatch);
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const command = parsed.envelope.commands[0];
    if (!command || command.operation !== importStemSetAction.type) {
        throw new Error('Expected the recovery batch to contain the stem import command');
    }
    const createPersistedReceipt = (result: Parameters<typeof createVerifiedBatchReceipt>[0]['result']) =>
        createVerifiedBatchReceipt({
            contentHash: input.contentHash ?? proof.contentHash,
            envelope: parsed.envelope,
            observedBaseRevision: parsed.envelope.baseRevision,
            resultingRevision: null,
            result,
        });
    if (input.outcome === 'committed') {
        const inverseAction = getArrangementHandlers().importStemSet.describe(importStemSetAction).inverseAction;
        if (!inverseAction) {
            throw new Error('Expected importStemSet inverse');
        }
        const commandReceipt = createVersionedCommandReceipt({
            envelope: command,
            compensation: { available: true, strategy: 'inverse' },
        });
        const persistedReceipt = createPersistedReceipt({
            status: 'committed',
            actions: [{ action: importStemSetAction, receipt: commandReceipt }],
        });
        return { command, commandReceipt, persistedReceipt, proof };
    }
    const persistedReceipt = createPersistedReceipt({ status: 'failed', actions: [], reason: 'proven noncommit' });
    return { command, commandReceipt: null, persistedReceipt, proof };
}

describe('prepared stem import resource cleanup', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap({ importStemSet: getArrangementHandlers().importStemSet });
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        vi.clearAllMocks();
        mocks.getVersionedCommandBatchCommitProof.mockImplementation(async () => ({
            ...expectedDurableCommitProof,
        }));
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('deletes decoded audio and journals staged cleanup through the registered production owner', async () => {
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
        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]', [
            { leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' },
        ]);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
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
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });

    it('retries one multi-stem and multi-recovery transfer without detaching cleanup owners early', async () => {
        const runId = 'stem-transfer-persistence-failure';
        const twoStems = [
            ...stems,
            {
                ...stems[0],
                audioBufferId: 'decoded-buffer-2',
                assetHash: 'hash-staged-asset-2',
                assetLeaseId: 'staged-asset-2',
                clipId: 'clip-staged-asset-2',
                stemId: 'stem-staged-asset-2',
            },
        ];
        agentRunLifecycle.create({
            runId,
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId, stems: twoStems });
        preparedStemImportResources.protect({
            runId,
            stems: [twoStems[0]!],
            recovery: {
                batchId: 'batch-transfer-1',
                commandBatch: createRecoveryCommandBatch(runId, 'batch-transfer-1'),
            },
        });
        preparedStemImportResources.protect({
            runId,
            stems: [twoStems[1]!],
            recovery: {
                batchId: 'batch-transfer-2',
                commandBatch: createRecoveryCommandBatch(runId, 'batch-transfer-2'),
            },
        });
        const durableBefore = window.localStorage.getItem('sourdaw-agent-runs');
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('prepared stem transfer persistence failed');
        });

        expect(() => preparedStemImportResources.release({ runId, stems: twoStems })).toThrow(
            'Agent run state could not be persisted locally'
        );
        expect(agentRunLifecycle.get(runId)).toMatchObject({ temporaryAssets: [], preparedStemImports: [] });
        expect(readAgentRunState().preparedStemImportRecoveryLedger ?? []).toEqual([]);
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(durableBefore);

        preparedStemImportResources.release({ runId, stems: twoStems });
        expect(setItem).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem('sourdaw-agent-runs')).not.toBe(durableBefore);

        await expect(preparedStemImportResources.discard({ runId, stems: twoStems })).resolves.toBeUndefined();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        setItem.mockRestore();
    });

    it('cleans every registered stem after a refused transfer instead of silently detaching ownership', async () => {
        const runId = 'stem-transfer-discard-after-refusal';
        const twoStems = [
            ...stems,
            {
                ...stems[0],
                audioBufferId: 'decoded-buffer-2',
                assetHash: 'hash-staged-asset-2',
                assetLeaseId: 'staged-asset-2',
                clipId: 'clip-staged-asset-2',
                stemId: 'stem-staged-asset-2',
            },
        ];
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems: twoStems });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('prepared stem transfer persistence failed');
        });

        expect(() => preparedStemImportResources.release({ runId, stems: twoStems })).toThrow(
            'Agent run state could not be persisted locally'
        );
        await expect(preparedStemImportResources.discard({ runId, stems: twoStems })).resolves.toBeUndefined();
        await expect(preparedStemImportResources.discard({ runId, stems: twoStems })).resolves.toBeUndefined();

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-1');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-2');
        setItem.mockRestore();
    });

    it('retries interrupted-transfer durability after physical cleanup without releasing a stem twice', async () => {
        const runId = 'stem-transfer-discard-retry';
        const twoStems = [
            ...stems,
            {
                ...stems[0],
                audioBufferId: 'decoded-buffer-2',
                assetHash: 'hash-staged-asset-2',
                assetLeaseId: 'staged-asset-2',
                clipId: 'clip-staged-asset-2',
                stemId: 'stem-staged-asset-2',
            },
        ];
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems: twoStems });
        const durableBefore = window.localStorage.getItem('sourdaw-agent-runs');
        const setItem = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementationOnce(() => {
                throw new Error('initial transfer persistence failed');
            })
            .mockImplementationOnce(() => {
                throw new Error('cleanup retry persistence failed');
            });

        expect(() => preparedStemImportResources.release({ runId, stems: twoStems })).toThrow(
            'Agent run state could not be persisted locally'
        );
        await expect(preparedStemImportResources.discard({ runId, stems: twoStems })).rejects.toThrow(
            'Agent run state could not be persisted locally'
        );
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(durableBefore);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');

        await expect(preparedStemImportResources.discard({ runId, stems: [twoStems[0]!] })).resolves.toBeUndefined();
        expect(window.localStorage.getItem('sourdaw-agent-runs')).not.toBe(durableBefore);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalledWith('decoded-buffer-2');

        await expect(preparedStemImportResources.discard({ runId, stems: [twoStems[1]!] })).resolves.toBeUndefined();
        await expect(preparedStemImportResources.discard({ runId, stems: twoStems })).resolves.toBeUndefined();

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-1');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-2');
        setItem.mockRestore();
    });

    it('retains a shared prepared-stem recovery until its final stem transfers', () => {
        const runId = 'stem-partial-recovery-transfer';
        const batchId = 'batch-partial-recovery-transfer';
        const twoStems = [
            ...stems,
            {
                ...stems[0],
                audioBufferId: 'decoded-buffer-2',
                assetHash: 'hash-staged-asset-2',
                assetLeaseId: 'staged-asset-2',
                clipId: 'clip-staged-asset-2',
                stemId: 'stem-staged-asset-2',
            },
        ];
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems: twoStems });
        preparedStemImportResources.protect({
            runId,
            stems: twoStems,
            recovery: { batchId, commandBatch: createRecoveryCommandBatch(runId, batchId) },
        });

        preparedStemImportResources.release({ runId, stems: [twoStems[0]!] });
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([expect.objectContaining({ batchId })]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({ runId, batchId }),
        ]);

        preparedStemImportResources.release({ runId, stems: [twoStems[1]!] });
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger ?? []).toEqual([]);
    });

    it('discards every stem of a verified noncommit whose run has left run history', async () => {
        const runId = 'stem-evicted-noncommit-discard';
        const batchId = 'batch-evicted-noncommit-discard';
        const twoStems = [
            ...stems,
            {
                ...stems[0],
                audioBufferId: 'decoded-buffer-2',
                assetHash: 'hash-staged-asset-2',
                assetLeaseId: 'staged-asset-2',
                clipId: 'clip-staged-asset-2',
                stemId: 'stem-staged-asset-2',
            },
        ];
        agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
        preparedStemImportResources.register({ runId, stems: twoStems });
        preparedStemImportResources.protect({
            runId,
            stems: twoStems,
            recovery: { batchId, commandBatch: createRecoveryCommandBatch(runId, batchId) },
        });
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-evicting-run-${String(index)}`,
                request: `Later run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-revision-${String(index)}`,
            });
        }
        expect(agentRunLifecycle.get(runId)).toBeNull();

        await expect(
            preparedStemImportResources.discardAfterVerifiedNoncommit({ runId, stems: twoStems })
        ).resolves.toBeUndefined();

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-1');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('decoded-buffer-2');
        expect(readAgentRunState().preparedStemImportRecoveryLedger ?? []).toEqual([]);
    });

    it('keeps failed confirmation cleanup executable until the durable lease releases', async () => {
        mocks.completeDurableCleanupRecovery
            .mockResolvedValueOnce({ status: 'failed', reason: 'transaction-aborted' })
            .mockResolvedValueOnce({ status: 'completed' });
        const lease = createStemImportConfirmationResourceLease(importStemSetActions);

        await expect(lease?.release()).rejects.toThrow('cleanup remains pending');
        await expect(lease?.release()).resolves.toBeUndefined();

        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledTimes(2);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledTimes(2);
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('makes prepared promotion executable only after the confirmation supplies commit proof', async () => {
        const lease = createStemImportConfirmationResourceLease(importStemSetActions, 'stem-promotion:receipt-bound');

        await lease?.prepareForCommit?.(commitProofCommandBatch);
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.getVersionedCommandBatchCommitProof).toHaveBeenCalledExactlyOnceWith(commitProofCommandBatch);

        await lease?.commit?.();
        await lease?.retain?.();

        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            'stem-promotion:receipt-bound',
            [{ leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' }],
            expectedDurableCommitProof
        );
        expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith('stem-promotion:receipt-bound');
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith('stem-promotion:receipt-bound');
        expect(mocks.prepareDurablePromotionRecovery.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.commitDurablePromotionRecovery.mock.invocationCallOrder[0]!
        );
        expect(mocks.commitDurablePromotionRecovery.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.completeDurablePromotionRecovery.mock.invocationCallOrder[0]!
        );
    });

    it('uses one cleanup owner when run cancellation races confirmation cancellation', async () => {
        agentRunLifecycle.create({
            runId: 'stem-concurrent-cancel',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-concurrent-cancel', stems });
        const lease = createStemImportConfirmationResourceLease(
            importStemSetActions,
            'stem-promotion:concurrent-cancel',
            'stem-concurrent-cancel'
        );
        await lease?.prepareForCommit?.(commitProofCommandBatch);

        await Promise.all([
            agentRunCancellation.cancel({ runId: 'stem-concurrent-cancel', reason: 'User cancelled.' }),
            lease?.release(),
        ]);
        await vi.waitFor(() => expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalled());

        expect(mocks.prepareDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            'stem-promotion:concurrent-cancel',
            [{ leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get('stem-concurrent-cancel')?.temporaryAssets).toEqual([]);
    });

    it('persists exact cleanup ownership before a best-effort terminal path may swallow release failure', async () => {
        mocks.completeDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'transaction-aborted',
        });

        await expect(preparedStemImportCleanup.discardBestEffort(stems)).resolves.toBeUndefined();

        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]', [
            { leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' },
        ]);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
    });

    it('does not swallow failure to acquire durable cleanup ownership', async () => {
        mocks.prepareDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'owner-handoff-conflict',
        });

        await expect(preparedStemImportCleanup.discardBestEffort(stems)).rejects.toThrow(
            'Could not preserve prepared stem cleanup'
        );

        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
    });

    it('preserves the primary failure when durable cleanup ownership cannot be acquired', async () => {
        mocks.prepareDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'owner-handoff-conflict',
        });
        const primary = new Error('stem decoding failed');

        const result = preparedStemImportCleanup.discardBestEffort(stems, undefined, primary);

        await expect(result).rejects.toThrow('stem decoding failed');
        await expect(result).rejects.toMatchObject({ errors: [primary, expect.any(Error)] });
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
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
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
        const commandBatch = createRecoveryCommandBatch(runId, batchId);
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

        const noncommitReceipt = await createRecoveryReceiptFixture({ commandBatch, outcome: 'failed' });
        mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce(noncommitReceipt.persistedReceipt);
        await expect(
            preparedStemImportResources.reconcile({
                runId,
                batchId,
                getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
            })
        ).resolves.toEqual({ status: 'discarded' });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
    });

    it.each([
        { receiptOutcome: 'committed', settlement: 'transferred', cleanupRuns: 0 },
        { receiptOutcome: 'failed', settlement: 'discarded', cleanupRuns: 1 },
    ] as const)(
        'settles retained exact stems once as $settlement from a proven $receiptOutcome Command receipt',
        async ({ receiptOutcome, settlement, cleanupRuns }) => {
            const runId = `stem-recovery-${receiptOutcome}`;
            const batchId = `batch-${receiptOutcome}`;
            const commandBatch = createRecoveryCommandBatch(runId, batchId);
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
            const fixture = await createRecoveryReceiptFixture({ commandBatch, outcome: receiptOutcome });
            expect(fixture.command).toMatchObject({
                operation: importStemSetAction.type,
                arguments: importStemSetAction.payload,
            });
            expect(fixture.proof.commands).toEqual([
                { commandId: fixture.command.commandId, operation: importStemSetAction.type },
            ]);
            expect(fixture.persistedReceipt.resulting).toBeNull();
            if (receiptOutcome === 'committed') {
                expect(fixture.commandReceipt?.compensation).toEqual({ available: true, strategy: 'inverse' });
                expect(fixture.persistedReceipt.compensation).toEqual({
                    available: true,
                    commandIds: [fixture.command.commandId],
                });
            }
            mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce(fixture.persistedReceipt);

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
            expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(cleanupRuns);
            expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledTimes(cleanupRuns);
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
            expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
        }
    );

    it.each(['missing', 'mismatched'] as const)(
        'retains exact recovery ownership for a %s receipt until later proof settles it',
        async (receiptKind) => {
            const runId = `stem-recovery-${receiptKind}`;
            const batchId = `batch-${runId}`;
            const commandBatch = createRecoveryCommandBatch(runId, batchId);
            agentRunLifecycle.create({ runId, request: 'Import stems.', mode: 'plan', createdRevision: 'r1' });
            preparedStemImportResources.register({ runId, stems });
            preparedStemImportResources.protect({ runId, stems, recovery: { batchId, commandBatch } });
            preparedStemImportResources.retainForRecovery({ runId, stems });
            let receipt: Awaited<ReturnType<typeof getVersionedCommandBatchIdempotentReplay>> = null;
            if (receiptKind === 'mismatched') {
                const mismatchedBatch = createRecoveryCommandBatch('different-run', 'different-batch');
                const mismatchedFixture = await createRecoveryReceiptFixture({
                    commandBatch: mismatchedBatch,
                    outcome: 'committed',
                });
                expect(mismatchedFixture.persistedReceipt).toMatchObject({
                    batchId: mismatchedFixture.proof.batchId,
                    contentHash: mismatchedFixture.proof.contentHash,
                    runId: mismatchedFixture.proof.runId,
                });
                receipt = mismatchedFixture.persistedReceipt;
            }
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

            const noncommitReceipt = await createRecoveryReceiptFixture({ commandBatch, outcome: 'failed' });
            mocks.getVersionedCommandBatchIdempotentReplay.mockResolvedValueOnce(noncommitReceipt.persistedReceipt);
            await expect(
                preparedStemImportResources.reconcile({
                    runId,
                    batchId,
                    getVerifiedReceipt: mocks.getVersionedCommandBatchIdempotentReplay,
                })
            ).resolves.toEqual({ status: 'discarded' });
            expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledOnce();
            expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledOnce();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
            expect(readAgentRunState().preparedStemImportRecoveryLedger).toBeUndefined();
        }
    );
});
