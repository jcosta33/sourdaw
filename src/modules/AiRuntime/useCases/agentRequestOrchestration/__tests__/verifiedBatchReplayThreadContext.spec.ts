import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    createVersionedCommandReceipt,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    parseVersionedCommandEnvelope,
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
import { admitCommittedSectionRenderRetry } from '../admitCommittedSectionRenderRetry';
import { projectSectionRenderConfirmation } from '../projectSectionRenderConfirmation';
import { settleVerifiedBatchReplay } from '../settleVerifiedBatchReplay';

type ReplayInput = Parameters<typeof settleVerifiedBatchReplay>[0];
type Actions = PendingAppActionConfirmation['actions'];
type ReceiptWarning = NonNullable<Parameters<typeof createVerifiedBatchReceipt>[0]['result']['warningDetails']>[number];

const TEMPO = { type: 'setTempo', payload: { bpm: 132 } } satisfies Actions[number];
const SEEK = { type: 'seekPlayhead', payload: { beat: 8 } } satisfies Actions[number];

function createReplay(input: {
    id: string;
    actions: Actions;
    status: 'committed' | 'committed-with-warning' | 'executed' | 'executed-with-warning';
    appliedIndexes?: number[];
}): ReplayInput {
    const runId = `run-${input.id}`;
    const batchId = `batch-${input.id}`;
    const commands = input.actions.map((action) => {
        if (action.type === 'addDevice') {
            return createVersionedCommandEnvelope({
                action,
                applicationAssignedIds: [{ argument: 'deviceId', value: 'device-restored' }],
                availableDeviceVersions: {},
                expectedEffect: 'Add effect.',
                normalizedProjectRevision: 'revision-1',
                objectReferences: [
                    { argument: 'trackId', id: action.payload.trackId, scope: 'stable' },
                    { argument: 'deviceId', id: 'device-restored', scope: 'stable' },
                ],
                parameterUnits: [],
                reason: 'Add effect.',
                time: [],
            });
        }
        if (action.type !== 'setTempo' && action.type !== 'seekPlayhead') {
            return migrateLegacyAppActionToVersionedCommandEnvelope({
                action,
                expectedEffect: `Apply ${action.type}.`,
                normalizedProjectRevision: 'revision-1',
            });
        }
        let parameterUnits = [{ argument: 'bpm', unit: 'beats-per-minute' }];
        const time: Parameters<typeof createVersionedCommandEnvelope>[0]['time'][number][] = [];
        if (action.type === 'seekPlayhead') {
            parameterUnits = [{ argument: 'beat', unit: 'beats' }];
            time.push({ argument: 'beat', domain: 'musical', unit: 'beats', value: action.payload.beat });
        }
        return createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: `Apply ${action.type}.`,
            normalizedProjectRevision: 'revision-1',
            objectReferences: [],
            parameterUnits,
            reason: `Requested ${action.type}.`,
            time,
        });
    });
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
    let warning: string | undefined;
    if (input.status === 'executed-with-warning') {
        warning = 'Transport observer failed.';
    } else if (input.status === 'committed-with-warning') {
        warning = 'Section rendering remains incomplete.';
    }
    const receipt = createVerifiedBatchReceipt({
        contentHash: `sha256:${'a'.repeat(64)}`,
        envelope: parsed.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: input.status === 'committed' ? 'revision-2' : 'revision-1',
        result: {
            status: input.status,
            warning,
            warningDetails: commands.flatMap((command) => {
                if (input.status !== 'committed-with-warning' || command.operation !== 'renderProjectSections') {
                    return [];
                }
                return [
                    {
                        kind: 'external-effect',
                        message: 'Renderer unavailable.',
                        commandId: command.commandId,
                        pendingEffect: {
                            commandId: command.commandId,
                            operation: command.operation,
                            reason: 'Renderer unavailable.',
                            state: 'pending',
                            kind: 'external-effect',
                            remediation: 'reconcile',
                        },
                    } satisfies ReceiptWarning,
                ];
            }),
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
    clearHandlerRegistry();
    clearPendingActionConfirmations();
    clearChatMessages();
    clearAiHistory();
    agentRunLifecycle.clear();
    undoHistoryStore.set({ past: [], future: [] });
}

beforeEach(() => {
    resetThread();
    registerHandlerMap(getAudioRenderingHandlers());
});
afterEach(resetThread);

describe('verified replay settlement read by the planner thread', () => {
    it('restores approved metadata in the real receipt presentation without replacing a rich sibling', async () => {
        const device = {
            type: 'addDevice',
            payload: { trackId: 'track-a', deviceType: 'builtin-compressor', deviceId: 'device-restored' },
        } satisfies Actions[number];
        const replay = createReplay({ id: 'metadata', actions: [TEMPO, device], status: 'committed' });
        const richExecution = {
            commandId: replay.receipt.commandOutcomes[0]?.commandId,
            actionType: 'setTempo',
            commandSchemaVersion: 1,
            label: 'Original detailed tempo',
            executionKind: 'project',
            affectedIds: ['tempo-original'],
            applicationAssigned: {
                ids: [{ field: 'historyId', value: 'history-original' }],
                timestamps: [{ field: 'committedAt', value: 42 }],
            },
            outcome: 'committed',
        } satisfies PendingAppActionConfirmation['executedActions'][number];
        recordPendingActionExecution({ confirmationId: replay.confirmation.id, execution: richExecution });
        const serialized = replay.confirmation.approvalSnapshot.commandEnvelopes?.[1];
        if (!serialized) {
            throw new Error('Expected approved device command.');
        }
        const approved = parseVersionedCommandEnvelope(serialized);
        if (approved.status !== 'valid') {
            throw new Error(approved.reason);
        }

        await settleVerifiedBatchReplay(replay);
        await settleVerifiedBatchReplay(replay);

        const restored = getPendingActionConfirmation(replay.confirmation.id);
        if (!restored) {
            throw new Error('Expected restored confirmation.');
        }
        const presentation = projectSectionRenderConfirmation({ confirmation: restored });
        expect(presentation.receipt).toContain(`Command: v1 ${approved.envelope.commandId}`);
        expect(presentation.receipt).toContain(`commandId=${approved.envelope.commandId}, objectId=device-restored`);
        expect(presentation.receipt).toContain(`issuedAt=${String(approved.envelope.issuedAt)}`);
        expect(restored.executedActions).toHaveLength(2);
        expect(restored.executedActions[0]).toEqual(richExecution);
        expect(restored.executedActions[1]?.applicationAssigned).toEqual({
            ids: [
                { field: 'commandId', value: approved.envelope.commandId },
                { field: 'objectId', value: 'device-restored' },
            ],
            timestamps: [{ field: 'issuedAt', value: approved.envelope.issuedAt }],
        });
    });

    it('restores schema metadata required by the real committed section-render retry admission', async () => {
        const action = {
            type: 'renderProjectSections',
            payload: {
                sectionIds: ['section-verse'],
                jobs: [
                    {
                        jobId: 'render-verse',
                        sectionId: 'section-verse',
                        sectionName: 'Verse',
                        startBeat: 0,
                        endBeat: 16,
                        sampleRate: 44_100,
                        tailSeconds: 0,
                    },
                ],
            },
        } satisfies Actions[number];
        const replay = createReplay({ id: 'render', actions: [action], status: 'committed-with-warning' });

        await expect(settleVerifiedBatchReplay(replay)).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
        });

        const restored = getPendingActionConfirmation(replay.confirmation.id);
        if (!restored) {
            throw new Error('Expected restored render confirmation.');
        }
        expect(
            admitCommittedSectionRenderRetry({
                confirmation: restored,
                durableReceipt: replay.receipt,
                phase: 'arming',
            })
        ).toEqual({ status: 'admitted', durableReceipt: replay.receipt });
    });
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
