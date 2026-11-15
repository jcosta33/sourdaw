import { logger } from '#/infra/logger/appLogger';
import {
    captureProjectIdentity,
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';

import { AGENT_RUN_TERMINAL_PHASES, type AgentRun } from '../models/AgentRun';
import { type BriefReading, type BriefReadings } from '../models/BriefReading';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { type IntentResult, type PlannedIntentResult } from '../models/IntentResult';
import { appendChatMessage, updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    type PendingAppActionConfirmation,
} from '../stores/pendingActionConfirmationStore';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { unionProposalProtectionFacts } from './agentReference/proposalGroundingBasis';
import { createPromptConfirmationId } from './agentRequestOrchestration/createPromptConfirmationId';
import { describeInitialMeasurementProgress } from './agentRequestOrchestration/describeInitialMeasurementProgress';
import { materializePromptCommandPlan } from './agentRequestOrchestration/materializePromptCommandPlan';
import { persistPromptActionConfirmation } from './agentRequestOrchestration/persistPromptActionConfirmation';
import { readConfirmationBatchId } from './agentRequestOrchestration/readConfirmationBatchId';
import { retireSupersededConfirmation } from './agentRequestOrchestration/retireSupersededConfirmation';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget } from './agentWorkBudget';
import { agentRunCancellation } from './cancelAgentRun';
import { describePendingActionConfirmation } from './describePendingActionConfirmation';
import { getBriefMixIntentCatalog } from './getBriefMixIntentCatalog';
import { getProjectContext } from './getProjectContext';
import { readBriefMixIntent } from './readBriefMixIntent';
import { readVibeBriefReadingAvailability } from './readVibeBriefReadingAvailability';
import { stopMeasuredPreviewAudition } from './stopMeasuredPreviewAudition';
import { describeChosenBriefReading } from './vibeRun/describeChosenBriefReading';
import { planBriefVibeRun } from './vibeRun/planBriefVibeRun';

type ChooseVibeBriefReadingInput = {
    confirmationId: string;
    readingId: string;
};

type ChooseVibeBriefReadingOutput =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'refused'; reason: string }
    | { status: 'chosen' };

type BriefAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'setProductionBrief' }>;

function refuse(reason: string): ChooseVibeBriefReadingOutput {
    return { status: 'refused', reason };
}

/** Why the card's own facts no longer hold, or `null` while they do. */
function readStaleness(confirmation: PendingAppActionConfirmation, briefAction: BriefAction): string | null {
    if (projectStore.value?.productionBrief.revision !== briefAction.payload.expectedRevision) {
        return 'The production brief changed since this card was made, so its readings no longer apply.';
    }
    if (
        confirmation.approvalSnapshot.commandBatch?.authority.projectId !== captureProjectIdentity() ||
        !projectRevisionMatchesLiveIgnoringSaveWrites(confirmation.projectRevision)
    ) {
        return 'The project changed since this card was made, so its readings no longer apply.';
    }
    return null;
}

function claimReadingPlanWork(runId: string) {
    const workId = `brief-reading-${crypto.randomUUID()}`;
    return agentRunWorkLease.claim({
        runId,
        workId,
        ownerKind: 'analysis',
        cleanupOwner: 'brief-reading-plan',
        idempotencyKey: workId,
        receiptIdentity: workId,
        idempotent: true,
        retriable: false,
    });
}

function isLive(run: AgentRun): boolean {
    return !AGENT_RUN_TERMINAL_PHASES.has(run.phase) && run.cancellation.requestedAt === null;
}

function readBatchPosition(schedule: IntentResult['batchSchedule']): { index: number; total: number } | undefined {
    if (schedule === undefined) {
        return undefined;
    }
    return { index: schedule.position, total: schedule.total };
}

/**
 * Plans one reading of an ambiguous brief card in the card's own run, with no provider call: the card
 * settles as replaced, the chosen characters are measured and scheduled behind the same brief, and a
 * card for that brief with the plan replaces it. Nothing is applied; the brief and every batch still
 * wait for Confirm.
 */
