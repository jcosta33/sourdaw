import { automationStore } from '../../stores/automationStore';

export function shiftClipAutomation(clipId: string, beatDelta: number, targetTrackId?: string): void {
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
                trackId: targetTrackId ?? lane.trackId,
                // Clamp to >= 0: a clip never lives before the timeline origin,
                // so a negative net beat would detach the automation from the
                // audio it rides. Sort afterwards because the clamp can collide
                // several leading points onto beat 0, breaking sort order.
                points: lane.points
                    .map((param) => ({
                        ...param,
                        beat: Math.max(0, param.beat + beatDelta),
                    }))
                    .sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}
