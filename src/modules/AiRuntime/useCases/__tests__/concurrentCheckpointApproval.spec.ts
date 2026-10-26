import { change, clone, getConflicts, getHeads, merge } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreviewPort,
    compileVersionedCommandBatchEnvelope,
    executeAppAction,
    getVersionedCommandBatchIdempotentReplay,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCommandRecoveryWorkspace,
    createCrdtDoc,
    findAutomergeProjectConflicts,
    getCrdtDoc,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

function requireRoot() {
    const root = getCrdtDoc<Record<string, unknown> & { commandBatchIdempotency?: ReturnType<typeof peerCheckpoint> }>(
        'root'
    );
    if (!root) {
        throw new Error('Expected the project root');
    }
    return root;
}

function rootProjectTruth(): unknown {
    const { commandBatchIdempotency: _checkpoint, ...truth } = JSON.parse(JSON.stringify(requireRoot()));
    return truth;
}

function captureConcurrentBranches() {
    const base = change(clone(requireRoot()), (doc) => {
        doc.commandBatchIdempotency = { records: [] };
    });
    replaceCrdtDocInLineage({ id: 'root', doc: base });
    const local = change(clone(base, { actor: '3333333333333333' }), (doc) => {
        doc.tempo = 120;
    });
    const remote = change(clone(base, { actor: '4444444444444444' }), (doc) => {
        doc.projectLabel = 'sharedmix';
    });
    const branches = { local: clone(local), remote: clone(remote) };
    replaceCrdtDocInLineage({ id: 'root', doc: merge(local, remote) });
    expect(getHeads(requireRoot())).toHaveLength(2);
    return branches;
}

function peerCheckpoint(idempotencyKey: string) {
    const projectId = captureProjectIdentity();
    const contentHash = `sha256:${'a'.repeat(64)}`;
    return {
        records: [
            {
                id: `${projectId}\u0000${idempotencyKey}\u0000${contentHash}`,
                projectId,
                idempotencyKey,
                contentHash,
                state: 'complete',
                serializedReceipt: '{}',
            },
        ],
    };
}

function synchronizeCheckpoints(branches: ReturnType<typeof captureConcurrentBranches>): void {
    const capturedTruth = rootProjectTruth();
    const local = change(branches.local, (doc) => {
        if (!doc.commandBatchIdempotency) {
            throw new Error('Expected the initialized command checkpoint');
        }
        doc.commandBatchIdempotency.records.push(...peerCheckpoint('batch-peer-local').records);
    });
    const remote = change(branches.remote, (doc) => {
        if (!doc.commandBatchIdempotency) {
            throw new Error('Expected the initialized command checkpoint');
        }
        doc.commandBatchIdempotency.records.push(...peerCheckpoint('batch-peer-remote').records);
    });
    replaceCrdtDocInLineage({ id: 'root', doc: merge(local, remote) });
    expect(getHeads(requireRoot())).toHaveLength(2);
    expect(
        requireRoot()
            .commandBatchIdempotency?.records.map((record) => record.idempotencyKey)
            .toSorted()
    ).toEqual(['batch-peer-local', 'batch-peer-remote']);
    expect(findAutomergeProjectConflicts({ document: requireRoot() })).toEqual([]);
    expect(rootProjectTruth()).toEqual(capturedTruth);
}

function proposeTempoChange() {
    const projectRevision = captureProjectRevision();
    const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
    const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        expectedEffect: 'Tempo changes to 132 BPM.',
        normalizedProjectRevision: projectRevision,
        options: { groupId: 'approved-tempo', groupLabel: 'Set tempo', source: 'prompt' },
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'checkpoint-approval',
        batchId: 'approved-tempo',
        projectId: captureProjectIdentity(),
        baseRevision: projectRevision,
        intent: 'set tempo to 132',
        commands: [serializeVersionedCommandEnvelope(envelope)],
    });
    proposePendingActionConfirmation({
        id: 'confirmation-checkpoints',
        prompt: 'set tempo to 132',
        assistantMessageId: 'assistant-1',
        actions: [action],
        actionLabels: ['Set tempo'],
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        groupId: 'approved-tempo',
        groupLabel: 'Set tempo',
        projectRevision,
    });
    return commandBatch;
}