export async function chooseVibeBriefReading(
    input: ChooseVibeBriefReadingInput
): Promise<ChooseVibeBriefReadingOutput> {
    void stopMeasuredPreviewAudition({ confirmationId: input.confirmationId });
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed' || confirmation.supersededBy !== null) {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }
    const reading = confirmation.approvalSnapshot.briefReadings?.readings.find(
        (candidate) => candidate.id === input.readingId
    );
    if (reading === undefined) {
        return refuse(`The card offers no reading with id "${input.readingId}".`);
    }
    const availability = readVibeBriefReadingAvailability(confirmation);
    if (availability.reason !== null) {
        return refuse(availability.reason);
    }
    const offer = confirmation.approvalSnapshot.briefReadings;
    const run = agentRunLifecycle.get(confirmation.runId);
    const briefAction = confirmation.actions.find(
        (action): action is BriefAction => action.type === 'setProductionBrief'
    );
    if (offer === undefined || run === null || !isLive(run) || briefAction === undefined) {
        return refuse('The card no longer holds a brief to plan readings for.');
    }
    const interactionMode = run.mode;
    if (interactionMode !== 'apply' && interactionMode !== 'macro') {
        return refuse('Only a run that applies changes can plan batches.');
    }
    if (offer.catalogId !== getBriefMixIntentCatalog().catalogId) {
        return refuse('The mix catalogue changed since this card was made, so its readings no longer apply.');
    }
    const stale = readStaleness(confirmation, briefAction);
    if (stale !== null) {
        return refuse(stale);
    }
    const mixIntent = readBriefMixIntent({ catalogId: offer.catalogId, requestedDescriptors: reading.descriptors });
    if (mixIntent === null) {
        return refuse('The mix catalogue changed since this card was made, so its readings no longer apply.');
    }
    const claimed = claimReadingPlanWork(run.runId);
    if (claimed.status !== 'claimed') {
        return refuse(`The reading could not be planned: ${claimed.status}.`);
    }
    const lease = claimed.lease;
    const controller = new AbortController();
    const release = agentRunCancellation.bindAbortController({
        runId: run.runId,
        lease,
        controller,
        reason: 'Brief reading plan cancelled.',
    });
    let terminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    try {
        const outcome = await planChosenReading({
            confirmation,
            offer,
            reading,
            run,
            mixIntent,
            interactionMode,
            signal: controller.signal,
        });
        terminalState = outcome.status === 'chosen' ? 'completed' : 'cancelled';
        return outcome;
    } finally {
        release();
        agentRunWorkLease.settle({
            runId: lease.runId,
            workId: lease.workId,
            leaseId: lease.leaseId,
            cancellationGeneration: lease.cancellationGeneration,
            idempotencyKey: lease.idempotencyKey,
            receiptIdentity: lease.receiptIdentity,
            terminalState,
        });
    }
}

async function planChosenReading(input: {
    confirmation: PendingAppActionConfirmation;
    offer: BriefReadings;
    reading: BriefReading;
    run: AgentRun;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
    interactionMode: 'apply' | 'macro';
    signal: AbortSignal;
}): Promise<ChooseVibeBriefReadingOutput> {
    const { confirmation, reading, run } = input;
    const replacementId = createPromptConfirmationId();
    const oldBatchId = readConfirmationBatchId(confirmation);
    // Settled before anything measures, so a Confirm arriving meanwhile finds nothing pending.
    await retireSupersededConfirmation(confirmation, replacementId, {
        reason: `Replaced by the plan for the reading "${reading.name}".`,
        content: `This card offered more than one reading. "${reading.name}" was chosen, and its plan replaces this card.`,
    });
    if (oldBatchId !== null) {
        agentRunLifecycle.updateBatchStatus({ runId: run.runId, batchId: oldBatchId, status: 'cancelled' });
    }
    const assistantMessageId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: `Planning the reading "${reading.name}"...`,
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: run.runId,
        projectId: captureProjectIdentity(),
        stoppableRunId: run.runId,
    });
    // The old card is gone, so anything but a persisted replacement must end the run, never leave it idle.
    try {
        return await planAfterRetire({ ...input, replacementId, assistantMessageId });
    } catch (error) {
        // A Stop makes the measurement throw; the run it cancelled is stopped, not failed.
        const live = agentRunLifecycle.get(run.runId);
        if (live === null || !isLive(live)) {
            return settleStoppedReading({ assistantMessageId, reading, live });
        }
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(new Error('Brief reading plan failed after its card was retired', { cause: error }));
        return failReading({ run, assistantMessageId, reading, reason: `planning failed: ${reason}` });
    }
}

