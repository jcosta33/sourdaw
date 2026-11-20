import { type MeasuredPreview } from '../../models/MeasuredPreview';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type DeriveMeasuredAudibleImpactInput, boundMeasurement } from '../boundAudibleMeasurement';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { type getProjectContext } from '../getProjectContext';
import { type MetricGoalState } from '../metricGoalContractTypes';
import { composeVibeBatchCardContent } from '../vibeRun/composeVibeBatchCardContent';

import { readStoredVibeRunBatch } from './readStoredVibeRunBatch';

export const RE_PREVIEWED_SENTENCE = 'Re-previewed against the current project.';

type WorkingBatch = NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;

type ComposeRePreviewedCardInput = {
    confirmation: PendingAppActionConfirmation;
    /** The actions the replacement keeps: every one, or the subset the musician selected. */
    actions: PendingAppActionConfirmation['actions'];
    context: ReturnType<typeof getProjectContext>;
    commandBatch: WorkingBatch;
    envelope: DeriveMeasuredAudibleImpactInput['envelope'];
    /** The goal state this re-preview measured, or `null` when it measured nothing (no goals, or literal ones). */
    measuredState: MetricGoalState | null;
    selectsSubset: boolean;
};

/** A vibe-run batch card is a later position of a vibe-run schedule; the brief at position 1 is not one. */
function isVibeBatchCard(confirmation: PendingAppActionConfirmation): boolean {
    const schedule = agentRunLifecycle.get(confirmation.runId)?.plan?.batchSchedule;
    return schedule?.kind === 'vibe-run' && (confirmation.approvalSnapshot.batchPosition?.index ?? 1) > 1;
}

/**
 * The text a vibe batch card is composed from at its first proposal, read back from the run's plan
 * and the card's own snapshot, or `null` when any of it no longer reads.
 */
function readVibeCardSource(confirmation: PendingAppActionConfirmation) {
    const schedule = agentRunLifecycle.get(confirmation.runId)?.plan?.batchSchedule;
    const { batchPosition, vibeValueSource } = confirmation.approvalSnapshot;
    if (schedule?.kind !== 'vibe-run' || batchPosition === undefined || vibeValueSource === undefined) {
        return null;
    }
    const stored = readStoredVibeRunBatch(schedule, batchPosition.index);
    return stored === null ? null : { batch: stored.batch, valueSource: vibeValueSource };
}

/**
 * The preview an ordinary re-previewed card shows, chosen exactly as the plan's audible claim chooses
 * (`boundMeasurement`), so card and claim read one preview: the card's own preview while it still
 * measures exactly the refreshed batch at its revision (an identical batch the project did not move
 * under), and otherwise the latest of this re-preview's proofs bound to that batch. A subset is
 * another batch, so only its own fresh proofs count.
 */
function readRePreviewedMeasurement(input: ComposeRePreviewedCardInput): MeasuredPreview | undefined {
    return boundMeasurement({
        envelope: input.envelope,
        snapshotPreview: input.selectsSubset ? undefined : input.confirmation.approvalSnapshot.measuredPreview,
        proofPreviews: input.measuredState?.proofs.map((proof) => proof.preview) ?? [],
    })?.preview;
}

/** The card body before the re-preview sentence: a whole vibe batch's own card, or the batch description. */
function composeCardBody(input: ComposeRePreviewedCardInput): string {
    const { confirmation, actions, context } = input;
    const description = describePendingActionConfirmation({
        actions,
        context,
        prompt: confirmation.prompt,
        inheritedProtectedUnchanged: confirmation.protectedUnchanged,
        requestProtectionFacts: confirmation.approvalSnapshot.protectionFacts,
    });
    const vibe = input.selectsSubset ? null : readVibeCardSource(confirmation);
    if (vibe === null) {
        return description.content;
    }
    return composeVibeBatchCardContent({
        descriptionContent: description.content,
        batch: vibe.batch,
        context,
        state: input.measuredState,
        commandBatch: input.commandBatch,
        adoptedRecipes: confirmation.approvalSnapshot.adoptedRecipes ?? [],
        valueSource: vibe.valueSource,
    });
}

/**
 * A re-previewed card is composed again from this re-preview alone: its text as the first proposal
 * composed it, for the refreshed batch and the fresh figures, then one sentence saying it was
 * re-previewed, and its measured preview from this re-preview's own bound measurement. A vibe batch
 * card shows its figures as text lines and carries no preview section, as at its first proposal.
 */
export function composeRePreviewedCard(input: ComposeRePreviewedCardInput): {
    content: string;
    measuredPreview: MeasuredPreview | undefined;
} {
    return {
        content: `${composeCardBody(input)}\n\n${RE_PREVIEWED_SENTENCE}`,
        measuredPreview: isVibeBatchCard(input.confirmation) ? undefined : readRePreviewedMeasurement(input),
    };
}
