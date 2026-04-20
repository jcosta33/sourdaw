import { rdpSimplify } from '#/modules/Arrangement/useCases';

import { automationStore } from '../../stores/automationStore';

export const thinAutomationPointsDependencies = {
    rdpSimplify,
} as const;

export function thinAutomationPoints(laneId: string, tolerance = 0.01): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length <= 2) {
                return lane;
            }
            return { ...lane, points: rdpSimplify(lane.points, tolerance) };
        }),
    });
}
