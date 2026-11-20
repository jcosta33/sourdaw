import { automationSubLaneValueAtY } from '../../models/AutomationSubLaneGeometry';
import { type AutomationSubLaneRenderModel } from '../../models/TimelineRenderModel';
import {
    AUTOMATION_SUB_LANE_HEIGHT,
    getAutomationSubLaneTop,
    getRenderedTrackExtent,
} from '../../models/TimelineTrackExtent';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';

export type AutomationSubLaneHit = {
    lane: AutomationSubLaneRenderModel;
    value: number;
    beat: number;
};

export function hitTestAutomationSubLane(canvasX: number, canvasY: number): AutomationSubLaneHit | null {
    const view = timelineViewStore.value;
    if (!view) {
        return null;
    }
    const contentY = canvasY + view.scrollY;
    let trackTop = 0;

    for (const track of buildTimelineRenderModel()?.tracks ?? []) {
        const automationTop = trackTop + getAutomationSubLaneTop(track.height, track.variationLanes?.length ?? 0);
        const laneIndex = Math.floor((contentY - automationTop) / AUTOMATION_SUB_LANE_HEIGHT);
        const lane = track.automationLanes?.[laneIndex];
        if (lane) {
            return {
                lane,
                value: automationSubLaneValueAtY(
                    lane,
                    contentY - automationTop - laneIndex * AUTOMATION_SUB_LANE_HEIGHT
                ),
                beat: Math.max(0, (canvasX + view.scrollX) / view.pixelsPerBeat),
            };
        }
        trackTop += getRenderedTrackExtent(track);
    }
    return null;
}
