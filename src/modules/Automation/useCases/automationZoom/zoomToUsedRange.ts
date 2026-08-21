import { automationStore } from '../../stores/automationStore';
import { getAutomationLaneCeiling } from '../automation/getAutomationLaneCeiling';

/**
 * Zoom a lane's Y-axis to fit the used value range with padding.
 *
 * Bounded by {@link getAutomationLaneCeiling} rather than the stored
 * `maxValue`, for the reason `adjustYZoom` states: a legacy gain lane stores
 * `maxValue: 1`, so clamping the fitted view to it would leave a point drawn
 * at `1.5` sitting above the top of the axis it was just asked to fit.
 */
export function zoomToUsedRange(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((length) => length.id === laneId);
    if (!lane || lane.points.length === 0) {
        return;
    }

    // Single pass: the prior `Math.min/max(...lane.points.map(...))` spreads
    // every value as an argument, overflowing V8's ~32k arg cap on a long, dense
    // recording (~5 min @ 100 Hz ≈ 30k points) — §117.2 pattern.
    let min = Infinity;
    let max = -Infinity;
    for (const param of lane.points) {
        if (param.value < min) {
            min = param.value;
        }
        if (param.value > max) {
            max = param.value;
        }
    }
    const ceiling = getAutomationLaneCeiling(lane);
    const range = max - min;
    const padding = Math.max(range * 0.1, (ceiling - lane.minValue) * 0.02);

    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId
                ? {
                      ...length,
                      viewMinValue: Math.max(length.minValue, min - padding),
                      viewMaxValue: Math.min(ceiling, max + padding),
                  }
                : length
        ),
    });
}
