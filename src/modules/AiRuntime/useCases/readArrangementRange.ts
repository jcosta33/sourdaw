import { type ProjectContext } from '../models/ProjectContext';

import { type MetricGoal } from './metricGoalContractTypes';

/**
 * The whole arrangement, the extent the answer catalog's own `arrangement` range reads: from the start
 * to the end of the last clip, or `null` when no clip holds any time.
 */
export function readArrangementRange(context: Pick<ProjectContext, 'tracks'>): MetricGoal['range'] {
    const endBeat = Math.max(
        0,
        ...context.tracks.flatMap((track) => track.clips.map((clip) => clip.endBeat)).filter(Number.isFinite)
    );
    return endBeat > 0 ? { startBeat: 0, endBeat, sectionId: null } : null;
}
