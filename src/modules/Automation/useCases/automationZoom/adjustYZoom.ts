import { automationStore } from '../../stores/automationStore';
import { getAutomationLaneCeiling } from '../automation/getAutomationLaneCeiling';

/**
 * Incrementally zoom the Y-axis in or out (positive delta = zoom in).
 *
 * The axis top is {@link getAutomationLaneCeiling}, the same derived ceiling
 * `AutomationLaneRow` scales the unzoomed lane by, rather than the stored
 * `maxValue`. A gain lane authored before the fader widened still stores
 * `maxValue: 1`; pinning the view here to that value would collapse its axis
 * back to unity on the first zoom gesture and hide every point drawn into the
 * headroom, so the widening would survive only until the user touched the
 * lane.
 */
export function adjustYZoom(laneId: string, delta: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane) {
        return;
    }

    const ceiling = getAutomationLaneCeiling(lane);
    const currentMin = lane.viewMinValue ?? lane.minValue;
    const currentMax = lane.viewMaxValue ?? ceiling;
    const range = currentMax - currentMin;
    const center = (currentMin + currentMax) / 2;
    const factor = 1 - delta * 0.1; // positive delta = zoom in (shrink range)
    const newRange = Math.max(range * factor, (ceiling - lane.minValue) * 0.05);
    const halfRange = newRange / 2;

    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId
                ? {
                      ...length,
                      viewMinValue: Math.max(length.minValue, center - halfRange),
                      viewMaxValue: Math.min(ceiling, center + halfRange),
                  }
                : length
        ),
    });
}
