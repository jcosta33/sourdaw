import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    configureCommandBatchIdempotency,
    commandProjectDivergencePort,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
    commandProjectRevisionPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCommandRecoveryWorkspace,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    mutateCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

describe('confirmPendingChatActions transaction admission', () => {
    beforeEach(() => {
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
        const proposal = {
            id: 'confirmation-1',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [{ type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction],
            actionLabels: ['Set tempo'],
            executionMode: 'atomic' as const,
            projectRevision: captureProjectRevision(),
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

        proposePendingActionConfirmation({
            ...proposal,
            id: 'confirmation-2',
            projectRevision: captureProjectRevision(),
        });
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-2' })).resolves.toEqual({
            status: 'executed',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 128 } });
    });

    it('executes the immutable command envelope and retains its exact approval label in the receipt', async () => {
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
            status: 'executed',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 128 } });
        expect(chatStore.value?.messages[0]?.content).toContain('Set tempo from 120 BPM to 128 BPM');
        expect(chatStore.value?.messages[0]?.content).toContain(`Command: v1 ${envelope.commandId}`);
    });

    it('executes the approved outer command batch instead of the legacy envelope array', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn((action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }));
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
        proposePendingActionConfirmation({
            id: 'confirmation-batch',
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

        proposePendingActionConfirmation({
            id: 'confirmation-batch-retry',
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

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-reapproval' })).resolves.toEqual({
            status: 'executed',
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
    });
});
