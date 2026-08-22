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
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

const mocks = vi.hoisted(() => ({
    executionOverride: 'none' as 'ambiguous-before-commit' | 'none',
    obscureCommittedResult: 'none' as 'ambiguous' | 'mismatched' | 'missing' | 'none',
    observedCommandResult: { value: null as null | { status: string; reason?: string } },
    promoteStagedAsset: vi.fn(),
    replayOverride: 'real' as 'failed' | 'missing' | 'real',
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
        mocks.executionOverride = 'none';
        mocks.obscureCommittedResult = 'none';
        mocks.observedCommandResult.value = null;
        mocks.replayOverride = 'real';
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
            expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            expect(agentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        }
    );

    it('reconstructs retained prepared stems after reload and physically discards them on proven noncommit', async () => {
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
        preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
        mocks.executionOverride = 'ambiguous-before-commit';
        mocks.replayOverride = 'missing';

        await expect(submission.preview.confirm()).resolves.toEqual({ status: 'ambiguous' });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('preparedStemImports');
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

        vi.resetModules();
        mocks.replayOverride = 'failed';
        const { recoverInterruptedAgentRuns } = await import('../agentRunRecovery');
        const { agentRunLifecycle: reloadedAgentRunLifecycle } = await import('../agentRunLifecycle');

        await recoverInterruptedAgentRuns({ recoveredAt: 500 });
        await recoverInterruptedAgentRuns({ recoveredAt: 501 });

        expect(reloadedAgentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
        expect(reloadedAgentRunLifecycle.get(runId)?.preparedStemImports).toEqual([]);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledOnce();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('buffer-prompt-recovery');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledOnce();
        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith('lease-prompt-recovery');
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
