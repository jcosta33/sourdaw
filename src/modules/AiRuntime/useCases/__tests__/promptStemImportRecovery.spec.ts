import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { persistAgentRunState, readAgentRunState } from '../../stores/agentRunStore';
import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

const mocks = vi.hoisted(() => ({
    executionOverride: 'none' as 'ambiguous-before-commit' | 'none',
    obscureCommittedResult: 'none' as 'ambiguous' | 'mismatched' | 'missing' | 'none',
    observedCommandResult: { value: null as null | { status: string; reason?: string } },
    describePlannedAction: vi.fn(() => 'Prompt action'),
    getProjectContext: vi.fn(() => ({ tracks: [] })),
    planPromptActions: vi.fn(),
    prepareDurablePromotionRecovery: vi.fn(),
    commitDurablePromotionRecovery: vi.fn(),
    completeDurablePromotionRecovery: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn(),
    completeDurableCleanupRecovery: vi.fn(),
    promoteStagedAsset: vi.fn(),
    replayOverride: 'real' as 'failed' | 'missing' | 'real',
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('../getProjectContext', () => ({ getProjectContext: mocks.getProjectContext }));
vi.mock('../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../describePlannedAction', () => ({ describePlannedAction: mocks.describePlannedAction }));
// This spec imports captureProjectRevision, createCrdtDoc, getCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc, and resetCrdtProjectAuthority; submitAdmittedPromptRequest imports settlePendingProjectWritesAndCaptureRevision; compilePlannedActionCommandBatch imports captureProjectIdentity.
vi.mock('#/modules/CrdtDocument/useCases', async () => {
    const original = await vi.importActual<typeof import('#/modules/CrdtDocument/useCases')>(
        '#/modules/CrdtDocument/useCases'
    );
    return {
        captureProjectIdentity: original.captureProjectIdentity,
        captureProjectRevision: original.captureProjectRevision,
        createCrdtDoc: original.createCrdtDoc,
        getCrdtDoc: original.getCrdtDoc,
        registerCrdtStorageRuntime: original.registerCrdtStorageRuntime,
        removeCrdtDoc: original.removeCrdtDoc,
        resetCrdtProjectAuthority: original.resetCrdtProjectAuthority,
        settlePendingProjectWritesAndCaptureRevision: original.settlePendingProjectWritesAndCaptureRevision,
    };
});
// submitAdmittedPromptRequest imports parseVersionedCommandBatchEnvelope; compileAgentActionExecution imports compileVersionedCommandBatchEnvelope and parseVersionedCommandBatchEnvelope; compilePlannedActionCommandBatch imports compileVersionedCommandBatchEnvelope and parseVersionedCommandEnvelope; compilePendingActionCommandEnvelopes imports migrateLegacyAppActionToVersionedCommandEnvelope and serializeVersionedCommandEnvelope; compileAgentRiskApproval imports commandBatchPreflightPort, getAgentActionRiskPolicy, getVersionedCommandBatchDivergenceTargetIds, and parseVersionedCommandBatchEnvelope; reconcilePreparedStemImportRecovery imports getVersionedCommandBatchIdempotentReplay and parseVersionedCommandBatchEnvelope; executePlannedActions imports executeVersionedCommandBatchEnvelope and generateGroupId; executePromptActionGroup imports generateGroupId, isExecutableAppActionType, and parseVersionedCommandBatchEnvelope; createStemImportConfirmationResourceLease imports getVersionedCommandBatchCommitProof; issueAgentCommandApprovalBinding imports issueCommandApprovalBinding; completeMidiLearn imports executeUserAppAction when the CrdtDocument useCases barrel loads at runtime.
vi.mock('#/modules/Command/useCases', async () => {
    const original = await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
    return {
        commandBatchPreflightPort: original.commandBatchPreflightPort,
        compileVersionedCommandBatchEnvelope: original.compileVersionedCommandBatchEnvelope,
        configureCommandBatchIdempotency: original.configureCommandBatchIdempotency,
        executeAppAction: original.executeAppAction,
        executeUserAppAction: vi.fn(),
        executeVersionedCommandBatchEnvelope: async (
            ...args: Parameters<typeof original.executeVersionedCommandBatchEnvelope>
        ) => {
            if (mocks.executionOverride === 'ambiguous-before-commit') {
                const result = { status: 'ambiguous' as const, reason: 'Commit truth is not available yet.' };
                mocks.observedCommandResult.value = result;
                return result;
            }
            const result = await original.executeVersionedCommandBatchEnvelope(...args);
            mocks.observedCommandResult.value = {
                status: result.status,
                ...('reason' in result ? { reason: result.reason } : {}),
            };
            if (
                mocks.obscureCommittedResult === 'ambiguous' &&
                (result.status === 'committed' || result.status === 'committed-with-warning')
            ) {
                return { status: 'ambiguous' as const, reason: 'The committed receipt channel was interrupted.' };
            }
            if (
                mocks.obscureCommittedResult === 'missing' &&
                (result.status === 'committed' || result.status === 'committed-with-warning')
            ) {
                return { ...result, receipt: undefined };
            }
            if (
                mocks.obscureCommittedResult === 'mismatched' &&
                (result.status === 'committed' || result.status === 'committed-with-warning')
            ) {
                return { ...result, receipt: { ...result.receipt, runId: 'different-run' } };
            }
            return result;
        },
        generateGroupId: original.generateGroupId,
        getAgentActionRiskPolicy: original.getAgentActionRiskPolicy,
        getVersionedCommandBatchCommitProof: original.getVersionedCommandBatchCommitProof,
        getVersionedCommandBatchDivergenceTargetIds: original.getVersionedCommandBatchDivergenceTargetIds,
        getVersionedCommandBatchIdempotentReplay: async (
            input: Parameters<typeof original.getVersionedCommandBatchIdempotentReplay>[0]
        ) => {
            if (mocks.replayOverride === 'missing') {
                return null;
            }
            if (mocks.replayOverride === 'failed') {
                const parsed = original.parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
                if (parsed.status === 'invalid') {
                    return null;
                }
                return {
                    schemaVersion: 1 as const,
                    runId: parsed.envelope.runId,
                    batchId: parsed.envelope.batchId,
                    outcome: 'failed' as const,
                    links: { render: [], analysis: [] },
                    warnings: [],
                    errors: ['The batch was proven not to have committed.'],
                    modelSummary: 'The batch did not commit.',
                };
            }
            return original.getVersionedCommandBatchIdempotentReplay(input);
        },
        isExecutableAppActionType: original.isExecutableAppActionType,
        issueCommandApprovalBinding: original.issueCommandApprovalBinding,
        migrateLegacyAppActionToVersionedCommandEnvelope: original.migrateLegacyAppActionToVersionedCommandEnvelope,
        parseVersionedCommandBatchEnvelope: original.parseVersionedCommandBatchEnvelope,
        parseVersionedCommandEnvelope: original.parseVersionedCommandEnvelope,
        resetActionReplayAuthority: original.resetActionReplayAuthority,
        serializeVersionedCommandEnvelope: original.serializeVersionedCommandEnvelope,
    };
});
// discardPreparedStemImportResources imports releasePreviewAudioBuffer.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    audioEngine: vi.fn(),
    ensureBusStrip: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
    removeSend: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
// discardPreparedStemImportResources and createStemImportConfirmationResourceLease import getAssetTransfer.
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        promoteStagedAsset: mocks.promoteStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
    }),
}));

