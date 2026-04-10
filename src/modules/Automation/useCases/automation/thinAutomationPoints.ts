import { inject } from '#/infra/di/inject';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { rdpSimplify } from '#/modules/Arrangement/useCases/automationQueries';

export const thinAutomationPointsDependencies = {
    rdpSimplify,
} as const;

export const thinAutomationPoints = inject(thinAutomationPointsDependencies)(
    ({ rdpSimplify }) =>
        function thinAutomationPoints(laneId: string, tolerance = 0.01): void {
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
);