/** The run ended while the reading was planned: say it was stopped or cancelled, and record no failure. */
function settleStoppedReading(input: {
    assistantMessageId: string;
    reading: BriefReading;
    live: AgentRun | null;
}): ChooseVibeBriefReadingOutput {
    const cancelled = input.live !== null && input.live.cancellation.requestedAt !== null;
    updateChatMessage(input.assistantMessageId, {
        pendingActionConfirmationStatus: cancelled ? 'cancelled' : undefined,
        stoppableRunId: undefined,
        content: `${cancelled ? 'Cancelled' : 'Stopped'} planning the reading "${input.reading.name}".`,
    });
    return refuse('The run ended before the reading could be planned.');
}

/** Ends the run as failed and tells the user why no plan was made for the chosen reading. */
function failReading(input: {
    run: AgentRun;
    assistantMessageId: string;
    reading: BriefReading;
    reason: string;
}): ChooseVibeBriefReadingOutput {
    try {
        agentRunLifecycle.recordError({
            runId: input.run.runId,
            error: normalizeAgentFailure({
                category: 'resolution',
                source: 'command-execution',
                retry: 'never',
                knownDomain: true,
            }),
            terminal: true,
        });
    } catch (error) {
        // The message below stays authoritative when the failure record cannot persist.
        logger.error(new Error('Brief reading failure could not be recorded on its run', { cause: error }));
    }
    updateChatMessage(input.assistantMessageId, {
        stoppableRunId: undefined,
        error: input.reason,
        content: `No plan was made for the reading "${input.reading.name}": ${input.reason}`,
    });
    return refuse(input.reason);
}

async function planAfterRetire(input: {
    confirmation: PendingAppActionConfirmation;
    offer: BriefReadings;
    reading: BriefReading;
    run: AgentRun;
    mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>>;
    interactionMode: 'apply' | 'macro';
    signal: AbortSignal;
    replacementId: string;
    assistantMessageId: string;
}): Promise<ChooseVibeBriefReadingOutput> {
    const { confirmation, offer, reading, run, replacementId, assistantMessageId } = input;
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const context = getProjectContext();
    const priorReceipts = run.plan?.applicationToolReceipts ?? [];
    const planned = await planBriefVibeRun({
        prompt: run.request,
        context,
        brief: offer.brief,
        mixIntent: input.mixIntent,
        runId: run.runId,
        sourceRevision: revision,
        signal: input.signal,
        admit: agentWorkBudget.admitMeasurement(run.runId),
        priorReceipts,
        onProgress: (progress) =>
            updateChatMessage(assistantMessageId, { content: describeInitialMeasurementProgress(context, progress) }),
    });
    updateChatMessage(assistantMessageId, { stoppableRunId: undefined });
    const live = agentRunLifecycle.get(run.runId);
    if (live === null || !isLive(live)) {
        return settleStoppedReading({ assistantMessageId, reading, live });
    }
    if (!projectRevisionMatchesLiveIgnoringSaveWrites(revision)) {
        logger.warn('Brief reading plan discarded: the project changed while it was measured.');
        return failReading({
            run,
            assistantMessageId,
            reading,
            reason: 'the project changed while the reading was planned, so no plan was made. Ask again for the change you want',
        });
    }
    const result: PlannedIntentResult = {
        metricGoalState: offer.metricGoalState,
        actions: confirmation.actions,
        rawText: run.request,
        requiresConfirmation: true,
        providerKnownTargetIds: [],
        ...planned,
        applicationToolReceipts: planned.applicationToolReceipts ?? [...priorReceipts],
        planningOutcome: { kind: 'proposal' },
    };
    // What the card's own planning recorded beside its metric state, so this plan is recorded as the directly planned brief's.
    if (offer.providerProposal !== undefined) {
        result.providerProposal = offer.providerProposal;
    }
    if (offer.terminalMeasurementSettlement !== undefined) {
        result.terminalMeasurementSettlement = offer.terminalMeasurementSettlement;
    }
    return persistReadingCard({ ...input, replacementId, assistantMessageId, revision, context, result });
}

