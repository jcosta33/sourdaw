import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    commandBatchPreviewPort,
    commandBatchPreflightPort,
    configureCommandBatchIdempotency,
    commandProjectDivergencePort,
    executeAppAction,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
    commandProjectRevisionPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    captureUnownedProjectMutations,
    createCommandRecoveryWorkspace,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    getCrdtDocIds,
    mutateCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, stopGenerating } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    settlePendingActionResourceLease,
} from '../../stores/pendingActionConfirmationStore';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

const stemResourceMocks = vi.hoisted(() => ({
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    releasePreviewAudioBuffer: stemResourceMocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => ({ releaseStagedAsset: stemResourceMocks.releaseStagedAsset }),
}));

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-confirmed-stems',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-confirmed-stems',
        stems: [
            {
                stemId: 'stem-confirmed-1',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 10,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-confirmed-1',
                assetLeaseId: 'lease-confirmed-1',
                trackId: 'track-confirmed-1',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-confirmed-1',
            },
        ],
    },
} satisfies AppAction;

describe('confirmPendingChatActions transaction admission', () => {
    beforeEach(() => {
        stemResourceMocks.releasePreviewAudioBuffer.mockClear();
        stemResourceMocks.releaseStagedAsset.mockClear();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
        resetCrdtProjectAuthority('AI confirmation admission');
        createCrdtDoc('independent');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandBatchPreviewPort.setRecoveryProvider(createCommandRecoveryWorkspace);
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandProjectDivergencePort.setProvider(null);
        chatStore.set({
            messages: [
                {
                    id: 'assistant-1',
                    role: 'assistant',
                    content: 'Awaiting confirmation',
                    timestamp: 1,
                },
            ],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        resetAiWorkflowCommandPreflightFixture();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        clearPendingActionConfirmations();
        commandBatchPreviewPort.setProvider(null);
        commandBatchPreviewPort.setRecoveryProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandProjectDivergencePort.setProvider(null);
    });

    it('invalidates a confirmed action when the project changes while batch admission is waiting', async () => {
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-admission', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-admission',
            batchId: 'group-admission',
            projectId: projectRevision,
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            id: 'confirmation-1',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            projectRevision,
        };
        proposePendingActionConfirmation(proposal);

        let releaseSnapshotTransaction!: () => void;
        let markSnapshotTransactionStarted!: () => void;
        const snapshotTransactionStarted = new Promise<void>((resolve) => {
            markSnapshotTransactionStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseSnapshotTransaction = resolve;
        });
        const blockingTransaction = transactSnapshot(async () => {
            markSnapshotTransactionStarted();
            await release;
        });
        await snapshotTransactionStarted;

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-1' });
        await vi.waitFor(() => expect(getPendingActionConfirmation('confirmation-1')?.status).toBe('accepted'));
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.changedDuringAdmission = true;
            },
        });
        releaseSnapshotTransaction();

        await blockingTransaction;
        await expect(confirmation).resolves.toMatchObject({ status: 'invalidated' });
        expect(execute).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            content: expect.stringContaining('project changed'),
        });
    });

    it('rejects a legacy command-envelope confirmation without an approved outer batch', async () => {
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: (action) => ({
                    label: 'Generic handler label',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes from 120 BPM to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-tempo', groupLabel: 'Set exact tempo', source: 'prompt' },
        });
        proposePendingActionConfirmation({
            id: 'confirmation-envelope',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo from 120 BPM to 128 BPM'],
            commandEnvelopes: [serializeVersionedCommandEnvelope(envelope)],
            executionMode: 'atomic',
            groupId: 'group-tempo',
            groupLabel: 'Set exact tempo',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-envelope' })).resolves.toEqual({
            status: 'failed',
            reason: 'The confirmation has no approved command batch.',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
    });

    it('rejects a raw-action confirmation without an approved outer batch', async () => {
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>();
        registerHandlerMap({
            setTempo: {
                execute,
                describe: () => ({ label: 'Set tempo' }),
                undoable: false,
                validate: () => true,
            },
        });
        const projectRevision = captureProjectRevision();
        proposePendingActionConfirmation({
            id: 'confirmation-raw-action',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            actionLabels: ['Set tempo'],
            executionMode: 'atomic',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-raw-action' })).resolves.toEqual({
            status: 'failed',
            reason: 'The confirmation has no approved command batch.',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('executes the approved outer command batch instead of the legacy envelope array', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let observedSignal: AbortSignal | undefined;
        const execute = vi.fn((action: SetTempoAction, context?: { signal?: AbortSignal }) => {
            observedSignal = context?.signal;
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-batch',
            batchId: 'group-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-batch',
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-batch', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-batch', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-batch',
            runId: 'confirmation-batch',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandEnvelopes: ['invalid legacy envelope must not execute'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-batch' })).resolves.toEqual({
            status: 'executed',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(observedSignal).toBeInstanceOf(AbortSignal);
        expect(observedSignal?.aborted).toBe(false);
        expect(agentRunLifecycle.get('confirmation-batch')).toMatchObject({
            phase: 'completed',
            saga: {
                steps: [
                    expect.objectContaining({
                        stepId: 'command:group-batch',
                        owner: 'command',
                        state: 'committed',
                        receiptIdentity: expect.stringContaining('confirmation-batch:group-batch'),
                    }),
                ],
            },
        });

        proposePendingActionConfirmation({
            id: 'confirmation-batch-retry',
            runId: 'confirmation-batch',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-batch-retry' })).resolves.toEqual({
            status: 'executed',
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(chatStore.value?.messages[0]?.content).toContain('prior verified receipt');
    });

    it.each([
        { outcome: 'verified-after-abort', createsTargets: true },
        { outcome: 'ambiguous', createsTargets: false },
    ] as const)('settles confirmed stem resources for $outcome command truth', async ({ outcome, createsTargets }) => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        let targetsCreated = false;
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: ['buffer-confirmed-1'],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: targetsCreated
                ? Object.fromEntries(targetIds.map((targetId) => [targetId, targetId]))
                : {},
        }));
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ imported: boolean }>('owned', 'stemImport');
        let markAfterCommitStarted!: () => void;
        let releaseAfterCommit!: () => void;
        const afterCommitStarted = new Promise<void>((resolve) => {
            markAfterCommitStarted = resolve;
        });
        const afterCommitRelease = new Promise<void>((resolve) => {
            releaseAfterCommit = resolve;
        });
        const afterCommit = () => {
            markAfterCommitStarted();
            return afterCommitRelease;
        };
        const discardStemAction = {
            type: 'discardImportedStemSet',
            payload: {
                folderId: stemAction.payload.folderId,
                stemTrackIds: stemAction.payload.stems.map((stem) => stem.trackId),
                guards: [],
            },
        } satisfies AppAction;
        registerHandlerMap({
            importStemSet: {
                execute: () => {
                    targetsCreated = createsTargets;
                    ownedStorage.set({ imported: true });
                    return {
                        status: 'written',
                        afterCommit,
                        afterAmbiguousCommit: () => undefined,
                    };
                },
                canReapplyAfterDivergence: () => true,
                describe: () => ({ label: 'Import confirmed stems', inverseAction: discardStemAction }),
                requiresAbortCompensation: false,
                undoable: true,
                validate: () => true,
            },
            discardImportedStemSet: {
                execute: () => ownedStorage.set({ imported: false }),
                canReapplyAfterDivergence: () => true,
                describe: () => ({ label: 'Discard confirmed stems', inverseAction: stemAction }),
                undoable: true,
                validate: () => true,
            },
        });
        const projectRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: stemAction,
            expectedEffect: 'Import the exact confirmed stem set.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-confirmed-stems', groupLabel: 'Import confirmed stems', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-confirmed-stems',
            batchId: 'group-confirmed-stems',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'Import confirmed stems',
            commands: [serializeVersionedCommandEnvelope(command)],
        });
        agentRunLifecycle.create({
            runId: 'run-confirmed-stems',
            request: 'Import confirmed stems',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-confirmed-stems', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'run-confirmed-stems', phase: 'waiting-for-approval' });
        preparedStemImportResources.register({ runId: 'run-confirmed-stems', stems: stemAction.payload.stems });
        proposePendingActionConfirmation({
            id: 'confirmation-confirmed-stems',
            runId: 'run-confirmed-stems',
            prompt: 'Import confirmed stems',
            assistantMessageId: 'assistant-1',
            actions: [stemAction],
            actionLabels: ['Import confirmed stems'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-confirmed-stems',
            groupLabel: 'Import confirmed stems',
            projectRevision,
            resourceLease: createStemImportConfirmationResourceLease('run-confirmed-stems', [stemAction], {
                batchId: 'group-confirmed-stems',
                commandBatch,
            }),
        });

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-confirmed-stems' });
        if (outcome === 'ambiguous') {
            const result = await confirmation;
            expect(result).toMatchObject({ status: 'failed' });
            expect('reason' in result ? result.reason : '').toContain(
                'Automerge storage transaction committed before a later document failed'
            );
            expect(agentRunLifecycle.get('run-confirmed-stems')?.temporaryAssets).toEqual([
                expect.objectContaining({ assetId: 'buffer-confirmed-1', status: 'cleanup-pending' }),
            ]);
            expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
            return;
        }
        await Promise.race([
            afterCommitStarted,
            confirmation.then((result) => {
                throw new Error(`Confirmed stem command settled before post-commit effects: ${JSON.stringify(result)}`);
            }),
        ]);
        stopGenerating();
        await agentRunCancellation.cancel({
            runId: 'run-confirmed-stems',
            reason: 'Test observes cancellation during post-commit effects.',
        });
        let cancellationAssertionError: Error | null = null;
        try {
            expect(agentRunLifecycle.get('run-confirmed-stems')?.temporaryAssets).toEqual([
                expect.objectContaining({ assetId: 'buffer-confirmed-1', status: 'cleanup-pending' }),
            ]);
            expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
        } catch (error) {
            cancellationAssertionError = error instanceof Error ? error : new Error(String(error));
        } finally {
            releaseAfterCommit();
        }
        await expect(confirmation).resolves.toEqual({ status: 'executed' });
        if (cancellationAssertionError) {
            throw cancellationAssertionError;
        }
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
        expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-confirmed-stems')?.temporaryAssets).toEqual([]);
    });

    it('delegates proven non-commit settlement to the prepared-stem owner', async () => {
        const runId = 'run-confirmed-stems-discard';
        const confirmationId = 'confirmation-confirmed-stems-discard';
        const projectRevision = captureProjectRevision();
        agentRunLifecycle.create({
            runId,
            request: 'Import confirmed stems',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'Import confirmed stems',
            assistantMessageId: 'assistant-1',
            actions: [stemAction],
            actionLabels: ['Import confirmed stems'],
            projectRevision,
            resourceLease: createStemImportConfirmationResourceLease(runId, [stemAction]),
        });

        settlePendingActionResourceLease({ confirmationId, disposition: 'discard' });

        await vi.waitFor(() => expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]));
        expect(stemResourceMocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('buffer-confirmed-1');
        expect(stemResourceMocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('lease-confirmed-1');
    });

    it('routes a partially committed confirmation retry through external-effect recovery', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let effectAttempts = 0;
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => {
                    ownedStorage.set({ bpm: action.payload.bpm });
                    const applyRuntimeEffect = () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            return Promise.reject(new Error('tempo runtime unavailable'));
                        }
                        return Promise.resolve();
                    };
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-recovery-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-recovery-batch',
            batchId: 'group-recovery-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            groupId: 'group-recovery-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        };
        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-recovery-batch' });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch' })).resolves.toEqual({
            status: 'executed',
        });
        expect(effectAttempts).toBe(2);

        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-recovery-batch-retry' });
        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch-retry' })
        ).resolves.toEqual({ status: 'executed' });

        expect(effectAttempts).toBe(3);
        expect(chatStore.value?.messages[0]?.content).toContain('recovered verified receipt');
        expect(chatStore.value?.messages[0]?.content).toContain(
            'Pending external effects were reconciled successfully'
        );
        expect(chatStore.value?.messages[0]?.content).not.toContain('without replaying project or runtime effects');
        expect(chatStore.value?.messages[0]?.content).not.toContain('tempo runtime unavailable');
    });

    it('preserves a failed verified receipt on retry instead of reporting the batch already applied', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const execute = vi.fn(() => {
            throw new Error('Tempo engine unavailable');
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-failed-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-failed-batch',
            batchId: 'group-failed-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            groupId: 'group-failed-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        };
        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-failed-batch' });

        const first = await confirmPendingChatActions({ confirmationId: 'confirmation-failed-batch' });
        expect(first).toMatchObject({ status: 'failed' });
        if (first.status !== 'failed') {
            throw new Error('Expected the first command batch to fail');
        }
        const executionCallsAfterFirstFailure = execute.mock.calls.length;

        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-failed-batch-retry' });
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-failed-batch-retry' })).resolves.toEqual(
            first
        );
        expect(execute).toHaveBeenCalledTimes(executionCallsAfterFirstFailure);
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            content: expect.not.stringContaining('already applied'),
        });
    });

    it('classifies approval-time divergence and issues a fresh revision-bound approval before execution', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        const validate = vi.fn(() => true);
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate,
            },
        });
        const action = {
            type: 'setTempo',
            payload: { bpm: 132 },
        } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        agentRunLifecycle.create({
            runId: 'confirmation-reapproval',
            request: 'set tempo to 132',
            mode: 'apply',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'confirmation-reapproval',
            phase: 'planning',
            revision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'confirmation-reapproval',
            phase: 'waiting-for-approval',
            revision: projectRevision,
        });
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes from 120 BPM to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-reapproval', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-reapproval',
            batchId: 'group-reapproval',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-reapproval',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo from 120 BPM to 132 BPM'],
            commandEnvelopes: [serializeVersionedCommandEnvelope(envelope)],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-reapproval',
            groupLabel: 'Set tempo batch',
            projectRevision,
            runId: 'confirmation-reapproval',
        });
        const classify = vi.fn(() => ({
            kind: 'non-overlapping' as const,
            mayReapply: true,
            repairCandidates: [],
            targetIds: [] as string[],
        }));
        commandProjectDivergencePort.setProvider(classify);
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.collaboratorChange = true;
            },
        });
        const currentRevision = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-reapproval' })).resolves.toMatchObject({
            divergence: { kind: 'non-overlapping', mayReapply: true },
            status: 'reapproval_required',
        });
        expect(execute).not.toHaveBeenCalled();
        expect(validate).toHaveBeenCalledOnce();
        expect(classify).toHaveBeenCalledWith(
            expect.objectContaining({
                baseRevision: projectRevision,
                commandsCompatible: true,
                targetIds: expect.arrayContaining(['@project/transport/tempo']),
            })
        );
        expect(getPendingActionConfirmation('confirmation-reapproval')).toMatchObject({
            approvalSnapshot: {
                agentApproval: { sourceRevision: currentRevision },
                commandBatch: { authority: { baseRevision: currentRevision } },
            },
            projectRevision: currentRevision,
            status: 'proposed',
        });
        expect(agentRunLifecycle.get('confirmation-reapproval')?.revisions.approved).toBeNull();

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-reapproval' })).resolves.toEqual({
            status: 'executed',
        });
        expect(agentRunLifecycle.get('confirmation-reapproval')?.revisions.approved).toBe(currentRevision);
        expect(execute).toHaveBeenCalledOnce();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
    });

    it('keeps a confirmed batch authorized when its owned storage commit moves the project revision', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-self-revision', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-self-revision',
            batchId: 'group-self-revision',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-self-revision',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-self-revision',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-self-revision' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(projectRevision);
        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(getPendingActionConfirmation('confirmation-self-revision')).toMatchObject({ status: 'executed' });
    });

    it('invalidates and halts a confirmed batch when another owner flushes its unscoped pending write mid-action', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const bufferedStorage = createAutomergeStorage<{ touched: number }>('owned', 'buffered');
        const bufferedStore = createStore<{ touched: number }>({ storage: bufferedStorage });
        const reactiveStore = createStore<{ selected: string }>();
        const stopReacting = reactiveStore.subscribe(() => {
            flushAutomergeStorageWrites();
        });
        const executedBpms: number[] = [];
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            executedBpms.push(action.payload.bpm);
            ownedStorage.set({ bpm: action.payload.bpm });
            if (action.payload.bpm === 128) {
                reactiveStore.set({ selected: 'first action' });
            }
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        bufferedStore.set({ touched: 1 });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('buffered');
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-foreign-flush', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-foreign-flush',
            batchId: 'group-foreign-flush',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-foreign-flush',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-foreign-flush',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId: 'confirmation-foreign-flush' })).resolves.toEqual({
                status: 'invalidated',
                reason: 'The project changed after this proposal was created. Review and submit the command again.',
            });
        } finally {
            stopReacting();
        }

        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline + 1);
        expect(executedBpms).not.toContain(132);
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ buffered: { touched: 1 } });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(getPendingActionConfirmation('confirmation-foreign-flush')).toMatchObject({ status: 'invalidated' });
    });

    it('invalidates a confirmed batch when another app action commits while its first handler is paused', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let releaseFirstAction!: () => void;
        let markFirstActionStarted!: () => void;
        const firstActionStarted = new Promise<void>((resolve) => {
            markFirstActionStarted = resolve;
        });
        const firstActionRelease = new Promise<void>((resolve) => {
            releaseFirstAction = resolve;
        });
        const executedBpms: number[] = [];
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>(async (action) => {
            executedBpms.push(action.payload.bpm);
            if (action.payload.bpm === 144) {
                mutateCrdtDoc({
                    id: 'independent',
                    changeFn: (doc) => {
                        doc.foreignActionCommitted = true;
                    },
                });
                return;
            }
            ownedStorage.set({ bpm: action.payload.bpm });
            if (action.payload.bpm === 128) {
                markFirstActionStarted();
                await firstActionRelease;
            }
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-foreign-action', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-foreign-action',
            batchId: 'group-foreign-action',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-foreign-action',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-foreign-action',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-foreign-action' });
        await firstActionStarted;
        await executeAppAction({ type: 'setTempo', payload: { bpm: 144 } });
        releaseFirstAction();

        await expect(confirmation).resolves.toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(executedBpms).not.toContain(132);
        expect(executedBpms).toContain(144);
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ foreignActionCommitted: true });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(getPendingActionConfirmation('confirmation-foreign-action')).toMatchObject({ status: 'invalidated' });
    });

    it('authorizes a confirmed action that creates a project document while it executes', async () => {
        // The shape the createDrumPreviewBranches carve-out used to cover:
        // the action's own execution adds documents, so the document identity
        // epoch moves under the batch. Attribution replaces the carve-out —
        // the inserts happen inside the action's write scope, so they are the
        // batch's own effect whatever the action type is.
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            createCrdtDoc('candidate-1');
            createCrdtDoc('candidate-2');
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        expect(getCrdtDocIds()).not.toContain('candidate-1');
        expect(getCrdtDocIds()).not.toContain('candidate-2');
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-doc-creating', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-doc-creating',
            batchId: 'group-doc-creating',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-doc-creating',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 128 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-doc-creating',
            groupLabel: 'Set tempo',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-doc-creating' })).resolves.toEqual({
            status: 'executed',
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline);
        expect(captureProjectRevision()).not.toBe(projectRevision);
        expect(getCrdtDocIds()).toEqual(expect.arrayContaining(['candidate-1', 'candidate-2']));
        expect(getCrdtDoc<Record<string, unknown>>('candidate-1')).toBeDefined();
        expect(getCrdtDoc<Record<string, unknown>>('candidate-2')).toBeDefined();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 128 } });
    });

    it('invalidates a confirmed batch when an outside writer changed the project before confirmation', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-outside-writer', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-outside-writer',
            batchId: 'group-outside-writer',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-outside-writer',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 128 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-outside-writer',
            groupLabel: 'Set tempo',
            projectRevision,
        });

        // Somebody other than this proposal moves the project between the
        // proposal and the confirmation.
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.changedByAnotherWriter = true;
            },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-outside-writer' })
        ).resolves.toMatchObject({ status: 'invalidated' });
        expect(execute).not.toHaveBeenCalled();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            content: expect.stringContaining('project changed'),
        });
    });
});
