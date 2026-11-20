import { captureProjectIdentity, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';
import { projectStore } from '#/modules/Project/stores';

import { type AgentRun } from '../../models/AgentRun';
import { type BriefReading, type BriefReadings } from '../../models/BriefReading';
import { type ProjectContext } from '../../models/ProjectContext';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { readBriefMixIntent } from '../readBriefMixIntent';

import { readRetainedPlanDigestDrift } from './readRetainedPlanDigestDrift';
import { readRetainedPlanReferenceDrift } from './readRetainedPlanReferenceDrift';

const CATALOGUE_CHANGED = 'The mix catalogue changed since this card was made, so its readings no longer apply.';

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

/**
 * Why the chosen reading can no longer be planned as the card offered it, or `null` while it can: a
 * recipe or track its retained plan names is gone, the brief or project moved since the card, or
 * preparing the reading again, before anything is measured, yields another plan. Read synchronously,
 * so the caller can plan in the same turn without the project moving in between.
 */
export function readChosenReadingDrift(input: {
    confirmation: PendingAppActionConfirmation;
    offer: BriefReadings;
    reading: BriefReading;
    run: AgentRun;
    context: ProjectContext;
}): string | null {
    const { confirmation, offer, reading, run, context } = input;
    const briefAction = confirmation.actions.find(
        (action): action is BriefAction => action.type === 'setProductionBrief'
    );
    if (briefAction === undefined) {
        return 'The card no longer holds a brief to plan readings for.';
    }
    const missing = readRetainedPlanReferenceDrift(reading, context);
    if (missing !== null) {
        return missing;
    }
    const stale = readCardStaleness(confirmation, briefAction);
    if (stale !== null) {
        return stale;
    }
    const mixIntent = readBriefMixIntent({ catalogId: offer.catalogId, requestedDescriptors: reading.descriptors });
    if (mixIntent === null) {
        return CATALOGUE_CHANGED;
    }
    return readRetainedPlanDigestDrift({
        reading,
        run,
        prompt: run.request,
        context,
        brief: offer.brief,
        mixIntent,
    });
}
