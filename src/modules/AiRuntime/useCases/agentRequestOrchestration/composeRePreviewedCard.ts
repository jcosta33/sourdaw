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

/**
 * What a whole vibe-run batch card was composed from at its first proposal: its planned batch, read
 * back from the run's schedule, and the value choice its snapshot recorded. `null` for a subset,
 * which is no longer that batch, for every other card, and for a card proposed before snapshots
 * recorded the value choice, each of which re-previews as an ordinary card.
 */
function readVibeCardSource(input: ComposeRePreviewedCardInput) {
    const schedule = agentRunLifecycle.get(input.confirmation.runId)?.plan?.batchSchedule;
    const { batchPosition, vibeValueChoice } = input.confirmation.approvalSnapshot;
    if (input.selectsSubset || schedule?.kind !== 'vibe-run' || !batchPosition || !vibeValueChoice) {
        return null;
    }
    const stored = readStoredVibeRunBatch(schedule, batchPosition.index);
    return stored === null ? null : { batch: stored.batch, valueChoice: vibeValueChoice };
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

/**
 * A re-previewed card is composed again from this re-preview alone, then says in one sentence that
 * it was re-previewed. A whole vibe-run batch card gets its own lines again, each figure line read
 * from the fresh measurement, and, as at its first proposal, shows its figures only as those lines.
 * Every other card describes the actions it keeps and shows this re-preview's own bound measurement
 * as its measured preview.
 */
export function composeRePreviewedCard(input: ComposeRePreviewedCardInput): {
    content: string;
    measuredPreview: MeasuredPreview | undefined;
} {
    const { confirmation, actions, context } = input;
    const description = describePendingActionConfirmation({
        actions,
        context,
        prompt: confirmation.prompt,
        inheritedProtectedUnchanged: confirmation.protectedUnchanged,
        requestProtectionFacts: confirmation.approvalSnapshot.protectionFacts,
    });
    const vibe = readVibeCardSource(input);
    if (vibe === null) {
        return {
            content: `${description.content}\n\n${RE_PREVIEWED_SENTENCE}`,
            measuredPreview: readRePreviewedMeasurement(input),
        };
    }
    const vibeContent = composeVibeBatchCardContent({
        descriptionContent: description.content,
        batch: vibe.batch,
        context,
        state: input.measuredState,
        commandBatch: input.commandBatch,
        adoptedRecipes: confirmation.approvalSnapshot.adoptedRecipes ?? [],
        valueChoice: vibe.valueChoice,
    });
    return { content: `${vibeContent}\n\n${RE_PREVIEWED_SENTENCE}`, measuredPreview: undefined };
}
