import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { undoStore } from '#/modules/Command/stores';
import { undo } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { chatStore } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { materializePromptCommandPlan } from '../agentRequestOrchestration/materializePromptCommandPlan';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { refinedProposalSupersession } from '../agentRequestOrchestration/supersedeRefinedProposal';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { readChatThreadContext } from '../readChatThreadContext';

import {
    configureMetricGoalProject,
    resetMetricGoalProject,
    metricGoalProviderPlan,
    literalMetricIntakeTurn,
} from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider');
    }),
}));
beforeEach(() => {
    configureMetricGoalProject({
        label: 'refinement record',
        tracks: [createTrack({ id: 'drums', name: 'Drums', kind: 'audio' })],
        sections: [],
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
});
afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});
type LiteralCommand = { name: string; arguments: Record<string, unknown> };

type LiteralRequest = {
    prompt: string;
    runId: string;
    commands: readonly LiteralCommand[];
    refines?: string;
    targetIds?: readonly string[];
};

/** Plans one literal request through the scripted provider, persisting nothing. */
async function planLiteralRequest(input: LiteralRequest) {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const thread = input.refines === undefined ? null : readChatThreadContext();
    if (input.refines !== undefined) {
        expect(thread?.pendingProposal?.confirmationId).toBe(input.refines);
    }
    expect(
        agentRunLifecycle.create({
            runId: input.runId,
            request: input.prompt,
            mode: 'apply',
            createdRevision: revision,
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'planning' });
    const proposalArguments: Record<string, unknown> = {
        commands: input.commands,
        plan: metricGoalProviderPlan(input.prompt.trim(), input.targetIds ?? ['drums']),
    };
    if (input.refines !== undefined) {
        proposalArguments.refines = input.refines;
    }
    let turns = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        turns += 1;
        if (turns === 1) {
            return {
                status: 'complete',
                toolCalls: literalMetricIntakeTurn(userMessage, schemas).map((call) => ({
                    ...call,
                    id: `${input.runId}-intake`,
                })),
            };
        }
        if (turns === 2) {
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: `${input.runId}-discovery`,
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: input.commands.map((command) => command.name) },
                    },
                ],
            };
        }
        if (turns === 3) {
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: `${input.runId}-proposal`,
                        name: 'command.batch.propose',
                        arguments: proposalArguments,
                    },
                ],
            };
        }
        throw new Error('The literal request exceeded its three scripted provider turns.');
    });
    const planned = await parsePromptToActions({
        prompt: input.prompt,
        context,
        projectRevision: revision,
        thread,
        streamIdentity: { runId: input.runId, requestId: `${input.runId}-request`, cancellationGeneration: 0 },
        onMeasurementAttempt: agentWorkBudget.admitMeasurement(input.runId),
    });
    return { planned, context, revision };
}

function persistedMetricGoalState(stored: string | null | undefined, compiled: string | undefined): string | undefined {
    if (stored === undefined) {
        return compiled;
    }
    if (stored === null) {
        return undefined;
    }
    return stored;
}

/**
 * Plans a literal request and retains a conservative card through the owner API. The absent-record
 * case clears the stored snapshot after persistence, which otherwise falls back to compiled state.
 */
async function proposeLiteralCard(
    input: LiteralRequest & { storedMetricGoalState?: string | null }
): Promise<{ confirmationId: string; metricGoalState: string | undefined }> {
    const { planned, context, revision } = await planLiteralRequest(input);
    expect(planned.rejectionReason, JSON.stringify(planned.applicationToolReceipts)).toBeUndefined();
    expect(planned.refines).toBe(input.refines);
    expect(planned.requiresConfirmation).toBe(input.refines !== undefined);
    const assistantMessageId = `${input.runId}-assistant`;
    // Construct a conservative pending-card fixture through the real owner API. A fresh literal
    // proposal can auto-commit; the override does not claim parity with that initial policy.
    const materialized = materializePromptCommandPlan({
        userText: input.prompt,
        runId: input.runId,
        assistantMessageId,
        interactionMode: 'apply',
        trustCeiling: undefined,
        resume: undefined,
        onResumedPlanAccepted: undefined,
        projectRevision: revision,
        context,
        result: { ...planned, requiresConfirmation: true, planningOutcome: { kind: 'proposal' } },
        actionLabels: planned.actions.map((action) => action.type),
        protectedTargetIds: [],
    });
    if (materialized.status !== 'prepared' || materialized.compiledActionExecution.agentApproval === null) {
        throw new Error('Expected a persisted approval card for the literal request.');
    }
    const compiled = materialized.compiledActionExecution;
    chatStore.set({
        messages: [
            {
                id: `${input.runId}-user`,
                role: 'user',
                content: input.prompt,
                timestamp: 1,
                projectId: captureProjectIdentity(),
            },
            {
                id: assistantMessageId,
                role: 'assistant',
                content: 'Literal plan',
                timestamp: 2,
                agentRunId: input.runId,
                projectId: captureProjectIdentity(),
            },
        ],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
    const previous = input.refines === undefined ? null : refinedProposalSupersession.admit(input.refines);
    if (previous?.status === 'refused') {
        throw new Error(previous.reason);
    }
    const confirmationId = persistPromptActionConfirmation({
        runId: input.runId,
        prompt: input.prompt,
        assistantMessageId,
        actions: planned.actions,
        actionLabels: planned.actions.map((action) => action.type),
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: compiled.agentApproval,
        metricGoalState: persistedMetricGoalState(input.storedMetricGoalState, compiled.metricGoalState),
        affectedIds: ['drums'],
        protectedUnchanged: [],
        groundingBasis: planned.groundingBasis,
        executionMode: 'atomic',
        group: materialized.commandGroup,
        projectRevision: revision,
        parsedCommandBatch: materialized.parsedCommandBatch,
        content: input.prompt,
        supersedes: input.refines ?? null,
    });
    if (confirmationId === null) {
        throw new Error('The actual pending confirmation was not persisted.');
    }
    if (previous?.status === 'admitted') {
        await refinedProposalSupersession.retire(previous.confirmation, confirmationId);
    }
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'waiting-for-approval' });
    return { confirmationId, metricGoalState: compiled.metricGoalState };
}

