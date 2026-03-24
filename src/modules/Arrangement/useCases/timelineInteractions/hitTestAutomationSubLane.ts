import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { AUTOMATION_SUB_LANE_HEIGHT } from '../../models/automationConstants';

export type AutomationSubLaneHit = {
    laneId: string;
    trackId: string;
    subLaneIndex: number;
    value: number; // normalized 0..1 within the sub-lane
    beat: number;
};

const RULER_HEIGHT = 0;

/**
 * Hit-test whether a canvas coordinate falls inside an inline automation sub-lane.
 */
export function hitTestAutomationSubLane(canvasX: number, canvasY: number): AutomationSubLaneHit | null {
    const viewState = timelineViewStore.value;
    const trackState = trackStore.value;
    const workspace = workspaceStore.value;
    if (!viewState || !trackState || !workspace || workspace.automationVisibility === 'hidden') {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));

    const subLaneMap = workspace.automationSubLanes;
    const model = buildTimelineRenderModel();
    if (!model) {
        return null;
    }

    let trackYOffset = 0;

    for (const track of model.tracks) {
        const paramIds = subLaneMap[track.id] ?? [];
        const totalHeight = track.height;
        const baseHeight = totalHeight - paramIds.length * AUTOMATION_SUB_LANE_HEIGHT;
        const trackBottom = trackYOffset + totalHeight;

        if (contentY >= trackYOffset && contentY < trackBottom) {
            const localY = contentY - trackYOffset;
            if (localY >= baseHeight && paramIds.length > 0) {
                const subLaneLocalY = localY - baseHeight;
                const subLaneIndex = Math.floor(subLaneLocalY / AUTOMATION_SUB_LANE_HEIGHT);
                if (subLaneIndex >= 0 && subLaneIndex < paramIds.length) {
                    const withinLaneY = subLaneLocalY - subLaneIndex * AUTOMATION_SUB_LANE_HEIGHT;
                    const value = Math.max(0, Math.min(1, 1 - (withinLaneY - 2) / (AUTOMATION_SUB_LANE_HEIGHT - 4)));
                    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;

                    const autoState = automationStore.value;
                    const lane = autoState?.lanes.find(
                        (l) => l.trackId === track.id && l.parameterId === paramIds[subLaneIndex]
                    );

                    if (lane) {
                        return {
                            laneId: lane.id,
                            trackId: track.id,
                            subLaneIndex,
                            value,
                            beat,
                        };
                    }
                }
            }
        }
        trackYOffset += totalHeight;
    }

    return null;
}
