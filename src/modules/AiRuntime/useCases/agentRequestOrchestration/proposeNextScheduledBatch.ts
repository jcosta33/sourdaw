import { logger } from '#/infra/logger/appLogger';
import { captureProjectIdentity, settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import {
    AGENT_RUN_TERMINAL_PHASES,
    type AgentRun,
    type AgentRunBatch,
    type AgentRunBatchSchedule,
    type AgentRunBulkSetBatchSchedule,
    type AgentRunProviderProposal,
    type AgentRunVibeRunBatchSchedule,
} from '../../models/AgentRun';
import { type IntentResult } from '../../models/IntentResult';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { appendChatMessage, removeChatMessage, updateChatMessage } from '../../stores/chatStore';
import { normalizeAgentPlanProposal } from '../../transformers/normalizeAgentPlanProposal';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { buildVibeBatchValueRequest } from '../vibeRun/buildVibeBatchValueRequest';
import { chooseVibeBatchValues, type VibeBatchValueChoice } from '../vibeRun/chooseVibeBatchValues';
import { describeVibeBatchCard } from '../vibeRun/describeVibeBatchCard';

import { describeAppliedBatches } from './describeAppliedBatches';
import { describeBatchPreviewProgress } from './describeBatchPreviewProgress';
import { executeImmediatePromptCommand } from './executeImmediatePromptCommand';
import { groundVibeRunBatch } from './groundVibeRunBatch';
import { materializePromptCommandPlan } from './materializePromptCommandPlan';
import { persistPromptActionConfirmation } from './persistPromptActionConfirmation';
import { postVibeRunSummary } from './postVibeRunSummary';
import { preflightVibeRunBatch } from './preflightVibeRunBatch';
import { readBulkSetSliceEvidence } from './readBulkSetSliceEvidence';
import { readSkippedVibeBatchPositions } from './readSkippedVibeBatchPositions';
import { rebaseBulkSetSliceEvidence } from './rebaseBulkSetSliceEvidence';
import { settleStoppedBatchPreparation } from './settleStoppedBatchPreparation';

type ScheduledBatchOutcome =
    | { status: 'awaiting-approval' }
    | { status: 'executed' }
    | { status: 'stopped' }
    | { status: 'rejected'; reason: string };

type GroundedScheduledBatch =
    | {
          status: 'grounded';
          result: IntentResult;
          context: ReturnType<typeof getProjectContext>;
          revision: string;
          /**
           * Set only on a vibe-run batch: the planned batch its card describes and its preview
           * measures, and where its recipe values came from.
           */
          vibe?: { batch: ScheduledVibeRunBatch; valueChoice: VibeBatchValueChoice };
      }
    | { status: 'rejected'; reason: string };

type GroundedBatch = Extract<GroundedScheduledBatch, { status: 'grounded' }>;

/**
 * Whether the batch a schedule most recently proposed lets the next one follow: committed or a no-op
 * for either kind, and on a vibe run also skipped, since its batches are grounded from the plan
 * against the live project and none rebases on another. A bulk-set slice is never skipped.
 */
function letsNextBatchFollow(status: AgentRunBatch['status'] | undefined, schedule: AgentRunBatchSchedule): boolean {
    return status === 'committed' || status === 'no-op' || (status === 'skipped' && schedule.kind === 'vibe-run');
}

/**
 * The next batch is owed only while the run is live, its schedule has a later position, and the
 * batch it most recently proposed has settled as committed, as a no-op or, on a vibe run, as
 * skipped. A failed, cancelled or still-pending batch owes nothing further: its own settlement
 * already told the user why.
 */
function getOwedSchedule(run: AgentRun | null): AgentRunBatchSchedule | null {
    const schedule = run?.plan?.batchSchedule;
    if (!run || schedule === undefined || AGENT_RUN_TERMINAL_PHASES.has(run.phase)) {
        return null;
    }
    const settled = letsNextBatchFollow(run.batches.at(-1)?.status, schedule);
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

type MaterializedBatch = Extract<ReturnType<typeof materializePromptCommandPlan>, { status: 'prepared' }>;

/** The run keeps the batch's measured goal state and every receipt its preview read, after those of earlier batches. */
function recordBatchPreviewEvidence(
    liveRun: AgentRun,
    revision: GroundedBatch['revision'],
    metricGoalState: string | undefined,
    receipts: Awaited<ReturnType<typeof prepareMetricGoalPreview>>['receipts']
): void {
    if (!liveRun.plan) {
        return;
    }
    const priorReceipts = liveRun.plan.applicationToolReceipts ?? [];
    agentRunLifecycle.recordPlan({
        runId: liveRun.runId,
        summary: liveRun.plan.summary,
        commandIds: liveRun.plan.commandIds,
        serializedBatchIdentity: liveRun.plan.serializedBatchIdentity,
        revision,
        scope: liveRun.scope,
        grants: liveRun.grants,
        budgets: liveRun.budgets,
        plan: {
            ...liveRun.plan,
            metricGoalState,
            applicationToolReceipts: [...priorReceipts, ...receipts],
        },
    });
}

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
    valueChoice: VibeBatchValueChoice;
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
    // Stop is offered only while the preview renders: it cancels the run, which ends this batch's measurement.
    updateChatMessage(input.assistantMessageId, { stoppableRunId: run.runId });
    try {
        proof = await prepareMetricGoalPreview({
            state,
            commandBatch,
            context: grounded.context,
            prompt: run.request,
            runId: run.runId,
            onProgress: (progress) =>
                updateChatMessage(input.assistantMessageId, {
                    content: describeBatchPreviewProgress({
                        context: grounded.context,
                        position,
                        total: schedule.total,
                        progress,
                    }),
                }),
        });
    } catch (error) {
        updateChatMessage(input.assistantMessageId, { stoppableRunId: undefined });
        const current = agentRunLifecycle.get(run.runId);
        if (current === null || AGENT_RUN_TERMINAL_PHASES.has(current.phase)) {
            settleStoppedBatchPreparation(input.assistantMessageId, position, schedule.total, current);
            return { status: 'stopped' };
        }
        // The run goes on to refuse this batch in a message of its own; this one keeps no progress line.
        settleStoppedBatchPreparation(input.assistantMessageId, position, schedule.total, current);
        agentRunLifecycle.updateBatchStatus({ runId: run.runId, batchId, status: 'failed' });
        return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
    }
    // Nothing renders past here, so there is no measurement left to stop.
    updateChatMessage(input.assistantMessageId, { stoppableRunId: undefined });
    const liveRun = agentRunLifecycle.get(run.runId);
    if (liveRun === null || AGENT_RUN_TERMINAL_PHASES.has(liveRun.phase)) {
        settleStoppedBatchPreparation(input.assistantMessageId, position, schedule.total, liveRun);
        return { status: 'stopped' };
    }
    const approval = compileAgentRiskApproval({
        commandBatch,
        requireExplicitApproval: true,
        metricGoalState: JSON.stringify(proof.state),
    });
    recordBatchPreviewEvidence(liveRun, grounded.revision, approval.metricGoalState ?? undefined, proof.receipts);
    const evaluation = evaluateMetricGoalAdmission({ state: proof.state, commandBatch });
    const cardLines = describeVibeBatchCard({
        batch: input.batch,
        context: grounded.context,
        criteria: evaluation.criteria,
        adoptedRecipes: grounded.result.adoptedRecipes ?? [],
        valueChoice: input.valueChoice,
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
    grounded: GroundedBatch,
    /** The batch's message when an earlier step already showed one, which this one continues. */
    existingMessageId: string | undefined
): Promise<ScheduledBatchOutcome> {
    const preparing = `Preparing batch ${String(position)} of ${String(schedule.total)}...`;
    let assistantMessageId = existingMessageId;
    if (assistantMessageId === undefined) {
        assistantMessageId = appendBatchMessage(run, preparing);
    } else {
        updateChatMessage(assistantMessageId, { content: preparing });
    }
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
    if (grounded.vibe !== undefined) {
        return proposeMeasuredVibeBatch({
            run,
            schedule,
            position,
            grounded,
            batch: grounded.vibe.batch,
            valueChoice: grounded.vibe.valueChoice,
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

function appendBatchMessage(run: AgentRun, content: string): string {
    const id = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: run.runId,
        projectId: captureProjectIdentity(),
    });
    return id;
}

/**
 * A vibe-run batch passes every guard before anything is asked for it, then lets the value choice
 * pick its recipe values — showing which batch it chooses for, with the run's Stop, only while a
 * hosted request is outstanding — and grounds at the live revision with what it chose. A refusal
 * before the request asks nothing; a stop during it settles as a stopped batch preparation.
 */
async function proposeVibeRunBatch(
    run: AgentRun,
    schedule: AgentRunVibeRunBatchSchedule,
    position: number
): Promise<ScheduledBatchOutcome> {
    const preflight = preflightVibeRunBatch(run, schedule, position);
    if (preflight.status === 'rejected') {
        return preflight;
    }
    const built = buildVibeBatchValueRequest(preflight);
    if (built.status === 'refused') {
        return { status: 'rejected', reason: built.reason };
    }
    // Filled by `onBegin`, which runs only once a hosted request is about to be made.
    const shown: { messageId: string | undefined } = { messageId: undefined };
    const choice = await chooseVibeBatchValues({
        runId: run.runId,
        request: built.request,
        onBegin: () => {
            shown.messageId = appendBatchMessage(
                run,
                `Choosing values for batch ${String(position)} of ${String(schedule.total)}...`
            );
            updateChatMessage(shown.messageId, { stoppableRunId: run.runId });
        },
    });
    const { messageId } = shown;
    if (messageId !== undefined) {
        updateChatMessage(messageId, { stoppableRunId: undefined });
    }
    const liveRun = agentRunLifecycle.get(run.runId);
    if (liveRun === null || AGENT_RUN_TERMINAL_PHASES.has(liveRun.phase)) {
        settleStoppedBatchPreparation(messageId ?? appendBatchMessage(run, ''), position, schedule.total, liveRun);
        return { status: 'stopped' };
    }
    if (choice.source === 'stopped') {
        // The run goes on to refuse this batch in a message of its own; this one keeps no progress line.
        settleStoppedBatchPreparation(messageId ?? appendBatchMessage(run, ''), position, schedule.total, liveRun);
        return { status: 'rejected', reason: 'its value request was stopped' };
    }
    const grounded = groundVibeRunBatch(liveRun, schedule, position, choice);
    if (grounded.status === 'rejected') {
        // The refusal is told in a message of its own, exactly as a batch refused before any request.
        if (messageId !== undefined) {
            removeChatMessage(messageId);
        }
        return grounded;
    }
    return dispatchScheduledBatch(
        liveRun,
        schedule,
        position,
        { ...grounded, vibe: { batch: grounded.batch, valueChoice: grounded.valueChoice } },
        messageId
    );
}

async function proposeScheduledBatch(
    run: AgentRun,
    schedule: AgentRunBatchSchedule,
    position: number
): Promise<ScheduledBatchOutcome> {
    try {
        if (schedule.kind === 'vibe-run') {
            return await proposeVibeRunBatch(run, schedule, position);
        }
        const grounded = groundBulkSetSlice(run, schedule, position);
        if (grounded.status === 'rejected') {
            return grounded;
        }
        return await dispatchScheduledBatch(run, schedule, position, grounded, undefined);
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
        content: `Batch ${String(position)} of ${String(schedule.total)} was not proposed: ${reason.replace(/\.$/u, '')}. ${describeAppliedBatches(position, readSkippedVibeBatchPositions(agentRunLifecycle.get(run.runId)))}`,
        timestamp: Date.now(),
        error: reason,
        isCommandAction: true,
    });
    if (schedule.kind === 'vibe-run') {
        postVibeRunSummary({ runId: run.runId, refused: { position, reason } });
    }
}

/**
 * A vibe run whose last batch committed or was skipped ends with its one summary: what each batch
 * moved, as its approved preview measured it, or what became of it instead.
 */
function reportFinishedVibeRun(run: AgentRun | null): void {
    const schedule = run?.plan?.batchSchedule;
    if (!run || schedule?.kind !== 'vibe-run' || schedule.position < schedule.total) {
        return;
    }
    const lastStatus = run.batches.at(-1)?.status;
    if (lastStatus !== 'committed' && lastStatus !== 'skipped') {
        return;
    }
    postVibeRunSummary({ runId: run.runId });
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
        if (outcome.status === 'awaiting-approval' || outcome.status === 'stopped') {
            return;
        }
    }
}