describe('stored verification records during actual refinement', () => {
    it.each([
        ['empty', ''],
        ['absent', null],
    ] as const)('confirms a replacement of a %s record', async (_label, record) => {
        const original = await proposeLiteralCard({
            prompt: 'Raise Drums by 1 dB',
            runId: 'original',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 1 } }],
            storedMetricGoalState: record,
        });
        if (record === null) {
            const pending = pendingActionConfirmationStore.value;
            if (!pending) {
                throw new Error('Expected confirmation store');
            }
            pendingActionConfirmationStore.set({
                ...pending,
                confirmations: pending.confirmations.map((entry) => {
                    if (entry.id !== original.confirmationId) {
                        return entry;
                    }
                    return { ...entry, approvalSnapshot: { ...entry.approvalSnapshot, metricGoalState: undefined } };
                }),
            });
        }
        const old = pendingActionConfirmationStore.value?.confirmations.find(
            (entry) => entry.id === original.confirmationId
        );
        expect(old?.approvalSnapshot.metricGoalState).toBe(record ?? undefined);
        const refined = await proposeLiteralCard({
            prompt: 'Raise Drums by 2 dB instead',
            runId: 'refined',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 2 } }],
            refines: original.confirmationId,
        });
        expect(getAgentApprovalView({ confirmationId: refined.confirmationId })?.canConfirm).toBe(true);
        expect(await confirmPendingChatActions({ confirmationId: refined.confirmationId })).toEqual({
            status: 'executed',
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'drums')?.gain).toBeCloseTo(
            0.8 * 10 ** (2 / 20),
            10
        );
        flushAutomergeStorageWrites();
        const root = getCrdtDoc<{ tracks: { tracks: Array<{ id: string; gain: number }> } }>('root');
        expect(root?.tracks.tracks.find((track) => track.id === 'drums')?.gain).toBeCloseTo(0.8 * 10 ** (2 / 20), 10);
        expect(
            pendingActionConfirmationStore.value?.confirmations.find((entry) => entry.id === original.confirmationId)
        ).toMatchObject({ status: 'invalidated', supersededBy: refined.confirmationId });
        expect(undoStore.value?.past.length).toBeGreaterThan(0);
        expect(await undo()).toMatchObject({ headConsumed: true });
        flushAutomergeStorageWrites();
        expect(trackStore.value?.tracks.find((track) => track.id === 'drums')?.gain).toBeCloseTo(0.8, 10);
        expect(
            getCrdtDoc<{ tracks: { tracks: Array<{ id: string; gain: number }> } }>('root')?.tracks.tracks.find(
                (track) => track.id === 'drums'
            )?.gain
        ).toBeCloseTo(0.8, 10);
    });
    it('refuses a malformed nonempty record without a project write', async () => {
        const original = await proposeLiteralCard({
            prompt: 'Raise Drums by 1 dB',
            runId: 'original',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 1 } }],
            storedMetricGoalState: '{bad',
        });
        const predecessor = pendingActionConfirmationStore.value?.confirmations.find(
            (entry) => entry.id === original.confirmationId
        );
        if (!predecessor) {
            throw new Error('Expected the persisted predecessor');
        }
        const approvalBefore = structuredClone(predecessor.approvalSnapshot);
        expect(approvalBefore.metricGoalState).toBe('{bad');
        const before = structuredClone(trackStore.value);
        const revision = captureProjectRevision();
        const rawBefore = JSON.stringify(getCrdtDoc('root'));
        const { planned } = await planLiteralRequest({
            prompt: 'Raise Drums by 2 dB instead',
            runId: 'refined',
            commands: [{ name: 'setTrackGain', arguments: { trackId: 'drums', deltaDb: 2 } }],
            refines: original.confirmationId,
        });
        expect(planned).toMatchObject({
            actions: [],
            rejectionReason: "This proposal's verification record can no longer be read; start a fresh request.",
        });
        expect(trackStore.value).toEqual(before);
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(rawBefore);
        expect(captureProjectRevision()).toBe(revision);
        const retained = pendingActionConfirmationStore.value?.confirmations.find(
            (entry) => entry.id === original.confirmationId
        );
        expect(retained?.status).toBe('proposed');
        expect(retained?.approvalSnapshot).toEqual(approvalBefore);
    });
});
