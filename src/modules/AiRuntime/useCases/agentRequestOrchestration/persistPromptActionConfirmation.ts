import { logger } from '#/infra/logger/appLogger';
import { buildSemanticProjectDiff, describeCommandBatchRecovery } from '#/modules/Command/useCases';

import { readPublicCreativeInterpretation } from '../../models/CreativeInterpretation';
import { type MeasuredPreview } from '../../models/MeasuredPreview';
import { updateChatMessage } from '../../stores/chatStore';
import {
    getPendingActionConfirmation,
    settlePendingActionResourceLeaseBestEffort,
    updatePendingActionConfirmationStatus,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMeasuredPreviewToBatch } from '../bindMeasuredPreviewToBatch';
import { deriveAudibleImpact } from '../deriveAudibleImpact';
import { UNDISPLAYED_MEASUREMENT_REASON } from '../deriveMeasuredAudibleImpact';
import { describeAgentRiskApproval } from '../describeAgentRiskApproval';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { readMetricCreativeAuthorityIds } from '../readMetricCreativeAuthorityIds';

import { createPromptConfirmationId } from './createPromptConfirmationId';

import type { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

type ConfirmationProposal = Parameters<typeof proposePendingActionConfirmation>[0];
type ParsedCommandBatch = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>;

type PersistPromptActionConfirmationInput = {
    runId: string;
    prompt: string;
    assistantMessageId: string;
    actions: ConfirmationProposal['actions'];
    actionLabels: ConfirmationProposal['actionLabels'];
    commandEnvelopes: NonNullable<ConfirmationProposal['commandEnvelopes']>;
    commandBatch: NonNullable<ConfirmationProposal['commandBatch']>;
    agentApproval: NonNullable<ConfirmationProposal['agentApproval']>;
    affectedIds: NonNullable<ConfirmationProposal['affectedIds']>;
    protectedUnchanged: NonNullable<ConfirmationProposal['protectedUnchanged']>;
    matchSelectorPredicates?: ConfirmationProposal['matchSelectorPredicates'];
    adoptedRecipes?: ConfirmationProposal['adoptedRecipes'];
    /** The preview measurement the proposal adopted; kept only when the persisted batch is the one it rendered. */
    measuredPreview?: MeasuredPreview;
    metricGoalState?: string;
    /** Which of the run's successive batches this proposal is; absent for a request that fits one batch. */
    batchPosition?: ConfirmationProposal['batchPosition'];
    /** What a terse refinement of this card inherits; present only for an ordinary card. */
    groundingBasis?: ConfirmationProposal['groundingBasis'];
    protectionFacts?: ConfirmationProposal['protectionFacts'];
    /** The readings an ambiguous brief request offers on this card. */
    briefReadings?: ConfirmationProposal['briefReadings'];
    /** The values a vibe-run batch card expands with; present only on such a card. */
    vibeValueChoice?: ConfirmationProposal['vibeValueChoice'];
    /** What a re-preview composes this card from again: its brief lines, kept-direction positions and workflow. */
    plannedRunLines?: ConfirmationProposal['plannedRunLines'];
    keptDirectionActionIndexes?: ConfirmationProposal['keptDirectionActionIndexes'];
    workflowCapabilityId?: ConfirmationProposal['workflowCapabilityId'];
    /** A id reserved earlier so a card it replaces can already name it; minted here when absent. */
    confirmationId?: string;
    executionMode: ConfirmationProposal['executionMode'];
    group: {
        groupId: string;
        groupLabel: string;
    };
    projectRevision: string;
    parsedCommandBatch: ParsedCommandBatch;
    content: string;
    supersedes?: string | null;
    onResourceOwnershipAcquired?: () => void;
};

function describeBatchPosition(batchPosition: PersistPromptActionConfirmationInput['batchPosition']): string {
    return batchPosition === undefined
        ? ''
        : `Batch ${String(batchPosition.index)} of ${String(batchPosition.total)}: `;
}

/** A re-preview's replacement shares its run with the card it would retire, which that card still owns. */
function sharesRunWithLiveSupersededCard(input: PersistPromptActionConfirmationInput): boolean {
    const superseded = input.supersedes ? getPendingActionConfirmation(input.supersedes) : undefined;
    return superseded?.status === 'proposed' && superseded.runId === input.runId;
}

/**
 * A proposal the store refused to retain settles its run and chat message as failed; nothing stays
 * pending. A replacement refused beside a live original on the same run touches neither: the original
 * stays confirmable, and the caller reports the refusal and withdraws the replacement's message.
 */
function failUnretainedProposal(input: PersistPromptActionConfirmationInput): void {
    if (sharesRunWithLiveSupersededCard(input)) {
        return;
    }
    const reason = 'Prepared action resources exceed the live confirmation limit.';
    agentRunLifecycle.updateBatchStatus({
        runId: input.runId,
        batchId: input.parsedCommandBatch.envelope.batchId,
        status: 'failed',
    });
    agentRunLifecycle.recordError({
        runId: input.runId,
        error: normalizeAgentFailure({
            category: 'budget',
            source: 'command-execution',
            related: {
                targetIds: [...input.parsedCommandBatch.envelope.scope.targetIds],
                commandIds: input.parsedCommandBatch.envelope.commands.map((command) => command.commandId),
                workIds: [input.parsedCommandBatch.envelope.batchId],
            },
            retry: 'never',
            knownDomain: true,
        }),
        terminal: true,
    });
    updateChatMessage(input.assistantMessageId, {
        isStreaming: false,
        pendingActionConfirmationStatus: 'failed',
        error: reason,
        content:
            'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
    });
}

function deriveWithoutProofs(
    evidence: Parameters<typeof deriveAudibleImpact>[0]
): ReturnType<typeof deriveAudibleImpact> {
    const claim = deriveAudibleImpact({ ...evidence, proofPreviews: [] });
    if (claim !== null) {
        return claim;
    }
    if (deriveAudibleImpact(evidence) === null) {
        return null;
    }
    return { status: 'not-claimed', reason: UNDISPLAYED_MEASUREMENT_REASON };
}

/** A preview the card was offered but could not keep shows no figure, so proofs may not supply them. */
function deriveCardClaim(
    evidence: Parameters<typeof deriveAudibleImpact>[0],
    cardDroppedPreview: boolean
): ReturnType<typeof deriveAudibleImpact> {
    if (cardDroppedPreview) {
        return deriveWithoutProofs(evidence);
    }
    return deriveAudibleImpact(evidence);
}

/**
 * Binds the run's plan to the card just persisted: its metric-goal state, and the audible claim of
 * this exact batch: the predictions of its frozen goals with their verification against the bound
 * measurement, or the measured figures of a goalless plan. Every persisted card rewrites the plan's
 * claim from this batch's own evidence, so a re-preview with no goals, which writes no plan before it
 * persists, never keeps the earlier batch's claim, and the plan's revision stays current.
 */
function recordConfirmationMetricGoalPlan(
    input: PersistPromptActionConfirmationInput,
    confirmation: NonNullable<ReturnType<typeof proposePendingActionConfirmation>>
): void {
    const run = agentRunLifecycle.get(input.runId);
    if (run?.plan === null || run?.plan === undefined) {
        return;
    }
    const { metricGoalState, measuredPreview } = confirmation.approvalSnapshot;
    const state = metricGoalStateCodec(metricGoalState);
    const evidence = {
        state,
        commandBatch: input.commandBatch,
        envelope: input.parsedCommandBatch.envelope,
        snapshotPreview: measuredPreview,
        proofPreviews: state?.proofs.map((proof) => proof.preview) ?? [],
    };
    const claim = deriveCardClaim(evidence, input.measuredPreview !== undefined && measuredPreview === undefined);
    agentRunLifecycle.recordPlan({
        runId: input.runId,
        summary: run.plan.summary,
        commandIds: input.parsedCommandBatch.envelope.commands.map((command) => command.commandId),
        serializedBatchIdentity: input.parsedCommandBatch.envelope.idempotencyKey,
        revision: input.projectRevision,
        scope: run.scope,
        grants: run.grants,
        budgets: run.budgets,
        plan: { ...run.plan, metricGoalState, revision: input.projectRevision },
        audibleClaim: claim ?? undefined,
    });
}

function describeProposedPromptContent(
    input: PersistPromptActionConfirmationInput,
    metricGoalState: string | null | undefined
): string {
    const interpretation = readPublicCreativeInterpretation(
        agentRunLifecycle.get(input.runId)?.plan?.applicationToolReceipts ?? [],
        readMetricCreativeAuthorityIds(metricGoalState) ?? []
    );
    const publicReading = interpretation === null ? '' : `\n\nInterpretation: ${interpretation}`;
    return `${describeBatchPosition(input.batchPosition)}${input.content}${publicReading}\n\n${describeAgentRiskApproval(input.agentApproval)}`;
}

export function persistPromptActionConfirmation(input: PersistPromptActionConfirmationInput): string | null {
    const confirmationId = input.confirmationId ?? createPromptConfirmationId();
    // A batch whose handlers cannot describe themselves still deserves a semantic view, so
    // the diff degrades to `irreversible` recoveries rather than losing the whole projection.
    const described = describeCommandBatchRecovery(input.parsedCommandBatch.envelope);
    if (described.status === 'rejected') {
        logger.warn(`Command batch recovery could not be described: ${described.reason}`);
    }
    const semanticDiff = buildSemanticProjectDiff({
        envelope: input.parsedCommandBatch.envelope,
        recoveryByCommandId: described.status === 'described' ? described.recoveryByCommandId : {},
    });
    const resourceLease = createStemImportConfirmationResourceLease(
        input.actions,
        `stem-promotion:${confirmationId}`,
        input.runId
    );
    // Lease construction transfers prepared resources away from run ownership.
    let confirmation: ReturnType<typeof proposePendingActionConfirmation> | undefined;
    try {
        input.onResourceOwnershipAcquired?.();
        confirmation = proposePendingActionConfirmation({
            id: confirmationId,
            runId: input.runId,
            prompt: input.prompt,
            assistantMessageId: input.assistantMessageId,
            actions: input.actions,
            actionLabels: input.actionLabels,
            commandEnvelopes: input.commandEnvelopes,
            commandBatch: input.commandBatch,
            agentApproval: input.agentApproval,
            semanticDiff,
            affectedIds: input.affectedIds,
            protectedUnchanged: input.protectedUnchanged,
            matchSelectorPredicates: input.matchSelectorPredicates,
            adoptedRecipes: input.adoptedRecipes,
            metricGoalState: input.metricGoalState ?? input.agentApproval.metricGoalState ?? undefined,
            measuredPreview: bindMeasuredPreviewToBatch(input.measuredPreview, input.parsedCommandBatch.envelope),
            batchPosition: input.batchPosition,
            groundingBasis: input.groundingBasis,
            protectionFacts: input.protectionFacts,
            briefReadings: input.briefReadings,
            vibeValueChoice: input.vibeValueChoice,
            plannedRunLines: input.plannedRunLines,
            keptDirectionActionIndexes: input.keptDirectionActionIndexes,
            workflowCapabilityId: input.workflowCapabilityId,
            risk: {
                level: input.agentApproval.policy.risk,
                reason: input.agentApproval.policy.reasons.join(' ') || null,
            },
            executionMode: input.executionMode,
            groupId: input.group.groupId,
            groupLabel: input.group.groupLabel,
            projectRevision: input.projectRevision,
            supersedes: input.supersedes ?? null,
            resourceLease,
        });
        if (!confirmation) {
            failUnretainedProposal(input);
            return null;
        }

        recordConfirmationMetricGoalPlan(input, confirmation);
        updateChatMessage(input.assistantMessageId, {
            isStreaming: false,
            pendingActionConfirmationId: confirmationId,
            pendingActionConfirmationStatus: 'proposed',
            content: describeProposedPromptContent(input, confirmation.approvalSnapshot.metricGoalState),
        });
        agentRunLifecycle.transitionPhase({
            runId: input.runId,
            phase: 'waiting-for-approval',
            revision: input.projectRevision,
        });
        return confirmationId;
    } catch (error) {
        if (getPendingActionConfirmation(confirmationId)) {
            updatePendingActionConfirmationStatus({ confirmationId, status: 'failed' });
            void settlePendingActionResourceLeaseBestEffort({ confirmationId, disposition: 'discard' });
        } else if (confirmation !== null && resourceLease) {
            void Promise.resolve()
                .then(() => resourceLease.release())
                .catch((releaseError: unknown) => {
                    logger.error(new Error('Unretained confirmation resource cleanup failed', { cause: releaseError }));
                });
        }
        throw error;
    }
}
