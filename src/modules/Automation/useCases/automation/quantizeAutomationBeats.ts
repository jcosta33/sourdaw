import { automationStore } from '../../stores/automationStore';
import { type AutomationPoint } from '../../models/Automation';

export function quantizeAutomationBeats(laneId: string, gridSize: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            const snapped = new Map<number, AutomationPoint>();
            for (const p of lane.points) {
                const quantized = Math.round(p.beat / gridSize) * gridSize;
                snapped.set(quantized, { ...p, beat: quantized });
            }
            return {
                ...lane,
                points: Array.from(snapped.values()).sort((a, b) => a.beat - b.beat),
            };
        }),
    });
}
