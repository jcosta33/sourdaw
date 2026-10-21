import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoHistoryStore } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    createVersionedCommandReceipt,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { clearAiHistory } from '../../../stores/aiActionHistoryStore';
import { appendChatMessage, clearChatMessages } from '../../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    type PendingAppActionConfirmation,
    proposePendingActionConfirmation,
    recordPendingActionExecution,
} from '../../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { readChatThreadContext } from '../../readChatThreadContext';
import { settleVerifiedBatchReplay } from '../settleVerifiedBatchReplay';

type ReplayInput = Parameters<typeof settleVerifiedBatchReplay>[0];
type Actions = PendingAppActionConfirmation['actions'];

const TEMPO = { type: 'setTempo', payload: { bpm: 132 } } satisfies Actions[number];
const SEEK = { type: 'seekPlayhead', payload: { beat: 8 } } satisfies Actions[number];

function createReplay(input: {
    id: string;
    actions: Actions;
    status: 'committed' | 'executed' | 'executed-with-warning';
    appliedIndexes?: number[];
}): ReplayInput {
    const runId = `run-${input.id}`;
    const batchId = `batch-${input.id}`;
    const commands = input.actions.map((action) =>
        createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: `Apply ${action.type}.`,
            normalizedProjectRevision: 'revision-1',
            objectReferences: [],
            parameterUnits:
                action.type === 'setTempo'
                    ? [{ argument: 'bpm', unit: 'beats-per-minute' }]
                    : [{ argument: 'beat', unit: 'beats' }],
            reason: `Requested ${action.type}.`,
            time:
                action.type === 'seekPlayhead'
                    ? [{ argument: 'beat', domain: 'musical', unit: 'beats', value: action.payload.beat }]
                    : [],
        })
    );
    const commandEnvelopes = commands.map(serializeVersionedCommandEnvelope);
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId,
        batchId,
        projectId: captureProjectIdentity(),
        baseRevision: 'revision-1',
        intent: `Request ${input.id}.`,
        commands: commandEnvelopes,
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error(parsed.reason);
    }
    const appliedIndexes = input.appliedIndexes ?? input.actions.map((_, index) => index);
    const receipt = createVerifiedBatchReceipt({
        contentHash: `sha256:${'a'.repeat(64)}`,
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: input.status === 'committed' ? 'revision-2' : 'revision-1',
        result: {
            status: input.status,
            ...(input.status === 'executed-with-warning' ? { warning: 'Transport observer failed.' } : {}),
            actions: input.actions.flatMap((action, index) => {
                const command = commands[index];
                if (command === undefined || !appliedIndexes.includes(index)) {
                    return [];
                }
                return [{ action, receipt: createVersionedCommandReceipt({ envelope: command }) }];
            }),
        },
    });
    const assistantMessageId = `assistant-${input.id}`;
    appendChatMessage({ id: `user-${input.id}`, role: 'user', content: input.id, timestamp: 0 });
    appendChatMessage({ id: assistantMessageId, role: 'assistant', content: 'Review.', timestamp: 0 });
    const confirmation = proposePendingActionConfirmation({
        id: `confirmation-${input.id}`,
        runId,
        prompt: input.id,
        assistantMessageId,
        actions: input.actions,
        actionLabels: input.actions.map((action, index) => `Approved ${action.type} ${String(index + 1)}`),
        commandEnvelopes,
        commandBatch,
        projectRevision: 'revision-1',
    });
    if (confirmation === null) {
        throw new Error('Expected confirmation admission.');
    }
    expect(
        agentRunLifecycle.create({ runId, request: input.id, mode: 'apply', createdRevision: 'revision-1' })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning', revision: 'revision-1' });
    agentRunLifecycle.transitionPhase({ runId, phase: 'executing', revision: 'revision-1' });
    agentRunLifecycle.recordBatch({
        runId,
        batch: {
            batchId,
            commandIds: commands.map((command) => command.commandId),
            status: 'executing',
            receiptIdentity: null,
        },
    });
    return { confirmation, approvedBatchId: batchId, receipt };
}

function resetThread(): void {
    clearPendingActionConfirmations();
    clearChatMessages();
    clearAiHistory();
    agentRunLifecycle.clear();
    undoHistoryStore.set({ past: [], future: [] });
}

beforeEach(resetThread);
afterEach(resetThread);