const preparedStem = {
    stemId: 'stem-prompt-recovery',
    sourceName: 'Drums.wav',
    role: 'other',
    sourceTempo: 120,
    durationSeconds: 8,
    sourceBytes: 100,
    decodedBytes: 200,
    audioBufferId: 'buffer-prompt-recovery',
    trackId: 'track-prompt-recovery',
    trackName: 'Drums',
    trackGain: 1,
    trackPan: 0,
    clipId: 'clip-prompt-recovery',
} as const;

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-prompt-recovery',
        groupName: 'Recovered Stems',
        projectTempo: 120,
        folderId: 'folder-prompt-recovery',
        stems: [{ ...preparedStem, assetHash: 'hash-prompt-recovery', assetLeaseId: 'lease-prompt-recovery' }],
    },
} satisfies AppAction;
// `executePromptActionGroup` takes the durable promotion route only when
// EVERY imported stem carries both an asset hash and a staging lease
// (`importedStemsHaveDurableBindings`); a stem carrying neither is not a
// mismatch (`importedStemsHavePartialDurableBindings` stays false — it only
// flags a stem with exactly one of the two). Pairing one fully bound stem
// with one wholly unbound stem therefore still routes through
// `retainForRecovery` onto the agent-run recovery ledger, and the resulting
// capsule carries the bound stem's real `assetLeaseId` alongside the
// unbound stem's `null` — the shape a pre-#2719 build actually persisted,
// rather than a stem with a hash but no lease, which no success or failure
// path of `prepareStemImport` can produce.
const legacyBoundStem = {
    ...preparedStem,
    stemId: 'stem-prompt-recovery-bound',
    audioBufferId: 'buffer-prompt-recovery-bound',
    trackId: 'track-prompt-recovery-bound',
    clipId: 'clip-prompt-recovery-bound',
    assetHash: 'hash-prompt-recovery-bound',
    assetLeaseId: 'lease-prompt-recovery-bound',
} as const;
const legacyUnboundStem = {
    ...preparedStem,
    stemId: 'stem-prompt-recovery-unbound',
    audioBufferId: 'buffer-prompt-recovery-unbound',
    trackId: 'track-prompt-recovery-unbound',
    clipId: 'clip-prompt-recovery-unbound',
} as const;
const legacyStemAction = {
    ...stemAction,
    payload: { ...stemAction.payload, stems: [legacyBoundStem, legacyUnboundStem] },
} satisfies AppAction;
const discardStemAction = {
    type: 'discardImportedStemSet',
    payload: {
        folderId: stemAction.payload.folderId,
        stemTrackIds: stemAction.payload.stems.map((stem) => stem.trackId),
        guards: [],
    },
} satisfies AppAction;

