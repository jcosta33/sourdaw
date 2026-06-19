import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

/**
 * Replace one lane's `points` array wholesale with a captured snapshot.
 *
 * This is the single primitive the automation transform handlers
 * (reverse/scale/stretch/thin/quantize/invert) use to express a lossless undo:
 * their `describe()` captures the lane's points before the transform runs and
 * emits a `restoreAutomationLanePoints` inverse action carrying that snapshot.
 * On undo the snapshot replaces whatever the transform produced, restoring the
 * exact pre-state — including curve/tension/cp1/cp2 per point.
 *
 * Only the target lane's `points` are touched; every other lane (and every
 * other field on the target lane) is left as-is so a concurrent edit to another
 * lane is never clobbered.
 */
export function restoreAutomationLanePoints(laneId: string, points: AutomationPoint[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) =>
            lane.id === laneId ? { ...lane, points: points.map((p) => ({ ...p })) } : lane
        ),
    });
}