describe('verified replay settlement read by the planner thread', () => {
    it.each(['executed', 'executed-with-warning'] as const)(
        'keeps the earlier project commit after an interrupted %s seek settlement',
        async (status) => {
            const project = createReplay({ id: 'tempo', actions: [TEMPO], status: 'committed' });
            await settleVerifiedBatchReplay(project);
            const priorCommit = readChatThreadContext()?.lastCommit;
            expect(priorCommit?.commands).toMatchObject([{ name: 'setTempo' }]);
            const runtime = createReplay({ id: 'seek', actions: [SEEK], status });
            expect(getPendingActionConfirmation(runtime.confirmation.id)?.executedActions).toEqual([]);

            await expect(settleVerifiedBatchReplay(runtime)).resolves.toEqual({ status: 'executed' });

            expect(readChatThreadContext()?.lastCommit).toEqual(priorCommit);
            expect(getPendingActionConfirmation(runtime.confirmation.id)).toMatchObject({
                status: 'executed',
                executedActions: [
                    {
                        actionType: 'seekPlayhead',
                        executionKind: 'runtime',
                        outcome: status,
                        label: 'Approved seekPlayhead 1',
                    },
                ],
            });
            expect(agentRunLifecycle.get(runtime.confirmation.runId)?.receipts).toMatchObject([
                { workId: runtime.approvedBatchId, revertGroupId: null },
            ]);
        }
    );

    it('keeps a replayed project commit newest and unknown when its undo entries have no group', async () => {
        const older = createReplay({ id: 'older', actions: [TEMPO], status: 'committed' });
        await settleVerifiedBatchReplay(older);
        const project = createReplay({ id: 'newer', actions: [TEMPO], status: 'committed' });
        undoHistoryStore.set({
            past: [
                {
                    id: 'ungrouped',
                    kind: 'action',
                    action: TEMPO,
                    inverseAction: null,
                    label: 'Tempo',
                    source: 'prompt',
                    timestamp: 0,
                },
            ],
            future: [],
        });

        await settleVerifiedBatchReplay(project);

        expect(getPendingActionConfirmation(project.confirmation.id)?.executedActions).toMatchObject([
            { actionType: 'setTempo', executionKind: 'project', outcome: 'committed' },
        ]);
        expect(readChatThreadContext()?.lastCommit).toMatchObject({
            runId: project.confirmation.runId,
            standing: 'unknown',
            commands: [{ name: 'setTempo' }],
        });
    });

    it('records only receipt-positive commands, preserving their original approval labels past a no-op', async () => {
        const replay = createReplay({ id: 'mixed', actions: [TEMPO, TEMPO], status: 'committed', appliedIndexes: [1] });
        expect(replay.receipt.commandOutcomes.map((command) => command.outcome)).toEqual(['no-op', 'committed']);

        await settleVerifiedBatchReplay(replay);

        expect(getPendingActionConfirmation(replay.confirmation.id)?.executedActions).toEqual([
            expect.objectContaining({
                commandId: replay.receipt.commandOutcomes[1]?.commandId,
                label: 'Approved setTempo 2',
                executionKind: 'project',
                outcome: 'committed',
            }),
        ]);
    });

    it('preserves detailed execution records and restores a missing sibling once across repeated settlement', async () => {
        const replay = createReplay({ id: 'reported', actions: [TEMPO, TEMPO], status: 'committed' });
        const commandId = replay.receipt.commandOutcomes[0]?.commandId;
        if (commandId === undefined) {
            throw new Error('Expected first command identity.');
        }
        const execution = {
            commandId,
            actionType: 'setTempo',
            commandSchemaVersion: 1,
            label: 'Detailed original label',
            executionKind: 'project',
            affectedIds: ['retained-affected-id'],
            applicationAssigned: {
                ids: [{ field: 'historyId', value: 'history-original' }],
                timestamps: [{ field: 'committedAt', value: 42 }],
            },
            outcome: 'committed',
        } satisfies PendingAppActionConfirmation['executedActions'][number];
        recordPendingActionExecution({ confirmationId: replay.confirmation.id, execution });

        await settleVerifiedBatchReplay(replay);
        await settleVerifiedBatchReplay(replay);

        const executions = getPendingActionConfirmation(replay.confirmation.id)?.executedActions;
        expect(executions).toHaveLength(2);
        expect(executions?.[0]).toEqual(execution);
        expect(executions?.[1]).toMatchObject({
            commandId: replay.receipt.commandOutcomes[1]?.commandId,
            executionKind: 'project',
        });
    });
});
