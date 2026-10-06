import { takeLaneStore } from '../../stores/takeLaneStore';

type TakeStart = { takeId: string; startBeat: number; sourceOffsetBeats: number };

/** Set the start and media offset of each named take, in one store write. */
export function writeTakeStarts(starts: readonly TakeStart[]): void {
    const state = takeLaneStore.value;
    if (!state || starts.length === 0) {
        return;
    }
    const startsByTakeId = new Map(starts.map((start) => [start.takeId, start]));
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                const start = startsByTakeId.get(take.id);
                if (!start) {
                    return take;
                }
                return { ...take, startBeat: start.startBeat, sourceOffsetBeats: start.sourceOffsetBeats };
            }),
        })),
    });
}
