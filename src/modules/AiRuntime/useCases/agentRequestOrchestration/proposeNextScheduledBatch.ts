import { logger } from '#/infra/logger/appLogger';
import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import {
    AGENT_RUN_TERMINAL_PHASES,
    type AgentRun,
    type AgentRunBatchSchedule,
    type AgentRunProviderProposal,
} from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { appendChatMessage } from '../../stores/chatStore';
import { normalizeAgentPlanProposal } from '../../transformers/normalizeAgentPlanProposal';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';

import { executeImmediatePromptCommand } from './executeImmediatePromptCommand';
import { materializePromptCommandPlan } from './materializePromptCommandPlan';
import { persistPromptActionConfirmation } from './persistPromptActionConfirmation';
import { readBulkSetSliceEvidence } from './readBulkSetSliceEvidence';
import { rebaseBulkSetSliceEvidence } from './rebaseBulkSetSliceEvidence';

type ScheduledBatchOutcome =
    { status: 'awaiting-approval' } | { status: 'executed' } | { status: 'rejected'; reason: string };

type GroundedScheduledBatch =
    | { status: 'grounded'; result: IntentResult; context: ReturnType<typeof getProjectContext>; revision: string }
    | { status: 'rejected'; reason: string };

/**
 * The next batch is owed only while the run is live, its schedule has a later position, and the
 * batch it most recently proposed has settled as committed or as a no-op. A failed, cancelled or
 * still-pending batch owes nothing further: its own settlement already told the user why.
 */
function getOwedSchedule(run: AgentRun | null): AgentRunBatchSchedule | null {
    const schedule = run?.plan?.batchSchedule;
    if (!run || schedule === undefined || AGENT_RUN_TERMINAL_PHASES.has(run.phase)) {
        return null;
    }
    const lastBatch = run.batches.at(-1);
    const settled = lastBatch?.status === 'committed' || lastBatch?.status === 'no-op';
    return settled && schedule.position < schedule.total ? schedule : null;
}

function readProviderProposal(schedule: AgentRunBatchSchedule): AgentRunProviderProposal | null | undefined {
    if (schedule.serializedProviderProposal === null) {
        return null;
    }
    try {
        return normalizeAgentPlanProposal(JSON.parse(schedule.serializedProviderProposal)) ?? undefined;
    } catch {
        return undefined;
    }
}

/** Grounds the slice at `position` against the live project exactly as the planner grounded the first. */
function groundScheduledSlice(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number
): GroundedScheduledBatch {
    const slice = schedule.slices[position - 1];
    const evidence = slice === undefined ? null : readBulkSetSliceEvidence(slice.serializedSlice);
    const providerProposal = readProviderProposal(schedule);
    if (evidence === null || providerProposal === undefined) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const rebased = rebaseBulkSetSliceEvidence({
        evidence,
        context,
        revision,
        runTouchedTargetIds: new Set(schedule.slices.slice(0, position - 1).flatMap((earlier) => earlier.targetIds)),
    });
    if (rebased.status === 'rejected') {
        return rebased;
    }
    const grounded = groundCompiledCommandBatch({
        toolCalls: rebased.evidence.commands,
        context,
        prompt: run.request,
        projectRevision: revision,
        workflowCapabilityId: undefined,
        compilerEvidence: rebased.evidence,
        selectedCompilations: [],
        transformCommands: [],
        transformTargetIds: [],
        creativeAuthority: undefined,
        providerProposal,
    });
    if (grounded.status === 'rejected') {
        return { status: 'rejected', reason: grounded.rejectionReason };
    }
    if (grounded.status === 'clarify') {
        return { status: 'rejected', reason: grounded.planningOutcome.reason };
    }
    if (grounded.status === 'empty') {
        return { status: 'rejected', reason: 'it no longer grounds to any executable action' };
    }
    const plannedSchedule: NonNullable<IntentResult['batchSchedule']> = {
        schemaVersion: schedule.schemaVersion,
        scheduleId: schedule.scheduleId,
        position,
        total: schedule.total,
        totalCommands: schedule.totalCommands,
        serializedProviderProposal: schedule.serializedProviderProposal,
        slices: structuredClone(schedule.slices),
    };
    return {
        status: 'grounded',
        context,
        revision,
        result: {
            actions: grounded.actions,
            actionCommandGraph: grounded.actionCommandGraph,
            rawText: run.request,
            requiresConfirmation: grounded.requiresConfirmation,
            applicationToolReceipts: structuredClone(run.plan?.applicationToolReceipts ?? []),
            executionMode: 'atomic',
            providerKnownTargetIds: grounded.providerKnownTargetIds,
            matchSelectorPredicates:
                grounded.matchSelectorPredicates.length === 0 ? undefined : grounded.matchSelectorPredicates,
            providerProposal: grounded.providerProposal ?? undefined,
            batchSchedule: plannedSchedule,
        },
    };
}

/**
 * Plans, records and either parks the grounded batch for approval or, under a ceiling that approves
 * it, executes it — through the same plan, confirmation and execution path the first batch took.
 */
