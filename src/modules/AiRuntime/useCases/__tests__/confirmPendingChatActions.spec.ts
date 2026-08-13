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
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
    commandProjectRevisionPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
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
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        clearPendingActionConfirmations();
        resetCrdtProjectAuthority('AI confirmation admission');
        createCrdtDoc('independent');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        commandProjectRevisionPort.setProvider(captureProjectRevision);
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
        resetAiWorkflowCommandPreflightFixture();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        clearPendingActionConfirmations();
        commandProjectRevisionPort.setProvider(null);
    });

    it('invalidates a confirmed action when the project changes while batch admission is waiting', async () => {
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                execute,
                describe: () => ({
                    label: 'Set tempo',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
                }),
                undoable: true,
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
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: () => ({
                    label: 'Generic handler label',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
                }),
                undoable: true,
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
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: () => ({
                    label: 'Set tempo',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
                }),
                undoable: true,
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
    });
});