describe('prompt stem import recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executionOverride = 'none';
        mocks.obscureCommittedResult = 'none';
        mocks.observedCommandResult.value = null;
        mocks.replayOverride = 'real';
        mocks.prepareDurablePromotionRecovery.mockResolvedValue({ status: 'prepared' });
        mocks.commitDurablePromotionRecovery.mockResolvedValue({ status: 'committed' });
        mocks.completeDurablePromotionRecovery.mockResolvedValue({ status: 'completed' });
        mocks.transitionDurablePromotionRecoveryToCleanup.mockResolvedValue({ status: 'prepared' });
        mocks.completeDurableCleanupRecovery.mockResolvedValue({ status: 'completed' });
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        window.localStorage.clear();
        agentRunLifecycle.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('prompt stem recovery test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        let targetsCreated = false;
        const ownedStorage = createAutomergeStorage<{ imported: boolean }>('owned', 'stemImport');
        registerHandlerMap({
            importStemSet: {
                execute: () => {
                    targetsCreated = true;
                    ownedStorage.set({ imported: true });
                },
                canReapplyAfterDivergence: () => true,
                describe: () => ({ label: 'Import prompt stems', inverseAction: discardStemAction }),
                requiresAbortCompensation: false,
                undoable: true,
                validate: () => true,
            },
            discardImportedStemSet: {
                execute: () => ownedStorage.set({ imported: false }),
                describe: () => ({ label: 'Discard prompt stems', inverseAction: stemAction }),
                validate: () => true,
                canReapplyAfterDivergence: () => true,
                undoable: true,
            },
        });
        resetActionReplayAuthority();
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandBatchPreflightPort.setProvider(({ assetReferences, targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: assetReferences.flatMap((reference) =>
                reference.assetHash ? [reference.assetHash] : []
            ),
            availableAudioBufferIds: assetReferences.flatMap((reference) =>
                reference.audioBufferId ? [reference.audioBufferId] : []
            ),
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: true,
            targetFingerprints: targetsCreated
                ? Object.fromEntries(targetIds.map((targetId) => [targetId, targetId]))
                : {},
        }));
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        removeCrdtDoc('owned');
        window.localStorage.clear();
        vi.unstubAllGlobals();
    });

    it.each(['ambiguous', 'missing', 'mismatched'] as const)(
        'keeps exact durable stem promotion recovery pending after the approval preview is gone and the %s result loses receipt truth',
        async (observedResult) => {
            const submission = await submitAdmittedPromptRequest({
                prompt: 'Import the selected stems',
                source: 'prompt-bar',
                actions: [stemAction],
                requiresConfirmation: true,
            });
            if (submission.status !== 'awaiting-approval') {
                throw new TypeError(`Expected approval preview, received ${submission.status}`);
            }
            const runId = submission.runId;
            const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
            if (!batchId) {
                throw new TypeError('Expected the admitted command batch');
            }
            preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
            let promptPreview: typeof submission.preview | null = submission.preview;
            const confirm = promptPreview.confirm;
            promptPreview = null;
            mocks.obscureCommittedResult = observedResult;

            const confirmationResult = await confirm();
            expect({ confirmationResult, commandResult: mocks.observedCommandResult.value }).toEqual({
                confirmationResult: { status: 'ambiguous' },
                commandResult: { status: 'committed' },
            });

            expect(promptPreview).toBeNull();
            expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
            expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
                `stem-promotion:${runId}:${batchId}`,
                [{ leaseId: 'lease-prompt-recovery', expectedHash: 'hash-prompt-recovery' }],
                expect.objectContaining({ runId, batchId })
            );
            expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
            expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
            expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        }
    );

    it('keeps durable stem promotion recovery pending when command commit truth is unavailable before reload', async () => {
        const submission = await submitAdmittedPromptRequest({
            prompt: 'Import the selected stems',
            source: 'prompt-bar',
            actions: [stemAction],
            requiresConfirmation: true,
        });
        if (submission.status !== 'awaiting-approval') {
            throw new TypeError(`Expected approval preview, received ${submission.status}`);
        }
        const runId = submission.runId;
        const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the admitted command batch');
        }
        preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(submission.preview.confirm()).resolves.toEqual({ status: 'ambiguous' });
        expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${runId}:${batchId}`,
            [{ leaseId: 'lease-prompt-recovery', expectedHash: 'hash-prompt-recovery' }],
            expect.objectContaining({ runId, batchId })
        );
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('retains exact durable prepared-stem promotion recovery after ordinary run history evicts its owner', async () => {
        const submission = await submitAdmittedPromptRequest({
            prompt: 'Import the selected stems',
            source: 'prompt-bar',
            actions: [stemAction],
            requiresConfirmation: true,
        });
        if (submission.status !== 'awaiting-approval') {
            throw new TypeError(`Expected approval preview, received ${submission.status}`);
        }
        const runId = submission.runId;
        const batchId = agentRunLifecycle.get(runId)?.batches[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the admitted command batch');
        }
        preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(submission.preview.confirm()).resolves.toEqual({ status: 'ambiguous' });
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-stem-run-${String(index)}`,
                request: `Later run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-revision-${String(index)}`,
                createdAt: 1_000 + index,
            });
        }
        expect(agentRunLifecycle.get(runId)).toBeNull();
        // Durable stems keep their recovery identity in the durable asset
        // journal, so run-history eviction has nothing of theirs to drop.
        expect(readAgentRunState()).not.toHaveProperty('preparedStemImportRecoveryLedger');
        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith(
            `stem-promotion:${runId}:${batchId}`,
            [{ leaseId: 'lease-prompt-recovery', expectedHash: 'hash-prompt-recovery' }],
            expect.objectContaining({ runId, batchId })
        );
        // Run-history eviction has nothing of this stem's to drop: the durable
        // promotion claim lives in the asset-transfer journal, not on the
        // evicted run or on `preparedStemImportRecoveryLedger`, so eviction
        // must not touch any of the promotion or cleanup lifecycle calls.
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).not.toHaveBeenCalled();
        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('reconstructs an evicted prepared-stem capsule after reload and discards it on proven noncommit', async () => {
        const submission = await submitAdmittedPromptRequest({
            prompt: 'Import the selected stems',
            source: 'prompt-bar',
            actions: [legacyStemAction],
            requiresConfirmation: true,
        });
        if (submission.status !== 'awaiting-approval') {
            throw new TypeError(`Expected approval preview, received ${submission.status}`);
        }
        const runId = submission.runId;
        preparedStemImportResources.register({ runId, stems: legacyStemAction.payload.stems });
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(submission.preview.confirm()).resolves.toEqual({ status: 'ambiguous' });
        const batchId = agentRunLifecycle.get(runId)?.preparedStemImports[0]?.batchId;
        if (!batchId) {
            throw new TypeError('Expected the exact prepared-stem recovery batch');
        }
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-stem-run-${String(index)}`,
                request: `Later run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-revision-${String(index)}`,
                createdAt: 1_000 + index,
            });
        }
        expect(agentRunLifecycle.get(runId)).toBeNull();
        expect(readAgentRunState()).toMatchObject({
            preparedStemImportRecoveryLedger: [
                {
                    runId,
                    batchId,
                    serializedCommandBatch: expect.any(String),
                    resources: [
                        {
                            audioBufferId: 'buffer-prompt-recovery-bound',
                            assetLeaseId: 'lease-prompt-recovery-bound',
                        },
                        {
                            audioBufferId: 'buffer-prompt-recovery-unbound',
                            assetLeaseId: null,
                        },
                    ],
                },
            ],
        });

        vi.resetModules();
        mocks.replayOverride = 'failed';
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { readAgentRunState: readReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverInterruptedAgentRuns({ recoveredAt: 550 });
        await recoverInterruptedAgentRuns({ recoveredAt: 551 });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(2);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-prompt-recovery-bound');
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-prompt-recovery-unbound');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('lease-prompt-recovery-bound');
        expect(readReloadedAgentRunState()).not.toHaveProperty('preparedStemImportRecoveryLedger');
    });

    it('surfaces manual repair without deleting retained media when an evicted capsule is invalid', async () => {
        const submission = await submitAdmittedPromptRequest({
            prompt: 'Import the selected stems',
            source: 'prompt-bar',
            actions: [legacyStemAction],
            requiresConfirmation: true,
        });
        if (submission.status !== 'awaiting-approval') {
            throw new TypeError(`Expected approval preview, received ${submission.status}`);
        }
        const runId = submission.runId;
        preparedStemImportResources.register({ runId, stems: legacyStemAction.payload.stems });
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(submission.preview.confirm()).resolves.toEqual({ status: 'ambiguous' });
        for (let index = 0; index < 50; index += 1) {
            agentRunLifecycle.create({
                runId: `later-manual-run-${String(index)}`,
                request: `Later manual run ${String(index)}`,
                mode: 'plan',
                createdRevision: `later-manual-revision-${String(index)}`,
                createdAt: 2_000 + index,
            });
        }
        const evictedState = readAgentRunState();
        const capsule = evictedState.preparedStemImportRecoveryLedger?.[0];
        if (!capsule) {
            throw new TypeError('Expected an independently retained prepared-stem capsule');
        }
        persistAgentRunState({
            ...evictedState,
            preparedStemImportRecoveryLedger: [
                {
                    ...capsule,
                    serializedCommandBatch: 'invalid retained command proof',
                },
            ],
        });

        vi.resetModules();
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { readAgentRunState: readReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverInterruptedAgentRuns({ recoveredAt: 575 });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(readReloadedAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({
                runId,
                batchId: capsule.batchId,
                status: 'manual-repair',
                lastError: expect.stringContaining('Keep the staged media retained'),
                resources: [
                    {
                        audioBufferId: 'buffer-prompt-recovery-bound',
                        assetLeaseId: 'lease-prompt-recovery-bound',
                    },
                    {
                        audioBufferId: 'buffer-prompt-recovery-unbound',
                        assetLeaseId: null,
                    },
                ],
            }),
        ]);

        const firstReloadedCapsule = readReloadedAgentRunState().preparedStemImportRecoveryLedger?.[0];
        if (!firstReloadedCapsule) {
            throw new TypeError('Expected the manual-repair capsule after first recovery');
        }
        vi.resetModules();
        const { recoverInterruptedAgentRuns: recoverAfterSecondReload } = await import('../agentRunRecovery');
        const { readAgentRunState: readSecondReloadedAgentRunState } = await import('../../stores/agentRunStore');

        await recoverAfterSecondReload({ recoveredAt: 576 });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(readSecondReloadedAgentRunState().preparedStemImportRecoveryLedger).toEqual([
            expect.objectContaining({
                runId: firstReloadedCapsule.runId,
                batchId: firstReloadedCapsule.batchId,
                serializedCommandBatch: firstReloadedCapsule.serializedCommandBatch,
                status: 'manual-repair',
                resources: firstReloadedCapsule.resources,
            }),
        ]);
    });

    it('fails closed after reload when a legacy prepared stem asset has no recovery metadata', async () => {
        const runId = 'legacy-prepared-stem-run';
        agentRunLifecycle.create({
            runId,
            request: 'Import legacy stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        agentRunLifecycle.registerTemporaryAsset({
            runId,
            assetId: 'legacy-buffer',
            kind: 'import',
            cleanupOwner: 'stem-import-preparation',
        });

        vi.resetModules();
        mocks.replayOverride = 'missing';
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { agentRunLifecycle: reloadedAgentRunLifecycle } = await import('../agentRunLifecycle');

        await recoverInterruptedAgentRuns({ recoveredAt: 600 });

        expect(reloadedAgentRunLifecycle.get(runId)).toMatchObject({
            manualResume: { required: true },
            errors: expect.arrayContaining([
                expect.objectContaining({ code: 'prepared-stem-recovery-metadata-missing' }),
            ]),
            preparedStemImports: [],
            temporaryAssets: [expect.objectContaining({ assetId: 'legacy-buffer', status: 'cleanup-pending' })],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });
});
