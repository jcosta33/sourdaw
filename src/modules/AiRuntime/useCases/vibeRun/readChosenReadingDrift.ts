import { captureProjectIdentity, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';

import { type AgentRun } from '../../models/AgentRun';
import { type BriefReading, type BriefReadings } from '../../models/BriefReading';
import { type ProjectContext } from '../../models/ProjectContext';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { readBriefMixIntent } from '../readBriefMixIntent';

import { CARD_HOLDS_NO_BRIEF, MIX_CATALOGUE_CHANGED } from './briefReadingRefusals';
import { readRetainedPlanDigestDrift } from './readRetainedPlanDigestDrift';
import { readRetainedPlanReferenceDrift } from './readRetainedPlanReferenceDrift';

type BriefAction = Extract<PendingAppActionConfirmation['actions'][number], { type: 'setProductionBrief' }>;

function readCardStaleness(confirmation: PendingAppActionConfirmation, briefAction: BriefAction): string | null {
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

type ChosenReadingDrift =
    | { status: 'drifted'; reason: string }
    | { status: 'unchanged'; mixIntent: NonNullable<ReturnType<typeof readBriefMixIntent>> };

function drifted(reason: string): ChosenReadingDrift {
    return { status: 'drifted', reason };
}

/**
 * Whether the chosen reading can still be planned as the card offered it: a recipe or track its
 * retained plan names is gone, the brief or project moved since the card, the catalogue changed, or
 * preparing the reading again, before anything is measured, yields another plan. Read
 * synchronously, so the caller can plan in the same turn without the project moving in between.
 */
export function readChosenReadingDrift(input: {
    confirmation: PendingAppActionConfirmation;
    offer: BriefReadings;
    reading: BriefReading;
    run: AgentRun;
    context: ProjectContext;
}): ChosenReadingDrift {
    const { confirmation, offer, reading, run, context } = input;
    const briefAction = confirmation.actions.find(
        (action): action is BriefAction => action.type === 'setProductionBrief'
    );
    if (briefAction === undefined) {
        return drifted(CARD_HOLDS_NO_BRIEF);
    }
    const missing = readRetainedPlanReferenceDrift(reading, context);
    if (missing !== null) {
        return drifted(missing);
    }
    const stale = readCardStaleness(confirmation, briefAction);
    if (stale !== null) {
        return drifted(stale);
    }
    const mixIntent = readBriefMixIntent({ catalogId: offer.catalogId, requestedDescriptors: reading.descriptors });
    if (mixIntent === null) {
        return drifted(MIX_CATALOGUE_CHANGED);
    }
    const changedPlan = readRetainedPlanDigestDrift(reading, {
        prompt: run.request,
        context,
        brief: offer.brief,
        mixIntent,
        runId: run.runId,
        priorReceipts: run.plan?.applicationToolReceipts ?? [],
    });
    if (changedPlan !== null) {
        return drifted(changedPlan);
    }
    return { status: 'unchanged', mixIntent };
}
