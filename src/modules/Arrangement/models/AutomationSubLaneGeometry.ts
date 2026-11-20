import { AUTOMATION_SUB_LANE_HEIGHT } from './TimelineTrackExtent';

const VERTICAL_PADDING = 2;
const DRAWABLE_HEIGHT = AUTOMATION_SUB_LANE_HEIGHT - 2 * VERTICAL_PADDING;

type LaneRange = { minValue: number; maxValue: number };

export function automationSubLaneValueAtY({ minValue, maxValue }: LaneRange, y: number): number {
    const normalized = Math.max(0, Math.min(1, 1 - (y - VERTICAL_PADDING) / DRAWABLE_HEIGHT));
    return minValue + normalized * (maxValue - minValue);
}

export function automationSubLaneYAtValue({ minValue, maxValue }: LaneRange, value: number): number {
    const normalized = maxValue > minValue ? Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue))) : 0.5;
    return VERTICAL_PADDING + (1 - normalized) * DRAWABLE_HEIGHT;
}
