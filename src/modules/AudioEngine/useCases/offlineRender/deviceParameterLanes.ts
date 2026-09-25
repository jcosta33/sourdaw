/**
 * Enabled lanes on one strip that name neither the fader, the pan, nor a send
 * — the device-parameter family (#3068, #3568).
 *
 * Mirrors `scheduleTrackAutomation`'s own drop conditions
 * (`repositories/offlineScheduler/automationScheduling.ts`) so no caller ever
 * judges a lane the scheduler would never have carried anyway: a clip-scoped
 * lane whose clip is not in `clipBounds` (the clip was removed or never built),
 * and a lane that resolves — after following its link chain — to no points at
 * all. The live producer excludes what it cannot carry from this set
 * (`projectLiveAutomationWrites.ts`), and the native export declines over it
 * (`renderOfflineWithNativeEngine.ts`), so both answer about the same lanes.
 */

import { resolveLinkedLane } from '#/utils/automationLaneLink';

import { type AutomationLane } from '../../models/AutomationViewTypes';

const KNOWN_STRIP_PARAMETER_IDS = new Set(['gain', 'pan']);
const SEND_PARAMETER_PREFIX = 'send:';

export function deviceParameterLanes(input: {
    lanes: readonly AutomationLane[];
    laneById: ReadonlyMap<string, AutomationLane>;
    trackId: string;
    clipBounds: ReadonlyMap<string, { startBeat: number; endBeat: number }>;
}): readonly AutomationLane[] {
    const { lanes, laneById, trackId, clipBounds } = input;
    return lanes.filter((lane) => {
        if (lane.trackId !== trackId || lane.enabled === false) {
            return false;
        }
        if (KNOWN_STRIP_PARAMETER_IDS.has(lane.parameterId) || lane.parameterId.startsWith(SEND_PARAMETER_PREFIX)) {
            return false;
        }
        if (lane.clipId && !clipBounds.has(lane.clipId)) {
            return false;
        }
        const resolved = resolveLinkedLane(lane.id, (id) => laneById.get(id));
        if (!resolved) {
            return false;
        }
        const sourceLane = laneById.get(resolved.sourceLaneId);
        return sourceLane !== undefined && sourceLane.points.length > 0;
    });
}
