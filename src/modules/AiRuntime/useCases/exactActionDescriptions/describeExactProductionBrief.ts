import { describeProductionBriefChange } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/**
 * A brief write, read against the brief the request was planned on, so the card lists each entry it
 * adds or removes rather than one opaque "set the brief".
 */
export function describeExactProductionBrief(
    action: Extract<AppAction, { type: 'setProductionBrief' }>,
    context: ProjectContext
): string {
    const label = `Update the production brief from revision ${String(action.payload.expectedRevision)}`;
    const lines = describeProductionBriefChange({
        before: context.productionBrief,
        after: action.payload.brief,
        trackNames: Object.fromEntries(context.tracks.map((track) => [track.id, track.name])),
        sectionNames: Object.fromEntries((context.sections ?? []).map((section) => [section.id, section.name])),
    });
    if (lines === null) {
        return label;
    }
    if (lines.length === 0) {
        return `${label}: no entry changes`;
    }
    return `${label}: ${lines.join('; ')}`;
}