describe('confirmation after concurrent command checkpoints', () => {
    let executedTempos: number[];

    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
        resetCrdtProjectAuthority('concurrent checkpoint approval');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        commandBatchPreviewPort.setRecoveryProvider(createCommandRecoveryWorkspace);
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
        executedTempos = [];
        const storage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                execute: (action: SetTempoAction) => {
                    executedTempos.push(action.payload.bpm);
                    storage.set({ bpm: action.payload.bpm });
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                undoable: true,
                validate: () => true,
            },
        });
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        resetAiWorkflowCommandPreflightFixture();
        commandBatchPreviewPort.setRecoveryProvider(null);
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        clearPendingActionConfirmations();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('executes the original approval exactly once and retains its receipt and undo after checkpoint-only sync', async () => {
        const branches = captureConcurrentBranches();
        const commandBatch = proposeTempoChange();
        const approval = getPendingActionConfirmation('confirmation-checkpoints')?.approvalSnapshot.agentApproval;
        synchronizeCheckpoints(branches);
        expect(captureProjectRevision()).not.toBe(commandBatch.authority.baseRevision);

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-checkpoints' })).resolves.toEqual({
            status: 'executed',
        });

        expect(executedTempos).toEqual([132]);
        expect(getCrdtDoc('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(getPendingActionConfirmation('confirmation-checkpoints')?.approvalSnapshot.agentApproval).toEqual(
            approval
        );
        expect(undoStore.value?.past).toHaveLength(1);
        expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
        const replay = await getVersionedCommandBatchIdempotentReplay({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        expect(replay).toMatchObject({
            outcome: 'committed',
            batchId: 'approved-tempo',
            compensation: { available: true },
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-checkpoints' })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'executed',
        });
        expect(executedTempos).toEqual([132]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
        await undo();
        expect(getCrdtDoc('owned')).toMatchObject({ transport: { bpm: 120 } });
    });

    it('refuses conflicting whole-map checkpoints without applying or rebinding the original approval', async () => {
        const branches = captureConcurrentBranches();
        const commandBatch = proposeTempoChange();
        const confirmation = getPendingActionConfirmation('confirmation-checkpoints');
        if (!confirmation) {
            throw new Error('Expected the pending approval');
        }
        const originalApproval = structuredClone(confirmation.approvalSnapshot);
        const capturedTruth = rootProjectTruth();
        const localCheckpoint = peerCheckpoint('batch-conflicting-local');
        const remoteCheckpoint = peerCheckpoint('batch-conflicting-remote');
        const local = change(branches.local, (doc) => {
            doc.commandBatchIdempotency = localCheckpoint;
        });
        const remote = change(branches.remote, (doc) => {
            doc.commandBatchIdempotency = remoteCheckpoint;
        });
        replaceCrdtDocInLineage({ id: 'root', doc: merge(local, remote) });

        expect(getHeads(requireRoot())).toHaveLength(2);
        expect(rootProjectTruth()).toEqual(capturedTruth);
        expect(Object.values(getConflicts(requireRoot(), 'commandBatchIdempotency') ?? {})).toEqual(
            expect.arrayContaining([localCheckpoint, remoteCheckpoint])
        );
        const conflicts = findAutomergeProjectConflicts({ document: requireRoot() });
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]?.path).toEqual(['commandBatchIdempotency']);
        expect(conflicts[0]?.conflictIds).toHaveLength(2);
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(commandBatch.authority.baseRevision)).toBe(true);
        const beforeConfirmation = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-checkpoints' })).resolves.toEqual({
            status: 'failed',
            reason: 'Command batch project divergence is invariant-breaking',
        });

        expect(executedTempos).toEqual([]);
        expect(captureProjectRevision()).toBe(beforeConfirmation);
        expect(getCrdtDoc('owned')).not.toHaveProperty('transport');
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
        const refusedConfirmation = getPendingActionConfirmation('confirmation-checkpoints');
        expect(refusedConfirmation?.approvalSnapshot).toEqual(originalApproval);
        expect(refusedConfirmation?.projectRevision).toBe(confirmation.projectRevision);
        const refusalReceipt = await getVersionedCommandBatchIdempotentReplay({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        expect(refusalReceipt).toMatchObject({
            outcome: 'conflicted',
            batchId: 'approved-tempo',
            commandOutcomes: [{ operation: 'setTempo', outcome: 'not-applied', compensationAvailable: false }],
            compensation: { available: false },
        });
    });

    it.each(['edit', 'edit then restore', 'discarded history'] as const)(
        'refuses the old approval after a real %s despite checkpoint-only sync',
        async (scenario) => {
            await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
            clearUndoHistory();
            executedTempos = [];
            const branches = captureConcurrentBranches();
            const approvedChild = getCrdtDoc('owned');
            if (!approvedChild) {
                throw new Error('Expected the approved child document');
            }
            const childSnapshot = clone(approvedChild);
            const commandBatch = proposeTempoChange();
            synchronizeCheckpoints(branches);

            await executeAppAction({ type: 'setTempo', payload: { bpm: 128 } });
            if (scenario === 'edit then restore') {
                await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
            } else if (scenario === 'discarded history') {
                replaceCrdtDocInLineage({ id: 'owned', doc: childSnapshot });
            }
            clearUndoHistory();
            executedTempos = [];
            const beforeConfirmation = captureProjectRevision();

            const result = await confirmPendingChatActions({ confirmationId: 'confirmation-checkpoints' });

            expect(['invalidated', 'reapproval_required']).toContain(result.status);
            expect(executedTempos).toEqual([]);
            expect(captureProjectRevision()).toBe(beforeConfirmation);
            expect(getCrdtDoc<{ transport?: { bpm: number } }>('owned')?.transport?.bpm).not.toBe(132);
            expect(undoStore.value?.past).toEqual([]);
            expect(aiActionHistoryStore.value?.groups).toEqual([]);
            expect(
                await getVersionedCommandBatchIdempotentReplay({
                    authority: commandBatch.authority,
                    serialized: commandBatch.serialized,
                })
            ).toBeNull();
        }
    );
});
