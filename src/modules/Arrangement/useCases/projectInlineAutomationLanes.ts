import { getAutomationLaneCeiling, getAutomationValueAtBeat } from '#/modules/Automation/useCases';

import { getInlineAutomationRows } from '../models/InlineAutomationRows';
import { type AutomationSubLaneRenderModel } from '../models/TimelineRenderModel';
import { type Track } from '../models/Track';

import { type readInlineAutomationSnapshot } from './readInlineAutomationSnapshot';

export function projectInlineAutomationLanes(
    tracks: readonly Track[],
    { editing, lanes }: ReturnType<typeof readInlineAutomationSnapshot>
): ReadonlyMap<string, readonly AutomationSubLaneRenderModel[]> {
    const snapshot = lanes ?? [];
    const visitedLaneIds = new Set<string>();
    const rows = new Map<string, readonly AutomationSubLaneRenderModel[]>();
    for (const [trackId, trackLanes] of getInlineAutomationRows(tracks, snapshot, editing)) {
        rows.set(
            trackId,
            trackLanes.map((lane) => ({
                id: lane.id,
                trackId: lane.trackId,
                parameterId: lane.parameterId,
                parameterName: lane.parameterName,
                minValue: lane.minValue,
                maxValue: getAutomationLaneCeiling(lane),
                color: lane.color,
                linkedLaneId: lane.linkedLaneId,
                valueAtBeat: (beat) => getAutomationValueAtBeat(lane.id, beat, visitedLaneIds, snapshot),
            }))
        );
    }
    return rows;
}