async function dispatchScheduledBatch(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number,
    grounded: Extract<GroundedScheduledBatch, { status: 'grounded' }>
): Promise<ScheduledBatchOutcome> {
    const assistantMessageId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: `Preparing batch ${String(position)} of ${String(schedule.total)}...`,
        timestamp: Date.now(),
        isCommandAction: true,
    });
    const description = describePendingActionConfirmation({
        actions: grounded.result.actions,
        context: grounded.context,
        prompt: run.request,
    });
    const materialized = materializePromptCommandPlan({
        userText: run.request,
        runId: run.runId,
        assistantMessageId,
        interactionMode: schedule.interactionMode,
        trustCeiling: schedule.trustCeiling ?? undefined,
        resume: undefined,
        onResumedPlanAccepted: undefined,
        projectRevision: grounded.revision,
        context: grounded.context,
        result: { ...grounded.result, planningOutcome: { kind: 'proposal' } },
        actionLabels: description.actionLabels,
        protectedTargetIds: description.protectedUnchanged.map((item) => item.id),
    });
    if (materialized.status === 'terminal') {
        await materialized.completion;
        return { status: 'awaiting-approval' };
    }
    const { commandGroup, compiledActionExecution, parsedCommandBatch } = materialized;
    const { commandEnvelopes, commandBatch } = compiledActionExecution;
    if (compiledActionExecution.requiresConfirmation) {
        persistPromptActionConfirmation({
            runId: run.runId,
            prompt: run.request,
            assistantMessageId,
            actions: grounded.result.actions,
            actionLabels: description.actionLabels,
            commandEnvelopes,
            commandBatch,
            agentApproval: compiledActionExecution.agentApproval,
            affectedIds: description.affectedIds,
            protectedUnchanged: description.protectedUnchanged,
            matchSelectorPredicates: grounded.result.matchSelectorPredicates,
            batchPosition: { index: position, total: schedule.total },
            executionMode: grounded.result.executionMode,
            group: commandGroup,
            projectRevision: grounded.revision,
            parsedCommandBatch,
            content: description.content,
        });
        return { status: 'awaiting-approval' };
    }
    await executeImmediatePromptCommand({
        runId: run.runId,
        prompt: run.request,
        actions: grounded.result.actions,
        assistantMessageId,
        abortController: new AbortController(),
        projectRevision: grounded.revision,
        executionMode: grounded.result.executionMode,
        group: commandGroup,
        agentApproval: compiledActionExecution.allowApproval,
        commandBatch,
        parsedCommandBatch,
        onExecutionSettlementWarning: () => undefined,
    });
    return { status: 'executed' };
}

async function proposeScheduledBatch(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number
): Promise<ScheduledBatchOutcome> {
    try {
        const grounded = groundScheduledSlice(run, schedule, position);
        if (grounded.status === 'rejected') {
            return grounded;
        }
        return await dispatchScheduledBatch(run, schedule, position, grounded);
    } catch (error) {
        return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
    }
}

function describeAppliedBatches(position: number): string {
    return position === 2 ? 'Batch 1 remains applied.' : `Batches 1–${String(position - 1)} remain applied.`;
}

/**
 * A later batch that cannot be proposed as compiled is refused, never shrunk to what still fits: the
 * batches already committed stay, and the run ends partially completed with the user told which
 * batch stopped and why.
 */
function refuseScheduledBatch(run: AgentRun, schedule: AgentRunBatchSchedule, position: number, reason: string): void {
    try {
        agentRunLifecycle.recordError({
            runId: run.runId,
            error: normalizeAgentFailure({
                category: 'conflict',
                source: 'command-execution',
                related: { targetIds: schedule.slices[position - 1]?.targetIds ?? [] },
                knownDomain: true,
            }),
            terminal: true,
        });
    } catch (error) {
        logger.error(new Error('Scheduled batch refusal could not be recorded on its run', { cause: error }));
    }
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `Batch ${String(position)} of ${String(schedule.total)} was not proposed: ${reason.replace(/\.$/u, '')}. ${describeAppliedBatches(position)}`,
        timestamp: Date.now(),
        error: reason,
        isCommandAction: true,
    });
}

/**
 * Proposes the batch a schedule owes next, after the batch before it settled. Each batch crosses the
 * same grounding, approval, undo and receipt path the first did and needs its own approval; a batch
 * an approving trust ceiling executes at once is followed straight away by the one after it.
 */
export async function proposeNextScheduledBatch(input: { runId: string }): Promise<void> {
    for (;;) {
        const run = agentRunLifecycle.get(input.runId);
        const schedule = getOwedSchedule(run);
        if (run === null || schedule === null) {
            return;
        }
        const position = schedule.position + 1;
        const outcome = await proposeScheduledBatch(run, schedule, position);
        if (outcome.status === 'rejected') {
            refuseScheduledBatch(run, schedule, position, outcome.reason);
            return;
        }
        if (outcome.status === 'awaiting-approval') {
            return;
        }
    }
}
