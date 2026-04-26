import { automationStore } from '../../stores/automationStore';

export function shiftClipAutomation(clipId: string, beatDelta: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.clipId !== clipId) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points.map((param) => ({
                    ...param,
                    beat: param.beat + beatDelta,
                })),
            };
        }),
    });
}
