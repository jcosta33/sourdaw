import { logger } from '#/infra/logger/appLogger';
import { captureProjectIdentity, settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import {
    AGENT_RUN_TERMINAL_PHASES,
    type AgentRun,
    type AgentRunBatchSchedule,
    type AgentRunBulkSetBatchSchedule,
    type AgentRunProviderProposal,
    type AgentRunVibeRunBatchSchedule,
} from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { appendChatMessage } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { normalizeAgentPlanProposal } from '../../transformers/normalizeAgentPlanProposal';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { describeVibeBatchCard } from '../vibeRun/describeVibeBatchCard';
import { type CommittedVibeBatch, describeVibeRunSummary } from '../vibeRun/describeVibeRunSummary';

import { describeAppliedBatches } from './describeAppliedBatches';
import { executeImmediatePromptCommand } from './executeImmediatePromptCommand';
import { groundVibeRunBatch } from './groundVibeRunBatch';
import { materializePromptCommandPlan } from './materializePromptCommandPlan';
import { persistPromptActionConfirmation } from './persistPromptActionConfirmation';
import { readBulkSetSliceEvidence } from './readBulkSetSliceEvidence';
import { rebaseBulkSetSliceEvidence } from './rebaseBulkSetSliceEvidence';

type ScheduledBatchOutcome =
    { status: 'awaiting-approval' } | { status: 'executed' } | { status: 'rejected'; reason: string };

type GroundedScheduledBatch =
    | {
          status: 'grounded';
          result: IntentResult;
          context: ReturnType<typeof getProjectContext>;
          revision: string;
          /** Set only on a vibe-run batch: the planned batch its card describes and its preview measures. */
          vibeBatch?: ScheduledVibeRunBatch;
      }
    | { status: 'rejected'; reason: string };

type GroundedBatch = Extract<GroundedScheduledBatch, { status: 'grounded' }>;

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

function readProviderProposal(schedule: AgentRunBulkSetBatchSchedule): AgentRunProviderProposal | null | undefined {
    if (schedule.serializedProviderProposal === null) {
        return null;
    }
    try {
        return normalizeAgentPlanProposal(JSON.parse(schedule.serializedProviderProposal)) ?? undefined;
    } catch {
        return undefined;
    }
}

/** Grounds the bulk-set slice at `position` against the live project exactly as the planner grounded the first. */
function groundBulkSetSlice(
    run: AgentRun,
    schedule: AgentRunBulkSetBatchSchedule,
    position: number
): GroundedScheduledBatch {
    const requestProtections = schedule.requestProtections;
    if (requestProtections === undefined || requestProtections.request !== run.request) {
        return {
            status: 'rejected',
            reason: 'its original request protection binding is missing or no longer matches',
        };
    }
    const slices = schedule.slices.map((stored) => readBulkSetSliceEvidence(stored.serializedSlice));
    const evidence = slices[position - 1] ?? null;
    const providerProposal = readProviderProposal(schedule);
    if (evidence === null || slices.includes(null) || providerProposal === undefined) {
        return { status: 'rejected', reason: 'its stored plan could not be read back' };
    }
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const rebased = rebaseBulkSetSliceEvidence({
        evidence,
        context,
        revision,
        earlierCommands: slices.slice(0, position - 1).flatMap((earlier) => earlier?.commands ?? []),
        recordedFingerprints: new Map(
            slices.flatMap((stored) =>
                (stored?.selectors ?? []).flatMap((selector) =>
                    selector.preconditions.map(
                        (precondition) => [precondition.stableId, precondition.fingerprint] as const
                    )
                )
            )
        ),
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
        requestProtections,
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
        kind: schedule.kind,
        scheduleId: schedule.scheduleId,
        position,
        total: schedule.total,
        totalCommands: schedule.totalCommands,
        serializedProviderProposal: schedule.serializedProviderProposal,
        requestProtections: structuredClone(requestProtections),
        slices: structuredClone(schedule.slices),
    };
    return {
        status: 'grounded',
        context,
        revision,
        result: {
            actions: grounded.actions,
            metricGoalState: schedule.metricGoalState,
            actionCommandGraph: grounded.actionCommandGraph,
            rawText: run.request,
            requiresConfirmation: grounded.requiresConfirmation,
            applicationToolReceipts: structuredClone(run.plan?.applicationToolReceipts ?? []),
            terminalMeasurementSettlement: run.plan?.terminalMeasurementSettlement,
            executionMode: 'atomic',
            providerKnownTargetIds: grounded.providerKnownTargetIds,
            matchSelectorPredicates:
                grounded.matchSelectorPredicates.length === 0 ? undefined : grounded.matchSelectorPredicates,
            providerProposal: grounded.providerProposal ?? undefined,
            protectionFacts: grounded.protectionFacts,
            batchSchedule: plannedSchedule,
        },
    };
}

/** Grounds the slice at `position` by what the schedule's slices hold. */
function groundScheduledSlice(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number
): GroundedScheduledBatch {
    switch (schedule.kind) {
        case 'bulk-set':
            return groundBulkSetSlice(run, schedule, position);
        case 'vibe-run': {
            const grounded = groundVibeRunBatch(run, schedule, position);
            return grounded.status === 'grounded' ? { ...grounded, vibeBatch: grounded.batch } : grounded;
        }
        default: {
            const exhaustive: never = schedule;
            throw new Error(`Unsupported batch schedule kind: ${String(exhaustive)}`);
        }
    }
}

type MaterializedBatch = Extract<ReturnType<typeof materializePromptCommandPlan>, { status: 'prepared' }>;

/**
 * A vibe-run batch always waits for approval with a measured preview: the preview renders the live
 * project and the batch for every recipe step, under the run's own render budget, before the card
 * appears, and the approval is rebound to that proof so Confirm admits exactly what was measured. A
 * preview that cannot run fails the batch, which ends the run with the earlier batches applied.
 */
async function proposeMeasuredVibeBatch(input: {
    run: AgentRun;
    schedule: AgentRunBatchSchedule;
    position: number;
    grounded: GroundedBatch;
    batch: ScheduledVibeRunBatch;
    assistantMessageId: string;
    description: ReturnType<typeof describePendingActionConfirmation>;
    materialized: MaterializedBatch;
}): Promise<ScheduledBatchOutcome> {
    const { run, schedule, position, grounded, materialized } = input;
    const { compiledActionExecution, parsedCommandBatch, commandGroup } = materialized;
    const { commandBatch } = compiledActionExecution;
    const batchId = parsedCommandBatch.envelope.batchId;
    const state = metricGoalStateCodec(compiledActionExecution.metricGoalState);
    if (!compiledActionExecution.requiresConfirmation || state === null) {
        agentRunLifecycle.updateBatchStatus({ runId: run.runId, batchId, status: 'failed' });
        return { status: 'rejected', reason: 'its measured preview could not be prepared' };
    }
    let proof: Awaited<ReturnType<typeof prepareMetricGoalPreview>>;
    try {
        proof = await prepareMetricGoalPreview({
            state,
            commandBatch,
            context: grounded.context,
            prompt: run.request,
            runId: run.runId,
        });
    } catch (error) {
        agentRunLifecycle.updateBatchStatus({ runId: run.runId, batchId, status: 'failed' });
        return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
    }
    const approval = compileAgentRiskApproval({
        commandBatch,
        requireExplicitApproval: true,
        metricGoalState: JSON.stringify(proof.state),
    });
    const liveRun = agentRunLifecycle.get(run.runId);
    if (liveRun?.plan) {
        const priorReceipts = liveRun.plan.applicationToolReceipts ?? [];
        agentRunLifecycle.recordPlan({
            runId: liveRun.runId,
            summary: liveRun.plan.summary,
            commandIds: liveRun.plan.commandIds,
            serializedBatchIdentity: liveRun.plan.serializedBatchIdentity,
            revision: grounded.revision,
            scope: liveRun.scope,
            grants: liveRun.grants,
            budgets: liveRun.budgets,
            plan: {
                ...liveRun.plan,
                metricGoalState: approval.metricGoalState ?? undefined,
                applicationToolReceipts: [...priorReceipts, ...proof.receipts],
            },
        });
    }
    const evaluation = evaluateMetricGoalAdmission({ state: proof.state, commandBatch });
    const cardLines = describeVibeBatchCard({
        batch: input.batch,
        context: grounded.context,
        criteria: evaluation.criteria,
    });
    persistPromptActionConfirmation({
        runId: run.runId,
        prompt: run.request,
        assistantMessageId: input.assistantMessageId,
        actions: grounded.result.actions,
        actionLabels: input.description.actionLabels,
        commandEnvelopes: compiledActionExecution.commandEnvelopes,
        commandBatch,
        agentApproval: approval,
        metricGoalState: approval.metricGoalState ?? undefined,
        affectedIds: input.description.affectedIds,
        protectedUnchanged: input.description.protectedUnchanged,
        protectionFacts: grounded.result.protectionFacts,
        adoptedRecipes: grounded.result.adoptedRecipes,
        batchPosition: { index: position, total: schedule.total },
        executionMode: grounded.result.executionMode,
        group: commandGroup,
        projectRevision: grounded.revision,
        parsedCommandBatch,
        content: [input.description.content, ...cardLines].join('\n'),
    });
    return { status: 'awaiting-approval' };
}

/**
 * Plans, records and either parks the grounded batch for approval or, under a ceiling that approves
 * it, executes it — through the same plan, confirmation and execution path the first batch took.
 */
async function dispatchScheduledBatch(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number,
    grounded: GroundedBatch
): Promise<ScheduledBatchOutcome> {
    const assistantMessageId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: `Preparing batch ${String(position)} of ${String(schedule.total)}...`,
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: run.runId,
        projectId: captureProjectIdentity(),
    });
    const description = describePendingActionConfirmation({
        actions: grounded.result.actions,
        context: grounded.context,
        prompt: run.request,
        inheritedProtectedUnchanged: grounded.result.protectionFacts?.protectedUnchanged,
        requestProtectionFacts: grounded.result.protectionFacts,
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
    if (grounded.vibeBatch !== undefined) {
        return proposeMeasuredVibeBatch({
            run,
            schedule,
            position,
            grounded,
            batch: grounded.vibeBatch,
            assistantMessageId,
            description,
            materialized,
        });
    }
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
            metricGoalState: compiledActionExecution.metricGoalState,
            affectedIds: description.affectedIds,
            protectedUnchanged: description.protectedUnchanged,
            protectionFacts: grounded.result.protectionFacts,
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

/** Each committed batch of a finished vibe run, read from its executed card and the proof it was approved on. */
function readCommittedVibeBatches(run: AgentRun, schedule: AgentRunVibeRunBatchSchedule): CommittedVibeBatch[] | null {
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    if (plan === null) {
        return null;
    }
    return pendingActionConfirmationStore.value.confirmations
        .filter(
            (confirmation) =>
                confirmation.runId === run.runId &&
                confirmation.status === 'executed' &&
                (confirmation.approvalSnapshot.batchPosition?.index ?? 0) > 1
        )
        .toSorted(
            (left, right) =>
                (left.approvalSnapshot.batchPosition?.index ?? 0) - (right.approvalSnapshot.batchPosition?.index ?? 0)
        )
        .flatMap((confirmation) => {
            const position = confirmation.approvalSnapshot.batchPosition?.index ?? 0;
            const batch = plan.batches[position - 2];
            const commandBatch = confirmation.approvalSnapshot.commandBatch;
            if (batch === undefined || commandBatch === undefined) {
                return [];
            }
            const evaluation = evaluateMetricGoalAdmission({
                state: metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState),
                commandBatch,
            });
            return [{ position, batch, criteria: evaluation.criteria }];
        });
}

/**
 * A vibe run whose last batch committed ends with one message: what each approved batch moved, as
 * its preview measured it. A run that stopped earlier already said which batches stayed applied.
 */
function reportFinishedVibeRun(run: AgentRun | null): void {
    const schedule = run?.plan?.batchSchedule;
    if (!run || schedule?.kind !== 'vibe-run' || schedule.position < schedule.total) {
        return;
    }
    if (run.batches.at(-1)?.status !== 'committed') {
        return;
    }
    const batches = readCommittedVibeBatches(run, schedule);
    if (batches === null) {
        return;
    }
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: describeVibeRunSummary({ total: schedule.total, batches, context: getProjectContext() }),
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: run.runId,
        projectId: captureProjectIdentity(),
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
            reportFinishedVibeRun(run);
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
