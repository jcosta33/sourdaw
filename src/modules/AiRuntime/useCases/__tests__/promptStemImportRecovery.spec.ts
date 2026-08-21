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
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { reconcilePreparedStemImportRecovery } from '../reconcilePreparedStemImportRecovery';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

const mocks = vi.hoisted(() => ({
    obscureCommittedResult: 'none' as 'ambiguous' | 'mismatched' | 'missing' | 'none',
    observedCommandResult: { value: null as null | { status: string; reason?: string } },
    promoteStagedAsset: vi.fn(),
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...original,
        executeVersionedCommandBatchEnvelope: async (
            ...args: Parameters<typeof original.executeVersionedCommandBatchEnvelope>
        ) => {
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
    };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => ({
        promoteStagedAsset: mocks.promoteStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
    }),
}));

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-prompt-recovery',
        groupName: 'Recovered Stems',
        projectTempo: 120,
        folderId: 'folder-prompt-recovery',
        stems: [
            {
                stemId: 'stem-prompt-recovery',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 8,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-prompt-recovery',
                assetLeaseId: 'lease-prompt-recovery',
                trackId: 'track-prompt-recovery',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-prompt-recovery',
            },
        ],
    },
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
        mocks.obscureCommittedResult = 'none';
        mocks.observedCommandResult.value = null;
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
            projectId: captureProjectRevision(),
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
        'settles exact protected stems after the approval preview is gone and the %s result loses receipt truth',
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
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
                expect.objectContaining({ assetId: 'buffer-prompt-recovery', status: 'cleanup-pending' }),
            ]);
            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
            expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });

            await expect(reconcilePreparedStemImportRecovery({ runId, batchId })).resolves.toEqual({
                status: 'transferred',
            });
            await expect(reconcilePreparedStemImportRecovery({ runId, batchId })).resolves.toEqual({
                status: 'missing',
            });
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        }
    );
});
