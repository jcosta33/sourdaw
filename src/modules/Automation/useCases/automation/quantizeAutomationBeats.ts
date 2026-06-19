import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function quantizeAutomationBeats(laneId: string, gridSize: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    // Guard divide-by-zero / non-finite grids: `Math.round(beat / 0)` is NaN for
    // every point, and a Map keyed on NaN collapses the whole lane into one
    // NaN-beat point — silent total data loss. A non-positive or non-finite grid
    // has no meaningful quantization, so leave the beats untouched.
    if (!(gridSize > 0) || !Number.isFinite(gridSize)) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            const snapped = new Map<number, AutomationPoint>();
            for (const param of lane.points) {
                const quantized = Math.round(param.beat / gridSize) * gridSize;
                snapped.set(quantized, { ...param, beat: quantized });
            }
            return {
                ...lane,
                points: Array.from(snapped.values()).sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}
