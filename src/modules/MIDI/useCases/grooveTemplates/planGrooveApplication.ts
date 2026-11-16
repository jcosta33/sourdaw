import { type AppAction } from '#/utils/handlerContract';

import { type GrooveTemplateAssignment } from '../../models/GrooveTemplateState';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';

import { canonicalizeGrooveTemplateAssignment } from './canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from './getGrooveAssignment';
import { getGrooveTemplate } from './getGrooveTemplate';
import { projectGrooveTemplateState } from './projectGrooveTemplateState';

type ApplyGroovePayload = Extract<AppAction, { type: 'applyGroove' }>['payload'];

export type GrooveApplicationPlan = {
    /** The clip's assignment once the earlier batch actions have run, which this application replaces. */
    priorAssignment: GrooveTemplateAssignment | null;
    /** The assignment this application writes, or null when its payload names no canonical one. */
    assignment: GrooveTemplateAssignment | null;
    /** Why the application must not run, or null when it may. */
    refusal: string | null;
};

function hasNotes(clipId: string, earlierActions: readonly AppAction[]): boolean {
    return (
        getNotesForClip(clipId).length > 0 ||
        earlierActions.some((action) => action.type === 'addNotes' && action.payload.clipId === clipId)
    );
}

/**
 * Plans one groove application against the groove pool and assignments as the earlier actions of
 * its batch leave them, so a template an earlier extraction creates is a valid target and the
 * inverse restores the assignment the application will actually replace. Validation and describe
 * both read this plan, so they cannot disagree about a batch.
 */
export function planGrooveApplication(
    payload: ApplyGroovePayload,
    earlierActions: readonly AppAction[]
): GrooveApplicationPlan {
    const assignment = canonicalizeGrooveTemplateAssignment({
        consumerType: 'clip',
        consumerId: payload.clipId,
        templateId: payload.grooveId,
        amount: payload.amount ?? 1,
    });
    const liveState = grooveTemplateStore.value;
    if (!liveState) {
        return { priorAssignment: null, assignment, refusal: 'The groove pool is unavailable' };
    }
    const state = projectGrooveTemplateState(liveState, earlierActions);
    const priorAssignment = getGrooveAssignment({ consumerType: 'clip', consumerId: payload.clipId }, state) ?? null;
    if (assignment === null) {
        return { priorAssignment, assignment, refusal: `Clip "${payload.clipId}" cannot take a groove assignment` };
    }
    if (!getGrooveTemplate(assignment.templateId, state)) {
        return {
            priorAssignment,
            assignment,
            refusal: `Groove template "${payload.grooveId}" is not in the groove pool`,
        };
    }
    // A groove moves and shapes notes; on a clip without any it changes nothing audible.
    const refusal = hasNotes(payload.clipId, earlierActions)
        ? null
        : `Clip "${payload.clipId}" has no notes for a groove to shape`;
    return { priorAssignment, assignment, refusal };
}
