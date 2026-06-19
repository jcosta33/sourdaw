import { automationStore } from '../../stores/automationStore';

export function reverseAutomation(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length === 0) {
                return lane;
            }
            // Single pass: `Math.max(...lane.points.map(...))` spreads every beat
            // as an argument, which overflows V8's ~32k arg cap on a long, dense
            // recording (~5 min @ 100 Hz ≈ 30k points) — §117.2 pattern.
            let maxBeat = -Infinity;
            for (const param of lane.points) {
                if (param.beat > maxBeat) {
                    maxBeat = param.beat;
                }
            }
            return {
                ...lane,
                points: lane.points
                    .map((param) => ({ ...param, beat: maxBeat - param.beat }))
                    .sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}