/** The replacement brief card for the chosen reading, materialized and persisted as the first card was. */
async function persistReadingCard(input: {
    confirmation: PendingAppActionConfirmation;
    reading: BriefReading;
    run: AgentRun;
    interactionMode: 'apply' | 'macro';
    offer: BriefReadings;
    replacementId: string;
    assistantMessageId: string;
    revision: string;
    context: ReturnType<typeof getProjectContext>;
    result: PlannedIntentResult;
}): Promise<ChooseVibeBriefReadingOutput> {
    const { confirmation, reading, run, replacementId, assistantMessageId, revision, context, result } = input;
    const description = describePendingActionConfirmation({
        actions: result.actions,
        context,
        prompt: run.request,
    });
    const materialized = materializePromptCommandPlan({
        userText: run.request,
        runId: run.runId,
        assistantMessageId,
        interactionMode: input.interactionMode,
        trustCeiling: input.offer.trustCeiling ?? undefined,
        resume: undefined,
        onResumedPlanAccepted: undefined,
        projectRevision: revision,
        context,
        result,
        actionLabels: description.actionLabels,
        protectedTargetIds: description.protectedUnchanged.map((item) => item.id),
    });
    const notPrepared = { run, assistantMessageId, reading, reason: 'the reading could not be prepared for approval' };
    if (materialized.status === 'terminal') {
        await materialized.completion;
        return failReading(notPrepared);
    }
    const { commandGroup, compiledActionExecution, parsedCommandBatch } = materialized;
    if (!compiledActionExecution.requiresConfirmation) {
        return failReading(notPrepared);
    }
    const noProtections = { protectedUnchanged: [], protectedControls: [] };
    const plannedLines = result.plannedRunLines ?? [];
    const persisted = persistPromptActionConfirmation({
        confirmationId: replacementId,
        runId: run.runId,
        prompt: run.request,
        assistantMessageId,
        actions: result.actions,
        actionLabels: description.actionLabels,
        commandEnvelopes: compiledActionExecution.commandEnvelopes,
        commandBatch: compiledActionExecution.commandBatch,
        agentApproval: compiledActionExecution.agentApproval,
        affectedIds: description.affectedIds,
        protectedUnchanged: description.protectedUnchanged,
        metricGoalState: compiledActionExecution.metricGoalState,
        protectionFacts: unionProposalProtectionFacts(noProtections, noProtections, {
            protectedUnchanged: description.protectedUnchanged,
            protectedControls: [],
        }),
        batchPosition: readBatchPosition(result.batchSchedule),
        executionMode: result.executionMode,
        group: commandGroup,
        projectRevision: revision,
        parsedCommandBatch,
        content: [description.content, '', describeChosenBriefReading(reading), ...plannedLines].join('\n'),
        supersedes: confirmation.id,
    });
    if (persisted === null) {
        return failReading({
            run,
            assistantMessageId,
            reading,
            reason: 'the reading could not be retained for approval',
        });
    }
    return { status: 'chosen' };
}
