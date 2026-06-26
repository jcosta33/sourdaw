import { automationStore } from '../../stores/automationStore';

export function updateAutomationPoint(laneId: string, beat: number, newValue: number, newBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            // Match the target point by tolerance, not exact float equality:
            // a beat round-tripped through pixel coordinates never compares
            // exactly with `===`, so the edit would silently no-op. The 0.05
            // window matches setAutomationPointCurve.
            const updated = length.points.map((param) =>
                Math.abs(param.beat - beat) < 0.05 ? { ...param, value: newValue, beat: newBeat ?? param.beat } : param
            );
            return { ...length, points: updated.sort((alpha, b) => alpha.beat - b.beat) };
        }),
    });
}
