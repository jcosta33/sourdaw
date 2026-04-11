import { inject } from '#/infra/di/inject';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { interpolateAutomationValue } from '#/modules/Arrangement/useCases';

export const getAutomationValueAtBeat = inject({ interpolateAutomationValue })(
    ({ interpolateAutomationValue }) =>
        function getAutomationValueAtBeat(laneId: string, beat: number): number | null {
            const state = automationStore.value;
            if (!state) {
                return null;
            }

            const lane = state.lanes.find((l) => l.id === laneId);
            if (!lane || lane.points.length === 0) {
                return null;
            }

            const before = lane.points.filter((p) => p.beat <= beat);
            const after = lane.points.filter((p) => p.beat > beat);

            if (before.length === 0) {
                return lane.points[0]!.value;
            }
            if (after.length === 0) {
                return before[before.length - 1]!.value;
            }

            return interpolateAutomationValue(before[before.length - 1]!, after[0]!, beat);
        }
);
