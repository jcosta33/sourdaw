import { type AutomationLane } from '../../models/Automation';
import { is_exact_automation_lane, automationStore } from '../../stores/automationStore';

export function restoreAutomationLanes(laneSnapshots: readonly unknown[]): void {
    if (laneSnapshots.length === 0) {
        return;
    }

    const state = automationStore.value;
    if (!state) {
        return;
    }

    const validLaneSnapshots: AutomationLane[] = [];
    for (let index = 0; index < laneSnapshots.length; index += 1) {
        if (!Object.hasOwn(laneSnapshots, index)) {
            return;
        }

        const laneSnapshot = laneSnapshots[index];
        if (!is_exact_automation_lane(laneSnapshot)) {
            return;
        }

        validLaneSnapshots.push(laneSnapshot);
    }

    const laneIds = new Set(state.lanes.map((lane) => lane.id));
    const lanesToRestore = validLaneSnapshots.filter((lane) => {
        if (laneIds.has(lane.id)) {
            return false;
        }

        laneIds.add(lane.id);
        return true;
    });
    if (lanesToRestore.length === 0) {
        return;
    }

    automationStore.set({ lanes: [...state.lanes, ...lanesToRestore] });
}
